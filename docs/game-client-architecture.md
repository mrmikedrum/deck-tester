# Game client architecture

The design of the rebuilt game client (`game/client/`): the stack, the layers, every seam's interface, and how a
snapshot becomes frames. It was decided up front, before code, from seven competing designs of the hard seams and an
evaluation of the stack, then reviewed adversarially by Codex (Nov 23). [The migration plan](game-client-migration.md)
says how we get here. When the migration ships, this page becomes the client's section of
[architecture](architecture.md).

The types below are the contract. Names may sharpen in code; shapes and rules change only by editing this page first.

## What it must be

- **Touch first, mouse too.** An iPad from the Home Screen is the target; a desktop with a mouse or trackpad works
  the same way (click is tap; hover and the wheel are extras, never the only way), and so does a keyboard.
- **Behaviour is pinned.** What the client sends the engine, when, and what each gesture does are fixed by the
  behaviour suite. Rendering may improve; mechanics may not change by accident.
- **The design goals hold** ([intent.md](../game/tools/look/intent.md)), the hard limits by construction where
  possible.
- **Deterministic.** The same inputs at the same times give the same frames, so the recorder works and bugs replay.
- **Agent-written.** Strict types, small interfaces, one way to do each thing, and lint that enforces the layering.

## The stack

| Area | Choice | Why |
|---|---|---|
| Language | TypeScript 6, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | Agents' mistakes caught at compile time; TS 7 once `typescript-eslint` supports it |
| Build | Vite 8, two entries (`index.html` the game, `workbench.html` fixtures) | Fast, standard, multi-page |
| HTML layer | Preact 11 (TSX), rendered synchronously inside the app's commit; components are pure projections (rules under "The frame") | Type-checked templates in the idiom agents know best; React's MessageChannel scheduler escapes the virtual clock, Preact's queue can be pinned |
| 3D | three.js r187, imperative, `WebGLRenderer` + `EffectComposer` (focus and tone mapping) | The tuned scene ports directly; WebGPU post-processing is still moving. No react-three-fiber: a second reconciler and scheduler |
| State | Hand-rolled immutable state and typed reducers (`assertNever` on unions) | Pure, clockless, serialisable; a store or state-machine library adds a scheduler or nothing |
| Animation | Our own animator (eases, critically damped springs, paths) on the frame clock; CSS transitions in the chrome | The only deterministic option; GSAP and Motion run their own tickers |
| Input | Our own Pointer Events gesture recognizer | Thresholds are pinned behaviour; hold timers must run on our clock |
| Styling | Plain CSS with custom properties and `@layer`; theme tokens from one TypeScript object feeding CSS and canvas painters | No build-time CSS system to learn; the tools' audit uses explicit `data-audit` hooks, so class names may evolve |
| Wire validation | Valibot | About 1 kB, inferred types, tolerant unions for unknown decision kinds |
| Tests | Vitest 4 (pure modules, headless app), Playwright (behaviour suite on Chromium and WebKit; recordings) | WebKit approximates Safari; the iPad itself is checked by hand |
| Lint | ESLint flat config, `typescript-eslint`, `eslint-plugin-boundaries`; `knip`; Prettier | Layering and determinism enforced by tooling: `Date`, timers, `requestAnimationFrame`, `performance.now`, `Math.random`, `MessageChannel`, workers and `useEffect` are banned outside the modules named below |
| Fonts | `@fontsource` (Barlow, Barlow Condensed, IM Fell English; the weights in use), a fonts-ready gate before first layout | No CDN; canvas text measures the same every time |
| App shell | Web app manifest and Apple metas now; a service worker later, its own milestone | A worker cache brings stale builds and its own scheduling |

## Layers

```
            ┌────────────────────────────── app ──────────────────────────────┐
            │ state · update · frame loop · effects · moments · focus · debug  │
            └──┬───────────────────┬──────────────────┬─────────────┬─────────┘
   pure core   │      renderers    │                  │   edges     │
 ┌─────────────▼───┐   ┌───────────▼┐  ┌──────────────▼┐  ┌─────────▼─────┐
 │ protocol        │◀──│ scene      │  │ chrome        │  │ transport     │
 │ model (+ delta) │◀──│ (three.js) │  │ (Preact)      │  │ platform      │
 │ layout          │◀──│            │  │               │  │ (clock, rng)  │
 │ play, narrative │◀──┴────────────┴──┴───────────────┘  └───────────────┘
 └─────────────────┘        theme: tokens and painters, read by both renderers
```

```
game/
  package.json  vite.config.ts  tsconfig.json  eslint.config.js  .nvmrc
  client/
    index.html  workbench.html
    src/
      platform/   clock, rng, viewport, fonts, prefs (localStorage, best effort)
      protocol/   wire types, valibot decoders, decision identity, the client's shared identities (client.ts)
      transport/  long poll, scripted
      model/      TableModel, card facts, delta (changes and moments), presentation predicates
      layout/     reservations, table geometry, projector, seat layouts, the table input and plan, hit testing
      play/       the decision controller
      narrative/  log, notices, losses
      theme/      tokens, CSS generation; grimoire/ (painters, materials, FX palette, motion timings)
      scene/      stage (describe, reconcile, animate), three host, faces, resources
      chrome/     Preact components, hand physics
      input/      the gesture recognizer
      app/        state, update, frame loop, effects, the answer ledger, card data, moments, focus, faults, notice, debug
      fixtures/   typed boards and plays from the captured corpus
    test/         Vitest suites mirror src/
  tools/          reel, packet, equiv, the behaviour suite (Playwright)
```

Import rules (lint):

- The **pure core** is `protocol` ← `model` ← `layout` ← `play`, `narrative` (each imports only those to its left).
  No DOM, no three.js, no `platform`, none of the globals the recorder replaces.
- **Renderers** (`scene`, `chrome`) may call the pure core and import `theme`, `input` and `platform`; never each
  other, `app` or `transport`.
- **`app`** imports everything; nothing imports it. `debug` gets a narrow handle from it.
- Clocks, timers and `requestAnimationFrame` only in `platform/`; random only through `platform/rng`; `useEffect` and
  `useLayoutEffect` only in `chrome/frame/` (below).

## The app

### State

The app owns all state that more than one module reads. Renderers keep only private motion state.

```ts
interface AppState {
  readonly session: SessionState;      // bridge state, gen, v, link, builds (stale), viewer, the last snapshot, decision, stop
  readonly model: TableModel | null;   // the decoded snapshot as the client sees it
  readonly catalog: CardCatalog;       // card data the bridge has served, merged into every model
  readonly cardAsks: CardAsks;         // card data requests out (by epoch) and names answered
  readonly gate: DecisionGate;         // the decision held back for its cards' data ("When a decision becomes actionable")
  readonly changes: ChangeQueue;       // change sets the scene has not consumed; seq never reset; a pending cut
  readonly plan: TablePlan | null;     // every seat's layout, plates, stack and hit groups (pure, from layout)
  readonly settling: boolean;          // the scene's last report said cards are flying between zones (`flying`)
  readonly planKey: string | null;     // the inputs the plan was made from: unchanged inputs keep it
  readonly layoutMemory: ReadonlyMap<SeatId, LayoutMemory>; // kept places and held rows, fed back into the next plan
  readonly play: play.State;           // the decision controller (opaque); lives for the page, never reset
  readonly narrative: narrative.State; // the log, notices waiting on the table's motion, my losses, recaps, toasts
  readonly focus: FocusStack;          // the app's layers, top last
  readonly viewport: ViewportState;    // w, h and safe-area insets
  readonly hover: string | null;       // the hit group under a mouse pointer on the canvas: paint only, never a replan
  readonly reducedMotion: boolean;     // prefers-reduced-motion, followed as it changes (platform/motion.ts)
  readonly reserve: Reservations;      // where the chrome sits, from layout
  readonly moments: MomentsState;      // cross-renderer moments in progress
  readonly answer: AnswerLedger;       // the answer out and the bridge's status ("The answer ledger")
  readonly deadlines: Deadlines;       // every timer as data: auto-pass, the card-data wait, notices, moment backstops
  readonly faults: FaultState;         // ingest, renderer and effect faults, what the player is told
  readonly commit: CommitId;           // increments every commit
  readonly epoch: number;              // local: increments on newGame, restart and teardown; every effect and reply carries it
}
```

