// Sample chrome views for the workbench and the tests: play's Controls as play presents them for the old client's
// fixtures (tools/fixtures/states.js `STATES.main`: turn 9, my main phase, seven cards in hand), built by hand.
import type { LogSheetView, LogStripView, LossRow, RecapView } from "../../narrative";
import type { Button, Controls, PromptView, SheetView, StopId } from "../../play";
import type { CardId } from "../../protocol";
import { reservations } from "../../layout";
import type { CardLook, ChromeView, HandCard, HandSheetView, InspectorView, MenuView, MulliganView, StackRow } from "../view";

export const STOP = "g7:d42:1" as StopId;

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/['’]/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/-+/g, "-");
const art = (name: string): string => `cache/art/${slug(name)}.jpg`;
const image = (name: string): string => `cache/card/${slug(name)}.jpg`;

const card = (id: number, name: string, cost: string | null, rules: string | null = null, playable = false): HandCard => ({
  id: id as CardId,
  name,
  cost,
  art: art(name),
  image: image(name),
  rules,
  playable,
});

/** The fixture's hand (the mocked bridge's `You.hand`), in hand order. */
export const HAND: readonly HandCard[] = [
  card(120, "Island", null, null, true),
  card(121, "Snap", "{1}{U}", "Return target creature to its owner's hand. Untap up to two lands."),
  card(122, "Arcane Denial", "{1}{U}", "Counter target spell. Its controller may draw up to two cards at the beginning of the next turn's upkeep."),
  card(123, "Frantic Search", "{2}{U}", "Draw two cards, then discard two cards. Untap up to three lands.", true),
  card(124, "Ghostly Flicker", "{2}{U}", "Exile two target artifacts, creatures, and/or lands you control, then return those cards to the battlefield under your control."),
  card(125, "Phantasmal Image", "{1}{U}", null, true),
  card(126, "Reality Shift", "{1}{U}", "Exile target creature. Its controller manifests the top card of their library."),
];

/** A crowded hand of long names (a real run's opening hand): the bunched cards' names must shrink, never break mid-word. */
export const CROWDED: readonly HandCard[] = [
  card(140, "Forest", null, null, true),
  card(141, "Forest", null, null, true),
  card(142, "Cosmic Rebirth", "{1}{G}{W}"),
  card(143, "Inspiring Call", "{2}{G}"),
  card(144, "Unbound Flourishing", "{2}{G}"),
  card(145, "Wrenn and Realmbreaker", "{1}{G}{G}"),
  card(146, "Herd Baloth", "{3}{G}{G}"),
  card(147, "Song of the Worldsoul", "{4}{G}"),
];

export const button = (id: string, label: string, more: Partial<Button> = {}): Button => ({
  id,
  label,
  tone: "secondary",
  role: null,
  enabled: true,
  detail: null,
  cost: null,
  countdown: false,
  ...more,
});

const prompt = (more: Partial<PromptView>): PromptView => ({
  where: "Turn 9 · Your main phase",
  headline: "",
  hint: null,
  context: null,
  floating: null,
  tone: "normal",
  style: "bar",
  buttons: [],
  countdown: null,
  busy: false,
  stack: [],
  ...more,
});

/** My main phase with plays on offer (the old live-main screenshot). */
export const MAIN: PromptView = prompt({
  buttons: [
    button("plays", "All plays (6)", { role: "choice" }),
    button("defer", "Auto", { role: "defer" }),
    button("pass", "To combat", { tone: "primary", role: "pass" }),
  ],
});

/** An opponent's spell aimed at my creature, nothing to answer with: auto-pass counts down, Hold stops it. */
export const THREAT: PromptView = prompt({
  where: "Turn 9 · Dack's main phase",
  headline: "Dack's Swords to Plowshares targets your Herd Baloth",
  context: null,
  tone: "threat",
  buttons: [
    button("hold", "Hold", { role: "hold" }),
    button("pass", "OK", { tone: "primary", role: "pass", countdown: true }),
  ],
  countdown: { from: 0, ms: 3200 },
  stack: [],
});

/** The strip before any turn: hidden. */
export const NO_LOG: LogStripView = { heading: "", lines: [], tone: "one" };

/** The strip on Dack's turn: the newest line. */
export const LOG: LogStripView = { heading: "Turn 9 · Dack", lines: [{ text: "Dack cast Swords to Plowshares targeting Herd Baloth", draw: false }], tone: "one" };

/** "What happened": two turns, newest first, my losses a tap away. */
export const LOG_SHEET: LogSheetView = {
  groups: [
    { heading: { type: "turn", text: "Turn 9 · Dack" }, rows: [{ type: "stack_add", text: "Dack cast Swords to Plowshares targeting Herd Baloth" }] },
    { heading: { type: "turn", text: "Turn 8 · You" }, rows: [{ type: "zone_change", text: "Drew Island" }] },
  ],
  losses: "Your losses · 1 to exile",
};

/** The loss notice and the report behind it. */
export const RECAP: RecapView = { title: "Your loss", summary: "Herd Baloth · to exile" };
export const LOSSES: readonly LossRow[] = [{ name: "Herd Baloth", fate: "went to exile", why: "Swords to Plowshares exiled Herd Baloth" }];

/** Targets on the table: one more wanted, Done disabled below the minimum. */
export const TARGETS: PromptView = prompt({
  headline: "2 targets for Ghostly Flicker",
  buttons: [
    button("list", "List"),
    button("done", "None", { tone: "primary", role: "done", enabled: false }),
    button("defer", "Auto", { role: "defer" }),
  ],
});

export const BUSY: PromptView = prompt({ headline: "…", busy: true });

/** One card's plays, offered after it was let go over the table: the card is held where it was released. */
export const OFFER: SheetView = {
  kind: "plays",
  title: "Frantic Search",
  wide: false,
  items: [
    { option: 3, label: "Cast Frantic Search", cost: "{2}{U}", detail: null, card: null, name: null, picked: false, badge: null },
    { option: 4, label: "Cast Frantic Search (Flashback)", cost: "{2}{U}", detail: "From your graveyard", card: null, name: null, picked: false, badge: null },
  ],
  stepper: null,
  buttons: [],
  carried: {
    card: 123 as CardId,
    pose: { rect: { left: 214, top: 372, right: 373, bottom: 594 }, rotation: 0, scale: 1.06 },
  },
};

export const NUMBER: SheetView = {
  kind: "number",
  title: "Choose X for Stroke of Genius",
  wide: false,
  items: [],
  stepper: { min: 0, max: 7, value: 3 },
  buttons: [button("value", "Choose", { tone: "primary", role: "done" })],
  carried: null,
};

/** A chooser of 60 pictured cards (a big graveyard or library search): far more than two rows can hold. */
const MANY_NAMES = ["Island", "Snap", "Arcane Denial", "Frantic Search", "Ghostly Flicker", "Phantasmal Image", "Reality Shift"];
export const MANY: SheetView = {
  kind: "chooser",
  title: "Choose a card to return",
  wide: true,
  items: Array.from({ length: 60 }, (_, i) => ({
    option: i + 1,
    label: MANY_NAMES[i % MANY_NAMES.length]!,
    cost: null,
    detail: null,
    card: (2000 + i) as CardId,
    name: null,
    picked: i === 3,
    badge: null,
  })),
  stepper: null,
  buttons: [button("done", "Done (1)", { tone: "primary", role: "done" })],
  carried: null,
};
export const MANY_LOOKS: ReadonlyMap<CardId, CardLook> = new Map(
  MANY.items.map((i) => [i.card!, { name: i.label, image: image(i.label) }]),
);

/** Meloku on my battlefield, with its ability on offer (the old live-inspector screenshot). */
export const INSPECTOR: InspectorView = {
  card: 130 as CardId,
  name: "Meloku the Clouded Mirror",
  image: image("Meloku the Clouded Mirror"),
  faceDown: false,
  caption: null,
  place: "near",
  owner: "You · Battlefield",
  chips: ["Commander", "2/4", "Flying"],
  related: [],
  rules: "Flying\n{1}, Return a land you control to its owner's hand: Create a 1/1 blue Illusion creature token with flying.",
  actions: [{ option: 5, label: "{1}, return a land: 1/1 Illusion token", cost: null }],
};

/** The opening hand: the fixture's seven, play's Mulligan and Keep. */
export const MULLIGAN_PROMPT: PromptView = prompt({
  headline: "Keep this hand?",
  style: "overlay",
  buttons: [button("mulligan", "Mulligan"), button("keep", "Keep 7", { tone: "primary" })],
});
export const MULLIGAN: MulliganView = {
  title: "Keep this hand?",
  cards: HAND.map((c) => ({ id: c.id, name: c.name, image: c.image })),
};

export const MENU: MenuView = {
  decks: ["blue-moon-combat-revision", "dack-cedh", "eternities-assimilation-iii", "eternities-living-worlds-iii"],
  error: null,
  last: null,
};

export const HAND_SHEET: HandSheetView = {
  cards: HAND.map((c, i) => ({ id: c.id, name: c.name, cost: c.cost, playable: c.playable, fresh: i === HAND.length - 1 })),
};

/** Two items on the stack: an opponent's removal over my creature spell. */
export const STACK_ROWS: readonly StackRow[] = [
  { id: 2, title: "Swords to Plowshares · Dack", effect: null, rules: "Exile target creature. Its controller gains life equal to its power." },
  { id: 1, title: "Phantasmal Image · You", effect: null, rules: "You may have Phantasmal Image enter as a copy of any creature on the battlefield, except it's an Illusion in addition to its other types and it has \"When this creature becomes the target of a spell or ability, sacrifice it.\"" },
];
export const STACK_SHEET: SheetView = { kind: "stack", title: "Stack rules · first to last", wide: false, items: [], stepper: null, buttons: [], carried: null };

/** A chooser of named options (no pictures): Done disabled below the minimum. */
export const WORDS: SheetView = {
  kind: "chooser",
  title: "Choose words (Test)",
  wide: false,
  items: ["Alpha", "Beta", "Gamma"].map((label, i) => ({ option: i + 1, label, cost: null, detail: null, card: null, name: label, picked: i === 2, badge: i === 2 ? 1 : null })),
  stepper: null,
  buttons: [button("sheet-clear", "Clear", { role: "clear" }), button("sheet-done", "Done (1)", { tone: "primary", role: "done", enabled: false })],
  carried: null,
};

export const controls = (p: PromptView | null, more: Partial<Controls> = {}): Controls => ({
  stop: STOP,
  mayAnswer: true,
  prompt: p,
  sheet: null,
  cardActions: new Map(),
  choosing: null,
  ...more,
});

export function view(more: Partial<ChromeView> = {}, w = 1180, h = 820): ChromeView {
  return {
    commit: 1,
    viewport: { w, h, safe: { top: 0, right: 0, bottom: 0, left: 0 } },
    reserve: reservations({ w, h }),
    controls: controls(MAIN),
    hand: { cards: HAND, away: false, respond: false, carried: [], fresh: [] },
    looks: new Map(),
    named: new Map(),
    toast: null,
    waiting: null,
    layers: [],
    plates: [],
    seatFocus: null,
    clash: null,
    chips: [],
    inspector: null,
    mulligan: null,
    menu: null,
    handSheet: null,
    stack: [],
    sift: null,
    back: null,
    newGame: false,
    stackOpen: false,
    log: NO_LOG,
    logWidth: null,
    logSheet: null,
    losses: null,
    recap: null,
    watch: null,
    restore: null,
    ...more,
  };
}