### Messages carry when and against what

The identities more than one layer shares live in `protocol/client.ts`, off the wire: `StopId` (issued by play),
`AnswerToken` (issued by play, one per send, unique for the page), `AnswerOutcome` (`queued`, `refused` with a reason,
`indeterminate`), `Continuity`, `Stamp` and `CommitId`. Every input is stamped: when it happened, and which commit the
player saw when acting.

```ts
interface Stamp { readonly at: Ms; readonly commit: CommitId }   // at: the event's time on the platform clock

type Msg =
  | TransportEvent                       // snapshot (continuity, asked), answered (token, outcome, attempt?), link, art,
                                         // started, decks, cards, fault; each with `at` and the epoch it was issued under
  | { t: "act"; stamp: Stamp; stop: StopId | null; act: play.Act } // from a control or gesture; stop = what it was drawn for
  | { t: "dismiss"; stamp: Stamp } | { t: "restore"; stamp: Stamp; layer: LayerId }
  | { t: "newGame"; stamp: Stamp; req: NewGameRequest } | { t: "listDecks"; stamp: Stamp }
  | { t: "hover"; stamp: Stamp; group: string | null }           // a mouse moved onto another hit group (null: none)
  | { t: "viewport"; at: Ms; w: number; h: number; safe: Insets }
  | { t: "motion"; at: Ms; reduced: boolean }                     // the reduced-motion setting changed
  | { t: "scene"; at: Ms; report: RenderReport }                  // consumed sets, landings, recaps, `flying` and the
                                                                  // chrome's re-anchored carried poses, from the last commit
  | { t: "deadline"; at: Ms; id: DeadlineId; serial: number };

function update(state: AppState, msg: Msg): { state: AppState; effects: readonly Effect[] };
```

`update` is a short router: it hands each message to the module that owns it (`play.step`, the answer ledger,
`catalog`, `moments`, `focus`, `faults`) and recomputes derived state (`modelOf`, `diff`, the plan) when its inputs
change. It holds no game logic of its own.

**Stops.** Play issues a `StopId` (`gen.id.serial`) when it adopts a decision: the engine parked a new one (a new `id`
or key), or the view was rewound or cut. The serial lives for the page, so a stop is never reused, even when a new game
asks the same question under the same id. Every control the chrome draws and every board cue carries the stop and the
commit that drew it; an act for another stop is dropped. An act on a hit group carries the group's members as drawn; if
they or their order changed since, the act is dropped (the player taps again on what is now shown). So a snapshot that
lands between a tap and its handling never redirects that tap. End to end, the answer names the decision's id and the
engine refuses it unless that decision is still parked.

### The frame

`app/loop.ts` is the only place time enters.

1. `now` is the frame's time.
2. **Drain every source**: the last commit's scene report, the transport, the input sources (renderer intents,
   keyboard, debug), the viewport. Nothing is pushed into the app by callback.
3. Add every deadline due by `now`.
4. **Sort by time** (`at`, or `stamp.at`). On a tie: the player's input, the viewport, the transport's events,
   deadlines, then renderer reports. A Hold tapped at 3,190 ms cancels the pass due at 3,200 ms; one tapped at 3,210 ms
   is too late, tested before, at and after the deadline.
5. Fold the messages through `update`, collecting effects (an event from an older epoch is ignored); then run the
   effects against the state the fold ended in. An answer effect goes out only if the ledger still holds it for the stop
   on screen, so a snapshot later in the same frame cancels it. Results come back as messages through the sources,
   never as promise callbacks into the app. A deadline created during the fold fires in a later frame even if already
   due; a cancellation takes effect at once.
6. **Commit once**: the renderer shows the whole state at `now`: `scene.show(sceneFrame(state), now)`, then the chrome
   renders `chromeView(state, sceneReport)` synchronously (Preact's `debounceRendering` is replaced by the commit). A
   report with news for update (sets consumed, moments landed, recaps) is folded as a `scene` message next frame. The
   app's notice is drawn last, on its own surface. The recorder samples whole states.

**Waking.** The loop keeps requesting frames while the scene, the chrome or a tracked pointer reports activity, a
source has messages, a deadline falls within a frame, or a renderer fault wants a recovery commit (at most three in a
row; none for a terminal fault). Otherwise it stops and schedules one wake at the earliest deadline; any arrival on a
source wakes it at once, so an input's effect paints on the next frame.

**Preact rules.** Components are pure functions of the view: no `useEffect`, no `useLayoutEffect`, no state that
outlives the view except inside `chrome/frame/`, which holds the few primitives that need per-frame work (the hand's
physics, the auto-pass countdown) and is stepped by the app's commit with `now`, never by its own timers.

**The recorder.** It already replaces the clock globals; the scripted transport delivers snapshots and card art inside
a drain rather than through `fetch`, so no microtask decides what a frame shows. `EffectComposer.render` gets the
frame delta explicitly.

### Continuity, faults and compatibility

- **Continuity** is classified by the transport, which owns the poll cursor: `first`, `advance`, `same` (an idle
  poll), `newGame` (a new `gen`), `rewind` (the view cut backwards), `restart` (the server's `v` went backwards).
  `newGame` and `restart` set aside the game's state (model, plan, layout memory, focus, moments, notices, the change
  queue, the gate, play's and the moments' deadlines) and cut the scene; play hears of it as a snapshot event.
- **Epochs.** Every effect and every reply carries the app's local epoch; a reply from an older epoch is ignored, even
  when a restarted bridge reuses `gen`.
- **Ingest faults** (a snapshot that fails to decode, or a throw in `update`, including a snapshot play cannot reduce)
  are reported to `/api/clientlog`; the snapshot is not acknowledged, and the transport re-syncs from `v=0` once. Two
  in a row show the fault notice. Nothing is dropped silently.
- **Renderer faults** (an exception in `show` or a component) are caught per commit and reported; the next commit is a
  cut from the latest state; a second fault within 5 s shows the fault notice. A scene that cannot start (no WebGL, a
  failed load) is terminal: the notice shows at once, the scene is not built again until teardown, and `ready`
  rejects with the cause. A WebGL context loss rebuilds the three.js host and redraws the latest state as a cut.
- **The notice** (`app/notice.ts`) is the app's own small DOM surface with Reload, outside the chrome and the scene, so
  it shows when the renderer is what fails: a render fault, an ingest fault, or a stale build.
- **Build compatibility.** The bridge stamps each snapshot with the client build it serves; when it differs from the
  running bundle (an iPad holding an old page), the notice offers Reload. Only bundles built after the check exists can
  notice; the first build to ship it is the line.
- **Startup and teardown.** The first commit shows the waiting state until a snapshot with a model arrives; stale
  replies and art for an older epoch are ignored; teardown (tests, the workbench switching fixtures) bumps the epoch,
  stops the transport, cancels every deadline and moment, and disposes the scene's resources.

**Client log.** `POST /api/clientlog` takes structured entries (level, code, build, model `rev`, stop, and a message
of at most 2 KB with card names but no card text or decklists), at most 50 a minute. The bridge validates the fields
and keeps at most 1 MB, rotating (`protocol/clientlog.ts` has the shape and limits). A `?debug` overlay shows the same on the device.

### The answer ledger

`app/answers.ts` is the one reader of answer outcomes and of the bridge's answer status, and the one source of
settlement: play hears `settled` (applied, refused, unseen, superseded, lost) and never reads either itself.

- At most one answer is out, for the stop on screen (a double tap sends one). `queued` and `indeterminate` prove
  nothing: the prompt stays busy until the answer settles or a new stop arrives. The client never resends on its own.
- A status speaks for an answer by the bridge's `attempt` (the POST reply's, carried on `answered`, or the status's
  own): a status for an older attempt, or for the newest attempt seen when this one was sent, is never this answer's.
  A status for a later attempt seen first settles it as `unseen`. Without attempt numbers (an older bridge) it reads
  the status by decision and by change since the answer was sent.
- `indeterminate` becomes `lost` only when a snapshot asked for after the failure shows the bridge never had it.
- A status saying the bridge is working on an answer to the decision on screen that this page did not send (a reload)
  is held with no token: play hears `working` and stays busy until it settles, since the bridge would refuse a second.
- A new game supersedes the answer out and keeps the attempt history; a restart also forgets attempt numbers, since a
  new bridge process numbers them from the start.

### When a decision becomes actionable

The table renders as soon as a snapshot arrives; card data (`/api/cards`, `app/catalog.ts`) fills faces in as it comes,
remaking the model from the last snapshot. A new decision is offered to play only once the data for the cards it is
about has arrived (`play.cardsWanted`: its options' cards, the stack's top and its targets, names a sheet shows), or
1.2 s after it arrived, when it goes with what there is and the missing names are logged. Meanwhile play gets the
snapshot with `held` and shows the prompt waiting: no buttons, no auto-pass. The same decision is not held again.

## protocol and transport

Settled in phase 1: `protocol/` is the source of truth for the wire's shapes, and
[architecture](architecture.md) ("The game's protocol") states its rules. The API:

```ts
// protocol/
export type CardId = number & Brand<"CardId">;   // also StackId, PlayerName, DecisionId, DecisionKey
export interface Snapshot {
  readonly state: "no game" | "starting" | "playing" | "over" | "error";
  readonly gen: number | null; readonly v: number; readonly error: string | null; readonly build: string | null;
  readonly answer: AnswerStatus | null;           // { key, id, attempt, state: "working" | "applied" | "refused", error }
  readonly view: View | null;                     // null for `{}` and before a game
  readonly decision: Decision | null;             // by kind, each with its id, its typed refs, its key and the gen
  readonly over: string | null; readonly pilots: Readonly<Record<string, string>>;
}
export type Answer = { readonly answer: readonly number[] } | { readonly defer: true };
export function decodeSnapshot(json: unknown): Result<Snapshot, DecodeError>;   // never throws
export function answerRequest(d: Decision, a: Answer): AnswerRequest;           // { id, gen, key, ...answer }
export function answerProblem(d: Decision, picks: readonly number[]): string | null;  // the engine's check
```

Decoding is strict where a violation would make the client act wrongly (ids, zones, the stack, a decision's
bounds, refs aligned with options) and tolerant elsewhere: unknown keys are dropped, unknown phases pass, an unknown
decision kind decodes as `kind: "unknown"` with its `wireKind`, and optional fields default (false, 0, [], {}, null);
a `choose` without refs (asked by label only) gets one empty ref per option.
The bundle's own build id is `platform`'s `clientBuild`.

```ts
// transport/
export interface Transport {
  readonly out: Source<TransportEvent>;   // snapshot (continuity, asked), answered, link, art, started, decks, cards, fault
  start(epoch: number): void; stop(): void;
  ack(epoch: number, v: number, ack: "took" | "fault" | "stale"): void;  // the next snapshot is released only after
  answer(token: AnswerToken, epoch: number, body: AnswerRequest): void;  // outcome arrives as `answered`, with the
                                                              //   bridge's `attempt` when its reply carries one
  newGame(epoch: number, req: NewGameRequest): void;          // result arrives as `started`
  decks(epoch: number): void;             // the list arrives as `decks`; failures are not cached
  cards(epoch: number, names: readonly string[]): void;       // card data arrives as `cards`
}
// adapters: longPollTransport (production); scriptedTransport (fixtures, workbench, Vitest, recordings, `?script`;
// every event, answer outcomes included, delivered inside a drain)
```

## model: the table as the client sees it

```ts
export type SeatId = string & { readonly __seat: unique symbol };   // the seat's name: game.py never reuses one in a game
export interface Viewer { readonly perspective: SeatId; readonly seat: SeatId | null; readonly mayAnswer: boolean }
export interface TableModel {
  readonly rev: string;                           // content hash: equal iff equal
  readonly gen: number;                           // the game's generation (diff resets when it changes)
  readonly viewer: Viewer;
  readonly seats: readonly Seat[];                // the perspective first, then the turn order (`pilots`, the bridge's seating)
  readonly turn: number; readonly label: string; readonly phase: Phase; readonly over: boolean;
  readonly active: SeatId | null; readonly priority: SeatId | null;
  readonly cards: ReadonlyMap<CardId, Card>;      // every visible card, any zone (a spell's card: zone "stack")
  readonly stack: readonly StackItem[];           // bottom first; source, controller, targets as Target ({card} | {seat})
  readonly combat: Combat | null;                 // attackers with defender (Target) and the seat defending; blockers
  readonly log: readonly LogEntry[];
  seat(id: SeatId): Seat | undefined;
  zone(seat: SeatId, zone: Zone): readonly CardId[];   // indexed once: battlefield and stack by controller, the rest by owner
  attachments(card: CardId): readonly CardId[];
}
export interface Seat {                           // an eliminated player keeps the seat, `out`, its other facts 0
  readonly id: SeatId; readonly name: PlayerName; readonly pilot: string | null; readonly out: boolean;
  readonly life: number; readonly poison: number; readonly monarch: boolean;
  readonly hand: number; readonly handVisible: boolean; readonly library: number;
  readonly manaPool: Readonly<Record<string, number>>; readonly commanderDamage: ReadonlyMap<CardId, number>;
}
export interface Card {                           // engine facts merged with card data (name, faces, art)
  readonly id: CardId; readonly name: string;     // the card's identity (the old `c.card`): "Face-down" face down
  readonly owner: SeatId; readonly controller: SeatId;
  readonly zone: Zone; readonly face: CardFace; readonly tapped: boolean; readonly token: boolean;
  readonly commander: boolean; readonly faceDown: boolean; readonly sick: boolean;
  readonly power: number | null; readonly toughness: number | null; readonly loyalty: number | null;
  readonly counters: Readonly<Record<string, number>>; readonly keywords: readonly Keyword[];
  readonly attachedTo: CardId | null; readonly copy: boolean;
}
export interface CardFace {                       // display name, type line (the engine's, which is what it is now),
  readonly name: string; readonly type: string;   // rules text (Oracle, else the engine's), the engine's own text,
  readonly text: string; readonly rules: string;  // braced cost, printed stats, colours, the mana it makes, art
  readonly cost: string; readonly basePower: number; readonly baseToughness: number;
  readonly colors: readonly string[]; readonly produces: readonly string[];
  readonly art: string | null; readonly img: string | null;
  readonly catalogued: boolean;                   // false: no catalog entry, built from the view alone
}
export function modelOf(snap: Snapshot, cards: CardCatalog, viewer: Viewer): TableModel | null;   // null: no view yet
export function decodeCatalog(json: unknown, base?: CardCatalog): CardCatalog;   // /api/cards replies, tolerantly
export function playerViewer(snap: Snapshot): Viewer | null;   // today's bridge: one person at `view.me`, who may answer
```

Seats come from `pilots`, not array positions: the engine drops a player who loses from `players` (the viewer
included, after which `players[0]` is someone else), so a seat keeps its place and id for the whole game.

Presentation predicates live here, named and tested against the old client's own expressions (`predicates.ts`:
`isLand`, `isCreature`, `isManaRock`, `isSpecialLand`, `typeWord`, `sig`, `handOrder`...; `readings.ts`: `sweepHits`,
`sweepHarms`, `isCounterspell`, `threatens`, `alarming`, the log line readers): they shape how things look and read,
never what is legal. One deliberate difference: a card's type line is its own, where the old DB kept one per name.

**The delta.** Each model the app accepts is diffed against the previous one, and the result is queued in order, so a
push and a pop that arrive in one frame are both shown:

```ts
export function diff(prev: TableModel | null, next: TableModel, seq: number): ChangeSet;   // the app passes its seq
export interface ChangeSet {
  readonly seq: number;                  // monotonic per epoch, assigned by the app; the scene reports the last it took
  readonly rev: string;                  // the model it leads to (a hash can repeat; seq cannot)
  readonly changes: readonly Change[];   // atomic, in order: moved (kind: cast, play, resolve, spent, draw, discard, die,
                                         // exile, bounce, return, command, enter, token, token-gone, appear, vanish, move;
                                         // from/to zone, null out of sight), tapped, counters, stats, attached, control,
                                         // flipped, pushed, popped (resolved, countered, fizzled, unknown), attacks,
                                         // blocked, combat-over, life, poison, monarch, eliminated, count (a hidden hand,
                                         // a library), turn, phase, priority, reset (first, game, jump)
  readonly moments: readonly Moment[];   // in order, each a consecutive run of `changes`
  readonly order: "log" | "inferred";    // "log": the engine's log placed every moment that moves something
  readonly involved: ReadonlySet<SeatId>;
}
export interface Moment {                // grouped meaning (not the app's cross-renderer moment, below)
  readonly kind: "cast" | "resolve" | "sweep" | "assault" | "blocks" | "combat" | "draw" | "turn" | "life" | "other";
  readonly reading: ReadingId;           // the row that read it: sunfall, sweep, counter, elemental, resolve, land...
  readonly changes: readonly number[];   // indexes into `changes`
  readonly cause: { item: StackId | null; card: CardId | null } | null;   // null: unknown
  readonly detail: MomentDetail | null;  // a counter: what was countered, by what, what it was aimed at that stayed
  readonly seats: readonly SeatId[];
}
```

A change carries the card's look before and after (the whole `Card`, or null out of sight), so a card that appeared and
vanished inside the queue can still be shown from the change itself. Every change belongs to exactly one moment
(tested over the corpus). Ordering inside one snapshot comes from the engine's log entries when they name the cards
(a card's own entry first, then a mention in another's text); what the log does not place goes by rank (a turn, the
stack, the battlefield, combat, card state, life) before the first logged moment that ranks after it, and the set says
`inferred`. A cause the client cannot know (which of two spells killed a creature) is `unknown`, never guessed. The
bridge publishes the latest view, so a push and pop both inside one poll interval are invisible to any design; the log
shows them, and a resolution only the log saw (a STACK_RESOLVE for a card never seen on the stack) is read like one
that was. Moments are where today's card-specific readings live, as rows in one table (`delta/moments.ts`: eliminated,
Sunfall, sweep, counter, Marath's Elemental, resolve, cast, combat, assault, blocks, draw, turn, life, then `other`),
so the log and the motion agree. A first model, a new `gen`, or a view that does not carry on from the last (live.js
`jump`: the turn went back, or the log lost its last entry) is a single `reset`.

## layout: where things go

Pure, with the camera as plain data. The app computes the **table plan** from the model; `play` reads its hit groups
and the scene draws it. Nothing in layout waits on what the scene drew.

```ts
export function reservations(viewport: Viewport, mode: ChromeMode, safe: Insets): Reservations;
// { items: hand and prompt rects, each `visible` in mode "normal" (not "mulligan" or "sifting"); safe: the screen less
// its insets }. Each corner's rect grows inward by the insets. A sheet or the inspector is an overlay; it never changes
// the reservations, so opening one never moves the table.
export interface TableTemplate { seats(n: number, form: "landscape" | "portrait"): readonly SeatSlot[] }  // 4 landscape tuned
export interface Projector { project(p: V3): Point; onTable(x: number, y: number): V3 }   // pinhole math, equal to three's

export function boardOf(model: TableModel, seat: SeatId): SeatBoard;   // its permanents, as layout facts (boards(model): all)
// An Aura or Equipment on another seat's permanent is on its host's board, so every card on screen is on exactly one.

export interface SeatLayout {                     // the swap point for the opponent-board exploration
  plan(input: SeatInput): SeatPlan;
}
export interface SeatInput {
  readonly seat: SeatId; readonly board: SeatBoard;      // the seat's permanents with the facts that matter for layout
  readonly region: SeatRegion;                           // its slot, scaled; a lean-in is a bigger, lifted region
  readonly projector: Projector; readonly reserve: Reservations; readonly viewport: Viewport;
  readonly involved: ReadonlySet<CardId>;                // cards acting now leave their piles
  readonly memory: LayoutMemory | null;                  // the previous plan: kept places, held rows
}
export interface SeatPlan {
  readonly units: readonly Unit[];                       // card, pile or summary, each with placement, look, members in order
  readonly home: ReadonlyMap<CardId, UnitId>;            // every permanent → exactly one unit
  readonly memory: LayoutMemory;
}

export function tableInputOf(model: TableModel, o: TableInputOptions): TableInput;
// viewport, safe, mode, memory, settling, involved (a combat draft's cards, as ids: never play's types); the app and
// the workbench plan the corpus alike through it
export function planTable(input: TableInput): TablePlan;          // seats, plates, the stack at rest
export interface TablePlan {
  readonly rev: number;                                  // changes when placement or membership changes
  readonly viewport: Viewport; readonly projector: Projector; readonly reserve: Reservations;
  readonly seats: ReadonlyMap<SeatId, SeatPlan>; readonly memory: ReadonlyMap<SeatId, LayoutMemory>;
  readonly hits: HitGroups;                              // what a tap can reach, for play and the scene's picker
  readonly stack: readonly StackAtRest[];                // top first: key, card, quad, reachable
  readonly stackUp: readonly StackAtRest[];              // the stack as the focus: held up in the middle, read
  readonly violations: readonly Violation[];             // limits still broken after every retry
}
// layout/focus.ts: a lean-in (one seat's page lifted over the middle, squared to me) and a sift (a pile's cards fanned
// in front of the camera), computed from the committed plan, so the scene draws them without a new plan
export interface HitGroups {
  readonly rev: number;                                  // changes when any group's members or their order change
  readonly groups: readonly HitGroup[];                  // id, kind (card, pile, well, summary, plate, zone, stack),
                                                         // seat, members in order, quad on screen, draw order
  readonly up?: readonly HitGroup[];                     // the stack as the focus: a group per card it shows, at its
}                                                        // stackUp quad, over the whole table, top nearest
// A group's id is stable for as long as the unit lasts (its first card's id and kind, as today's piece keys).
export function hitTest(plan: TablePlan, p: Point): HitGroup | null;
```

Guarantees: a seat plan is sealed only if its units' members are disjoint and together are exactly the seat's
permanents (`home` is derived from the units, not trusted); a board too big for its region folds into summary units
that open a sift. Every group but a plate needs a 44×44 CSS px tappable patch, at every viewport: floors scale
with the design unit, the target never does. `planTable` audits the composed table at rest in draw order (every seat,
cards acting standing where they are drawn, and the stack; the clash apart, over it): floors, the tappable patch
inside the safe area and off visible chrome, nothing covering a card's name, foot or most of its face. It folds harder
where seats collide or the stack covers them, down to a last resort that is always reachable: the whole seat as one
summary that opens a sift. The stack stands in the open middle the pages leave, the mats parted all the way for it; an entry with no room there
(`no-room`), off the safe area (`off-screen`) or without a patch of its own is not `reachable`: it has no hit group, a
sheet offers it, and the plan reports the violation. As the focus, the top never stands under its floor: past what
fits, the cards under it overlap further (each keeping a finger's strip), then the deepest lie under the last one shown.
While the focus is up the stack is reached through `hits.up`, so every card it shows is tappable, even one with no room
set aside; the focus clears what the stack aims at and the chrome, or reports `focus-covers`. Portrait viewports, planned with the landscape template, still
break limits on dense boards.

**Combat** is the gathering's (`layout/arrange/gathering.ts`, every table), in one of two forms
(`TableInput.combatForm`; absent, `combatFormOf`). **The clash**, when I am attacked or my attackers are blocked (or opponents' duels do not fit): every
fighter upright on a plane carried toward the eye, one rank of columns between the plaques and my field row's tops
(`TablePlan.fieldTop`, which it never covers: `clash-covers`), wings by defender, a blocker on its controller's side
of its attacker, at the largest step from 1.8 at which every column fits one tier, the rest in a "more" column. Its
fighters, brand slots (`slot:<attacker>`, reaching the attacker) and "more" (`clash:more`) are reached over the whole
table; what it covers is reached once it is set aside. **The table form**: each unblocked attack I am in is a lane,
one trunk per attacking seat and defender, its attackers at home (between opponents, no lane: the attackers' light and
the defender's tally say it); each blocked fight stands as a **duel** in a row across
the middle at table size (the attacker, turned when tapped, a clasp, its blockers), the mats parted for it and the row
slid to where it needs least. A fight between opponents takes the table form by itself; duels that do not fit the
middle raise the clash (`TablePlan.crowded`, and the app's clash layer), or, set aside, stay home. `TablePlan.gathering` carries the columns, wings, plaques and extent for the
scene (one light shade, a calm ground of the page's tone under the picture, fighters above both, no lanes) and the
chrome (plaques, brands, clasps, the plates' tallies, `app/clash.ts`). They count the unblocked attackers' current
power and say "unblocked", never "damage"; once the engine reports combat damage dealt to a wing's defender (a player
or a planeswalker) by the attackers aimed at it, the plaque says what was dealt. Who is blocked is Forge's verdict. Wings stand apart, each at least a plaque wide; a defender
whose attackers all wait in "more" keeps its wing and tally.

`hitTest` picks in the audit's order: the highest draw order under the point (plates draw over everything; the rest
by depth, so the stack's top wins where its cards meet), a later group winning a tie. It is what layout tests, the
scene's `pick` and the tools use; the scene picks the poses it drew (`pickDrawn`), which at rest equals `hitTest` on the
committed plan. The app replans only when the plan key changes: gen, model rev, viewport, insets, chrome mode, the
combat draft's cards and `settling`: cards in flight between zones, while a change set the scene has not taken moves a
card or its last report said `flying`. Pages then hold their shape while cards leave them; the app replans when it turns
false, and they re-fit. The first `SeatLayout` adapter, `mat`, is
today's `fitSeat` and `fold`, ported. A new arrangement that fits `Unit` is a new adapter; one that rearranges the whole table, or sifts of hundreds of
cards, needs `planTable` work too.

**The arrangement engine** ([its design](game-arrangement-engine.md), `layout/arrange/`) replaces `SeatLayout` one
container at a time: a container's cards and space in, units, places, pick targets and attention out, with the rules
(a `Policy`) swappable and no count of rows or places assumed. Every opponent's leaf is the engine's
(`tableInputOf(model, { engine: { draw: true } })`, as the app plans; `TablePlan.leaves` holds each at rest), on the
template's no-middle leaves (`TableTemplate.leaf`: square to me, every front row on one line); my side is still `mat`'s.
At rest no middle is held back. **The parting** makes room when something rests on the middle at table size: every
engine leaf slides along its own `away` by the least step (`TableTemplate.part`, at most 0.15 card heights) that opens
it, its units, slots and memory unchanged (`posed` draws it again; the leaves' rows are laid to hold their floors and
patches parted). `TablePlan.part` says how far. No leaf goes under the chrome along the top (`topChrome`); graveyard and
exile are in the nameplate's focus, not on the leaves. The template is tuned for two to four seats: a seat out of the
game gives its room back (its nameplate a small "Out" chip).

## play: the decision controller

A pure reducer. It owns the current decision and its `StopId`, the player's draft, what lights up, the prompt and its
buttons, auto-pass and Hold, threats, busy, and the answer each act produces. Its state lives for the page: a new game,
a restart or teardown reaches it as a snapshot event, and its counters keep stops and tokens unique.

```ts
export const initial: State;                                  // opaque, JSON-serialisable
export function step(s: State, e: Event): { state: State; effects: readonly Effect[] };
export function present(s: State): { board: BoardCues; controls: Controls };   // memoised per state
export function cardsWanted(model: TableModel, d: Decision): string[];        // the names the host gates a decision on

export type Event =
  | { t: "snapshot"; at: Ms; model: TableModel | null;        // null: no view (play forgets everything)
      decision: Decision | null; continuity: Continuity; held?: boolean }  // held: parked, waiting on card data
  | { t: "hits"; at: Ms; hits: HitGroups }                    // from the app's table plan, before the prompt is shown
  | { t: "act"; stamp: Stamp; stop: StopId | null; act: Act } // null: drawn with no decision up
  | { t: "settled"; at: Ms; token: AnswerToken | null;        // from the ledger, the one way an answer is freed
      how: "applied" | "refused" | "unseen" | "superseded" | "lost"; reason: string | null }
  | { t: "working"; at: Ms; stop: StopId }                    // the bridge works on an answer this page did not send
  | { t: "link"; at: Ms; up: boolean }
  | { t: "deadline"; at: Ms; id: string };

export type Target =
  | { card: CardId } | { group: HitGroupId; members: readonly CardId[] }   // members as drawn: changed, dropped
  | { seat: SeatId } | { nothing: true };
export type Act =
  | { a: "tap"; on: Target } | { a: "drag"; from: Target; onto: Target }
  | { a: "release"; card: CardId; dy: number; pose: ScreenPose; overTable: boolean }  // a hand card let go in play
      // mode; the 90 px rule is here, and it plays only a card let go over the table (as the chrome saw it)
  | { a: "press"; button: ButtonId } | { a: "pick"; option: number } | { a: "step"; by: number } | { a: "dismiss" };

export type Effect =
  | { kind: "send"; token: AnswerToken; stop: StopId; body: AnswerRequest;
      carried: { card: CardId; pose: ScreenPose } | null }    // a released hand card, kept through an offer sheet
  | { kind: "deadline"; id: string; ms: number | null }       // null cancels
  | { kind: "toast"; text: string } | { kind: "cards"; names: readonly string[] } | { kind: "warn"; text: string }
  | { kind: "inspect"; card: CardId }                         // open the inspector; its actions are `cardActions`
  | { kind: "unclaimed" };                                    // play did not use this act: the app's default applies

export interface BoardCues {                                  // read by the scene
  readonly stop: StopId | null; readonly marks: Marks;        // option | selected | danger per card, group, seat, hand card
  readonly combat: CombatDraft | null;                        // pending attacks and blocks, drawn as lanes
  readonly handAway: boolean;
}
export interface Controls {                                   // read by the chrome
  readonly stop: StopId | null; readonly mayAnswer: boolean;
  readonly prompt: PromptView | null;                         // headline, hint, context, tone, buttons, countdown, busy
  readonly sheet: SheetView | null;                           // choosers, offers, source and colour picks, stepper
  readonly cardActions: ReadonlyMap<CardId, readonly { option: number; label: string }[]>;
}
```

Behind it, one file per kind in a table (`play/kinds/`). Selection mechanics are shared (`pick` for subsets,
multisets and ordered picks: `targets`, `choose`, `order`, `mode`; `pair` for `attack` and `block`; `amount` for
`number`); `pay` uses `pick`'s selection and owns its source disambiguation, colour choice and undo; `play`,
`mulligan` and `confirm` are their own. Whether a choice happens on the table or in a sheet is decided here, from the
decision and the hit groups' ordered members (which members are options, whether a pile holds unlike cards, whether
its other members are tapped), exactly as today's rule does; an open draft keeps its mode while the plan's motion
changes nothing it depends on. An unknown kind gets the generic sheet and a `warn`. It is total over input and timers:
a stale act, deadline or settlement is a no-op, and a kind that throws on one is reported as a `warn` with the state
unchanged. A snapshot it cannot reduce throws, to the app's ingest-fault path, rather than keep the new table with the
old decision. It keeps at most one answer in flight per stop, and for a spectator (`mayAnswer: false`) shows the
prompt's headline with no buttons and never sends.

## narrative

```ts
narrate(s: narrative.State, changes: ChangeSet, model: TableModel): narrative.State;  // one change set's story
release(s, upTo: number | "all"): narrative.State;  // the scene has played the sets up to `upTo` (or cut past them)
recapped(s, recaps, model); dismissRecap(s); toast(s, text, level, at); expire(s, id); restart(s);
logStripView, logSheetView, recapView, lossReport, watching   // what the chrome and the prompt show
```

`narrative/` tells the game as the old client did (live.js `recordLog`, `feed`, `noteLosses`, `status`'s watching).
Pure, with no clock, it is part of `AppState`. Each change set the app queues is narrated as it is queued: Forge's new
log lines under the turn's heading, a result read from the zones ("Serra Angel went to the graveyard"), and my
permanents gone on someone else's turn (the losses). What must be seen before it is told (those lines, the losses, the
cards coming into my hand, a spell on its way to the stack) waits on a **notice** for that set, which also gives the
prompt its watching headline in game terms ("Atraxa attacks", "Swords to Plowshares resolves"; on the way to the stack,
the line the prompt will ask with) while it waits.

The app releases notices by what the scene reports: up to the newest set it has taken once it is idle, or the one
before while it still moves; everything on a cut it draws (a first snapshot, a new game, a rewind, an overflowing
queue); up to a cast's set when its moment lands; and the sets a recap speaks for (compressed, collapsed or cut past
unseen), whose losses are noted too. A new game, a restart or teardown starts the story again (`restart`); ids keep
rising. The app's own toasts live here as well, each with its `app/notice:<id>` deadline.

The chrome shows the strip at the top left (the turn and at most two lines), the log ("What happened") and the loss
report ("What you lost") as focus layers, the loss notice in the prompt until the turn ends or it is dismissed, and, from
play, the stack summary (two or more items, a numbered line each) in the context's place while the stack layer is up. Everything is bounded (`LOG_KEPT` and the
other `*_KEPT` limits in `narrative/index.ts`).

## scene: the table

**Data in, a report out.** The app hands it a whole frame each commit; it draws and says what happened.

```ts
export interface Scene {
  ready(): Promise<void>;                         // three loaded, fonts ready
  show(frame: SceneFrame, now: Ms): SceneReport;  // consume changes, retarget, step the animator to `now`, draw
  inspect(): SceneSnapshot;                       // plain data for tests, debug and the recorder: actors, targets, flights
  pick(p: Point): HitGroup | null;                // layout's hitTest on the committed plan
  dispose(): void;
}
// createScene({ canvas, viewport, dpr, camera?, assets?, art?, reducedMotion?, wake? }): `wake` asks the owner for a
// frame when the scene changed on its own (a restored context, art a face waited for)
export interface SceneFrame {
  readonly model: TableModel; readonly plan: TablePlan; readonly changes: readonly ChangeSet[];   // in order
  readonly mode: "animate" | "cut"; readonly cues: BoardCues; readonly focus: FocusTop;
  readonly moments: readonly MomentView[];       // cards a moment carries, with their poses and owner
  readonly hover: string | null; readonly commit: CommitId;  // the hit group under a mouse pointer: its piece lifts
  readonly reducedMotion?: boolean;              // shorter moves, no stagger; never changes decision timing
  readonly highlight?: HighlightRequest | null;  // cards stepped out of the light, each with its tone (choosing targets)
  readonly zoom?: ZoomRequest | null;            // the camera composed on a hit group or a seat's page; null: the table's
}
export interface SceneReport {
  readonly active: boolean;                      // anything moving: keep the loop running
  readonly consumed: string | null;              // the newest change set rev it has taken
  readonly consumedSeq: number | null;           // and its seq: the app drops sets up to it and hands moments over
  readonly landed: readonly MomentId[];          // moments whose flight ended this frame
  readonly stackLanding: ScreenPose | null;      // where the top stack card rests
  readonly fault: string | null;
  readonly recaps: readonly Recap[];             // must-not-miss moments compressed or collapsed this frame
  readonly flying: boolean;                      // cards between zones (moving, waiting their turn, or in a set not yet
                                                 // taken): layout's `settling`; not reflow, focus or looks
}
```

Canvas gestures are bound by the app's renderer (below, "input"), not the scene; `SceneIntent` is a stub. The table's
focus layers are ported: the stack as the focus (`TablePlan.stackUp`), a sift and a lean-in (`layout/focus.ts`). An idle
table that still moves on its own (ambient effects) says so in its report (`ambient`): the loop then draws it about 10
times a second (`AMBIENT_MS`) and still counts as settled, so a recorder's virtual clock is not held up by it.

**Highlight** steps cards out of the physical light: each rises a little toward the eye (a tap reaches it where it rose),
its face is drawn flat and unlit, a thin halo rings it in its tone's colour (ember mine, blood a threat, gold a spell),
and one scrim dims the rest; each card eases out and back on its own over 200 ms (cut under reduced motion), and lifted
cards keep throwing shadows onto the dimmed table. Drawn over the rest, a highlighted card is also reached first by a
tap. The stack as the focus brings its own (its spells and what they aim
at); the app asks for the rest (`highlight`: choosing targets). Each moment's look (dim, lift, flat, halo) is a theme
token (`materials.highlight`).

**Zoom** is a composed camera move, never navigation: `zoom` names a subject and the camera eases onto it (lower and
from the right, so cards show their thickness and shadows) and back to the table's when it is gone. Picking stays right
under it: a tap reaches the piece a ray through the zoomed camera meets, by its identity (what stands above the scrim
first; with a sift open, only its cards), and a ray that meets none reaches nothing. A seat's page is found and framed
where it is drawn (a lean-in raises it). For now it is a trial (`?zoom`: a long press on a card, a pile or a seat's page
zooms; then any input, a tap, a button or Escape, only comes back, and nothing reaches play until the scene has drawn
the table's camera again).

Inside, the **stage** turns frames into motion:

- `describe` (pure) turns the plan, the cues and the focus into targets: every piece with a pose and look, a structural
  `form` key (rebuild when it changes) and a cheap `mods` key (tapped, counters, marks: patched in place), and a
  **departure** for each card that left (to a pile, to the permanent it becomes, to the hand, or nowhere with a
  visible flare).
- **Ordering is one table** (`causality.ts`) keyed by the changes: phase 0 the stack acts, phase 1 battlefield
  departures, phase 2 reflow and rejoins; cohorts stagger cards bound for the same place.
- **The backlog** is bounded: change sets are consumed in order (by `seq`); when more than two are waiting, or the
  oldest is over 1.5 s old, the older ones are played compressed (shorter, no stagger); past eight waiting or 3 s, all
  but the newest collapse into a cut to the newest model. A moment the player must not miss (a sweep, an elimination,
  something of theirs lost or targeted) that gets compressed or collapsed is reported as a recap, which the app logs and
  keeps for the loss notice. The app's own queue holds at most 24 sets; past that the oldest go, the next commit cuts,
  and the app recaps the must-not-miss moments of every set the cut skips. Nothing is dropped without a trace.
- **Piles show what has arrived.** A pile's displayed members (its count and what its sift shows) lose a card when it
  leaves and gain one when it lands; a cut, a cancelled flight or a flight past its time limit (2 s) settles both to
  the model at once.
- The **reconciler** creates, patches or swaps three.js objects by piece id and form, starting every new object from
  the current pose: nothing teleports except a cut. Interruption depends on the transition: a cut is immediate; a
  reflow or focus move retargets at once from where it is; a flight whose destination merely moved follows it; a
  flight between zones (to the stack, a graveyard, exile, the hand) that is past a third of its way finishes before a
  newer target, unless that target is a cut.
- The **animator** moves each channel (position, yaw, tilt, scale, fade, lift, tap, glow) toward its target by a rule
  chosen from the cause: eases with known durations for bounded moves, springs only for pointer-steered ones, paths
  for flights and combat steps. Its only time is `show`'s `now`. Reduced motion shortens and drops stagger; it never
  changes decision timing.
- Laws, tested over the corpus: every card in the model is drawn or counted in exactly one piece at rest; every card
  that left has exactly one departure; a cut leaves nothing in flight, but for a card the chrome held: a cut hands it off
  and it flies from its carried pose.

**Resources.** The three.js host (`scene/three/`) is the only code importing three. It owns every GPU resource and is
given a viewport and a device pixel ratio (it never measures the page): `Host` makes the renderer (ACES tone mapping
and soft `PCFShadowMap`), the composer (same DPR as the renderer up to 2×, with two samples below 2× and one at
2×), the camera from layout's `CameraSpec` through `cameraParams`/`applyCamera` (so the camera equals
the projector; a test holds them equal), the base world (the tome, one warm spot lamp whose shadow map falls on the tome,
the pages and the cards, a hemisphere fill and a faint room reflection), the shared geometry, and the `Painter` facade.
The table is physical: cards are lit card stock at their true thickness (0.3 mm; a pile's height is its count), with a
faint paper grain, contact shades where they meet the page; the tome's texture paints no lamplight of its own. A card
lifted off the table (the combat gathering, a lean-in) takes the lamp as it would on the table there, and its mirror of
the lamp fades as it rises (`liftExposure`), so nothing lifted toward the lamp blows out; a behaviour spec holds a
gathered card's face within a fifth of its brightness at rest.

**Drawn together.** A card in the scene graph is a proxy (pose group, the body the tap turns, an invisible outline the
audit measures and raycasts); each frame the host's `CardDeck` gathers the shown proxies into instanced meshes, one per
face-atlas page, layer and pass, with each card's look (tapped, dim, flat, rim signal) as instance data. Faces are copied
from their painted canvases into layers of array textures (`FaceAtlas`, 32 faces a page), so cards wearing different
faces still draw together; a new face reuses the room of one nobody shows before the atlas grows, and pages showing
nothing go past its budget (`BUDGETS.faces`); a block of cards is the same slab stretched to its height. Flat sprites (contact shades,
pools, glows, halos) marked `batched` are drawn the same way by `DecalBatch`. Magic carries its own soft falloff in the
sprite textures and card rims. The shadow map is drawn again only when
something that throws a shadow moved, came or went. The turn-15 table draws in about 60 calls, post-processing included
(`workbench.html?only=render` times it: below, "Budgets"). The bench draws at 1180 × 820 CSS px and scrolls on narrower
screens. It also times the earlier 1.5× composer settings and other variants through the host's `setQuality`.
Painted textures are leased by content key (`TextureCache`): reference-counted by the pieces showing them, and, once
unreferenced, kept in an LRU bounded by an estimated byte budget (`ByteCache`, pure, in `scene/resources/`: 160 MB of
textures, 64 MB of decoded art, `BUDGETS` in `host.ts`); evicting disposes the texture and releases the canvas pixels.
The lifted stack's printed face keeps its decoded image dimensions in that texture cache.
Live leases are never evicted, so a board larger than the budget overshoots rather than flickers. Decoded art is an
`ImageBitmap` cache (`ArtCache`) bounded the same way, with an injected loader. A bitmap is needed only to paint: a
face or plate already painted with its art keeps that texture (`paintedFace`) even after the bitmap is evicted, so art
is never loaded again for nothing, and fresh art is held until the next frame has painted what waited for it. Rim colours are shared `Color`s the
host's `Rim` breathes once per `render(now)`; the deck reads them into each card's instance data as it draws.
Composer targets are resized with the viewport and disposed with the host.

**Context loss.** `webglcontextlost` is prevented and drawing stops; on `webglcontextrestored` the host disposes every
resource and cache, rebuilds renderer-side objects and calls the owner's `onRebuild`, which re-describes the scene from
the latest state (a cut, nothing in flight). Verified in the workbench with `WEBGL_lose_context`.

Layout inputs (membership, tapped, power and toughness, sizes, reservations, focus, viewport) recompute the
plan, because tapping reorders mana wells and changes a standee's footprint; paint-only inputs (marks, hover, counter
badges) patch pieces without a new plan.

## chrome: the HTML layer

Preact components rendered from `chromeView(state)`: the prompt and its buttons, the hand, sheets and choosers, the
inspector, the log, the mulligan, menus, toasts, the back bar and the stack chip. Components lay out inside `reserve`
and never measure the scene. The hand's physics live in `chrome/frame/`, stepped by the commit.

Acts are stamped in `chrome/renderer.tsx`. A control pressed with a pointer answers the control, option and stop it
went down on: its act carries the stop and commit drawn at pointerdown, and if the control under the pointer has
changed by the release (another button or option, or another stop) the press sends nothing. A control activated from
the keyboard (Enter or Space) acts on what is drawn now. A hand gesture carries the stop and commit drawn when it was
pressed, so a card held through a new decision is let go under the old stop and play drops it. A release says whether
it was let go over the table (on screen, outside the hand's and the prompt's reserves).

## input, focus and access

`input/` turns pointer events into gestures with one set of thresholds (tap, hold to peek at 380 ms, drag after 10 px,
swipe; a hand card's play mode when it moves up more than sideways), tracking pointer ids and capture, with mouse
extras (hover, wheel). Each renderer runs it over its surface and stamps what it reports. On the canvas (bound by
`app/renderer.ts`) a gesture captures the commit, the stop and the hit group under the press at pointerdown; a drop's
target is what is under it at release. A mouse with no button down reports the hit group under it as `hover` when that
changes (null when it leaves the canvas or presses; a touch never hovers): the app keeps it and the scene lifts that
piece a little, with no replan. Taps, drags and hover are wired; hold and the wheel are not yet.

**Focus** is one stack of typed layers, top last (`app/focus.ts`): the table's own (the stack, the clash, a lean-in, a sift)
always under the chrome's (play's sheet, the inspector, the mulligan, the Game menu, the hand's list, the log, the loss
report); a new layer goes on top of its tier, one of each. An entry carries its subject (the inspector's card, a
lean-in's seat, a sift's group) and the control keyboard focus returns to when it goes (the chrome's `data-fk`). The app
keeps it in step with what its layers stand for (`sync`): a `sheet` entry while play presents a sheet, the mulligan
while one is asked, and the stack layer for every new stack (a new item brings it up again, even set aside) until the
stack empties; and the clash while the combat raises it. The combat itself is remembered for its lifetime, a game's
turn and Forge's combat ordinal while the engine shows a combat in a combat step, whatever its fighters or form do
meanwhile (`CombatMemory`: the order the clash first stood its attackers in, and whether it wants the clash); it ends with the
combat, a jump to the main phase included, and takes the clash and its chip with it. Play keeps its choice draft
and whether its sheet may close.

One rule for every way out, Escape, a tap outside (a sheet's scrim, an unclaimed tap on the table) and the ✕: the top
layer goes (`dismiss`). The stack layer, the clash and the mulligan are set aside rather than closed, and a chip
restores them (a tap on the stack does too; the clash stays aside for that combat, in the table form). While the clash is
up an unclaimed tap on a fighter reads it and anywhere else sets the clash aside; a `sheet` on top asks play, and with nothing open play hears the dismiss. Opening is the
player's own: play's `inspect`, a tap play left on a hand card or a lone card (a sifted card is the card itself: its
hit group, `sift:<card>`, is aimed at as the card), the Game button, View hand, the log strip, and the loss notice or
the log's losses line. A tap play left on a pile, a well or a summary of more than one card, or on a graveyard or exile
with cards in it, opens its sift (the stack set aside first), unless a sift is on top; on another seat's plate it leans
in on that seat, and a second tap sits back (not while sifting). A sift goes when its group leaves the plan's hit groups,
and opening or closing one replans (the chrome's mode is `sifting`). An answer sent closes the inspector and the hand's list, and a new stop the
inspector. The scene is handed the top entry and its subject (`focusTop`; the log and the loss report are sheets to it),
and `table`: every table layer open, bottom first, whatever chrome layer is over them, so the table keeps the look of
its topmost (the stack stays dimmed under a sheet).
The chrome draws the modal layers in the stack's order, each over the one below, with everything under the top inert
(play's sheet, the lowest, keeps the fan over it); a layer that comes up takes keyboard focus, and one that goes gives
it back to its control.

**Keyboard and assistive access** go through the same acts as touch: chrome controls are buttons (Enter or Space acts on
what is drawn now), hand cards take keys, Escape dismisses, and the prompt's List opens every option of the current
decision as a sheet. Reduced motion is the page's `prefers-reduced-motion` (`platform/motion.ts`), read at start and
followed as it changes; the scene gets it in its frame and shortens its moves; decision timing never changes with it.
Not yet: arrow keys moving a focus ring over the board's hit groups (announced through a live region, Enter tapping).

## Moments across both renderers

A **moment** is work that starts in one renderer and ends in the other: a card cast from the hand, a drawn card flying
into the hand, a refused cast going back. The app holds each moment's state; each renderer draws its part.

```ts
interface Moment {
  readonly id: MomentId;
  readonly key: { gen: number; stop: StopId; option: number; card: CardId };   // what was sent
  readonly from: ScreenPose;                     // rect, rotation and scale when the chrome let go
  readonly owner: "chrome" | "scene";            // who draws the card this commit
  readonly end: null | "landed" | "returned" | "abandoned";
}
interface ScreenPose { readonly rect: Rect; readonly rotation: number; readonly scale: number }
```

For a cast: play mode lifts the card (chrome physics). On release, `play` applies today's rule (90 px up: one play
sends, several open the offer, none toasts); the release carries the card's pose, which an offer keeps until a play
is chosen or the offer closes. Only when an answer is sent does the app open a moment with that pose; the chrome
keeps drawing the card, held where it was let go. The snapshot that first shows the card anywhere but the hand (the
stack, the battlefield for a land, a graveyard, exile) notes the change set that brings it; the card stays the chrome's
until the scene reports it has consumed that set. In that commit the scene starts the piece from the carried pose and
the chrome stops drawing it: ownership passes **in the same commit**. It ends `landed` when the scene reports the
flight ended (backstop: 3 s after the handover). If the answer is refused or lost, a new decision arrives with the card
still in the hand, it returns to the hand (`returned`); if the table is cut, it vanishes (`abandoned`). A card still
held when the game ends, or 120 s after it was sent, returns if it is in the hand and vanishes otherwise. Mana abilities are tapped on the
table, never released from the hand, so they open no moment. A resize while held re-anchors the pose to the hand's new
place: the chrome reports the poses it now draws (`ChromeReport.carried`) and the app moves the moment's `from` there,
so the scene's flight sets off from where the card is drawn. Every moment ends exactly once, and whatever waited on it (a notice) is released then.

## theme

`theme/` holds Grimoire: `tokens.ts` (colours, seat colours by place, signals, fonts, motion timings, mana and FX palette),
`css.ts` (the custom properties generated from the tokens: `cssText`, `installCss`), and `grimoire/`: canvas painters
(card face and back, plates, signs, tags, chips, halos and shades, pages, the tome), material and light parameters
(`materials.ts`, every tuned number named: the card stock, the lamp and its shadows, each highlight's look, the zoom's
composition) and the surfaces the painters fill with. The scene and chrome read the theme;
nothing else does; theme imports nothing.

**Painters are pure functions of an explicit description and an explicit canvas**: `paintFace(canvas, spec, env)` with a
narrow `FaceSpec` (not the model's `Card`; model maps to it), an `env` holding the baked `Surfaces` and a decoded-art
lookup, no globals and no randomness (page edges and foxing use a seeded generator). `faceKey(spec)` is the cache key:
equal looks, equal keys, whatever the field order. Art enters a spec as a url only once it is decoded, so a face repaints
when its art arrives. Fonts must be loaded first (`fontsReady`). Seat colours are keyed by place (near, left, across,
right), never by player. The baked textures (vellum, bronze, tome, frames) live in `theme/grimoire/tex/`; `tex.ts`
names them and only the scene's loader imports it. Its interface grows only when a second theme needs something to vary.

## debug and tools

The app installs `window.__deckmaster` (`app/debug.ts`, whose header lists every call) and `data-audit` hooks on what
the layout audit measures. Everything it returns is plain data copied out of the app, never a reference into live
state. It offers narrow queries (`state`, `seats`, `card`, `zone`, `hits`, `stack`, `plan`, `present`, `deadlines`),
the scene's `inspect`, `pick`, per-frame `boxes`, the zoom's trial (`zoom(group)`), the layout audit's `faces` and `under` (each card face as drawn, and
what is drawn on top at a point), the host's texture and art counters (`stats`) and frame intervals
(`frames`), art preloading, and readiness: `ready` (resolves when the scene can draw, rejects when it cannot start;
mirrored as `data-ready` on `<html>`) and `settled()` (no frame wanted and no art loading: a recorder steps its clock
only then). `index.html?script` runs the same app on the scripted transport, with `script` on the surface to push
envelopes and reply to answers; `?script=<url>` first loads a scenario (envelopes, catalog, a standing reply). The
tools reach either client through `tools/behaviour/locate.js` and `Table.boot`, with no shim of the old names. The
workbench page runs scene and chrome fixtures. Preferences (the last decks chosen) are to be best-effort
`localStorage` through `platform/prefs`; reduced motion is the system's setting, not a preference.

## Budgets

Measured on an iPad from the Home Screen with the dense fixture (four seats, 40 permanents each, a stack of
four), and enforced at cutover:

| What | Budget |
|---|---|
| Frame while anything moves | 60 fps, no frame over 33 ms in a recorded game turn |
| Tap to visible response | the next frame, within 50 ms |
| `planTable` after a snapshot | 8 ms (`tools/bench-plan.mjs` measured about 1.8 ms, not on the iPad) |
| The table's frame, drawn and finished on the GPU | under 16 ms on the turn-15 table at rest, in a highlight and in flight (`workbench.html?only=render`, which sends its results to the Mac; [measurements](measurements.md)) |
| `update` per message, planning aside | 1 ms; a message that changes the plan's inputs also plans, synchronously, inside `update` |
| GPU memory after a two-hour game | flat (within 10% of the first turn) |

## Testing

| Layer | How |
|---|---|
| protocol | decoders against the captured corpus; the decision key against `game.py`'s |
| model | `modelOf` and `diff` against corpus pairs; the moment coverage law |
| layout | hard limits, inventory and `hitTest` reachability over seeded boards and every template, on a pinhole projector |
| play | event tables → cues, controls and effects for every kind; stops and time-ordering races |
| scene | `describe` laws and goldens; ordering, backlog and pile counts on a recording host with fake frames |
| app | whole sessions headless: scripted transport, fake scene and chrome; faults; epochs; the scheduler (time order and its tie rule, waking, deadlines made during a fold) |
| behaviour | Playwright on the real page: gestures in, `/api/answer` bodies and timing out; the same specs on either client (`BEHAVIOUR_CLIENT=new` for the built entry, where a test whose lane has not landed calls `pending` naming the lane); CI runs the `@cast` subset on the new entry on Chromium and WebKit ([README](../game/tools/behaviour/README.md)) |
| look | recordings and the layout audit at the end of a phase; `ENTRY=new node tools/reel.js` records on the new entry (`?script`), its audit measuring the drawn table through `__deckmaster`; `node --test "tools/*.test.js"` holds the packet's verdict |

## Adding things later

| Change | Where |
|---|---|
| A decision kind using existing interactions | one file in `play/kinds/` |
| A decision kind needing a new interaction or board affordance | `play` plus the cues it adds to the scene and chrome |
| A theme | a sibling of `theme/grimoire/` |
| An opponent-board arrangement within a seat | a `SeatLayout` adapter |
| A rule set for grouping, ordering and folding cards | a `Policy` in `layout/arrange/policies/` ([the engine](game-arrangement-engine.md) §2) |
| A table-wide arrangement | `planTable` and adapters |
| 2, 3, 5 or 6 seats, or portrait | the plan's prerequisite in [migration](game-client-migration.md) phase 3, then `TableTemplate` and `reservations`, then tuning |
| Spectators | `Viewer` from the bridge |
| Several people at one table | server-owned seat identity, per-viewer views and answer authorisation in the bridge; `Viewer` here |
| A transport beyond long polling | a `Transport` adapter, after the transport prerequisite in [migration](game-client-migration.md) phase 3 |
| A new kind of flight | a departure destination and a causality row |
