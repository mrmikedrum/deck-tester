// The tools' surface (docs/game-client-architecture.md, "debug and tools"): `window.__deckmaster`, a narrow, read-mostly
// handle on the running app for the recorder, the behaviour suite and a person at the console. Everything it returns is
// plain data copied out of the app: no functions, no prototypes, no reference into live state (maps and sets are copied
// as maps and sets), so nothing done to it reaches the app and nothing it holds changes later.
//   state()              the app state now, as plain data (the model's lookups are the queries below)
//   lines()              the state as text (readout.ts)
//   commit()             the last commit's id
//   ready                resolves when the scene can draw (`data-ready="scene"` on <html>); rejects when it cannot start
//                        (`data-ready="failed"`)
//   settled()            true when no frame is wanted (nothing moving, nothing queued, no deadline within a frame) and
//                        no card art is loading: a recorder steps its clock only when it is
//   redraw()             asks for a frame though nothing changed: a recorder's first frame is drawn at its clock's time
//   zoom(to)             with the zoom's trial on (`?zoom`): the camera composed on a hit group (its id) or a seat's page
//                        ({seat}), as a long press on it would; null brings the table back
//   outstanding()        what the app is waiting on from the network: card data requests out, card art loading
//   seats()              the seats, the perspective first, then in turn order
//   card(id)             a card of the model, or null; zone(seat, zone) and attachments(id) the model's card ids
//   hits()               the committed plan's hit groups (id, kind, seat, members, the quad on screen, order)
//   stack()              the stack's cards at rest, top first, with their screen rects
//   plan()               the table plan; present() play's presentation; deadlines() every timer as [id, due]
//   floors()             the committed plan's floors as the table audit holds them (layout/shape.ts), by unit id: its
//                        role, whether it is mine, the face width it measures (across the middle, unturned) and its
//                        floor, CSS px; the recorder's audit must agree (tools/behaviour/floors.spec.js)
//   scene.inspect()      the scene's snapshot (pieces, flights, backlog); null before it is built
//   scene.pick(x, y, skip?) the hit group a tap at (x, y) reaches on the committed plan, looking through the groups
//                        whose ids are in `skip`
//   scene.stats()        the host's counters: textures and decoded art (entries, live and idle bytes, loads and
//                        decodes), GPU geometries and textures, frames drawn; null before the scene is ready
//   scene.frames(reset?) frame pacing: the recent intervals between drawn frames, their count, max, and over 33 ms
//   scene.boxes()        every piece and flying card on screen now (id, kind, visible, box; a page's quad): the
//                        recorder's per-frame track
//   scene.faces()        every card face as last drawn, by piece id: its quad, width on screen, whether a stack card
//                        stands up as the focus (the layout audit, tools/reel.js)
//   scene.labels()       every label (a pile's title, a well's or a zone's sign) as last drawn: its piece, box on screen
//                        and smallest text size there (the layout audit's label checks)
//   scene.under(x, y, skip?) the piece drawn on top at (x, y) (a card, edge or label), looking through `skip`: the
//                        layout audit's cover
//   art.pending()        card art loads out (the scene's)
//   art.preload(urls)    decode these into the scene's art cache and the page's image cache (the hand's CSS art),
//                        then repaint the page's pictures decoded; resolves when every one has loaded or failed
//   script               only with `?script` (main.ts): push(envelope), reply(token, outcome, attempt?), link(up),
//                        art(names), catalog(json), decks(list, error?) (the Game menu's /api/decks), and
//                        answers(), cardRequests(), acks() as plain data
import type { Zone } from "../model";
import { seatId } from "../model";
import { designUnit, seatShapes } from "../layout";
import * as play from "../play";
import { after, now } from "../platform";
import type { CardId } from "../protocol";
import type { ScriptedTransport } from "../transport";
import type { Loop } from "./loop";
import type { InputMsg } from "./msg";
import { readoutLines } from "./readout";
import type { PageRenderer } from "./renderer";

/**
 * Plain data: maps, sets, arrays and typed arrays copied; objects copied as plain objects of their own enumerable
 * properties; functions (and symbols) left out (an array keeps the slot, as null). Shared references stay shared within
 * one copy.
 */
export function plain<T>(v: T, seen = new Map<unknown, unknown>()): unknown {
  if (typeof v === "function" || typeof v === "symbol") return undefined;
  if (typeof v !== "object" || v === null) return v;
  const known = seen.get(v);
  if (known !== undefined) return known;
  if (v instanceof Map) {
    const out = new Map();
    seen.set(v, out);
    for (const [k, x] of v) if (typeof x !== "function") out.set(plain(k, seen), plain(x, seen));
    return out;
  }
  if (v instanceof Set) {
    const out = new Set();
    seen.set(v, out);
    for (const x of v) if (typeof x !== "function") out.add(plain(x, seen));
    return out;
  }
  if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>);
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    seen.set(v, out);
    for (const x of v) out.push(typeof x === "function" ? null : plain(x, seen));
    return out;
  }
  const out: Record<string, unknown> = {};
  seen.set(v, out);
  for (const k of Object.keys(v)) {
    const x = (v as Record<string, unknown>)[k];
    if (typeof x !== "function" && typeof x !== "symbol") out[k] = plain(x, seen);
  }
  return out;
}

/** What the page installs besides the loop and renderer. */
export interface DebugExtras {
  readonly script?: ScriptedTransport;
  /** Queues the player's input (the zoom's trial, driven from the console or a recorder). */
  readonly input?: (m: InputMsg) => void;
}

/** Images kept decoded for the page's CSS (the hand's art): held so the browser keeps them. */
const kept: HTMLImageElement[] = [];

function preloadImage(url: string): Promise<void> {
  if (typeof Image === "undefined") return Promise.resolve();
  const img = new Image();
  kept.push(img);
  img.src = url;
  return img.decode().catch(() => undefined);
}

/**
 * Takes every element under `root` that shows a picture inline (the hand's art) off it and puts it back, flushing style
 * between, so the next paint records each picture afresh. A recorder preloads art after the hand first painted it; a
 * picture recorded before its image was decoded was drawn slightly differently (its edges) for as long as nothing
 * repainted it, so two recordings could differ. After this, every picture is painted decoded.
 */
export function repaintPictures(root: ParentNode): void {
  /** Style is flushed by reading it back: each change is seen, not folded away. */
  const flush = (el: HTMLElement): string => globalThis.getComputedStyle?.(el).backgroundImage ?? "";
  for (const el of root.querySelectorAll<HTMLElement>("[style]")) {
    const bg = el.style.backgroundImage;
    if (!bg || bg === "none") continue;
    el.style.backgroundImage = "none";
    flush(el);
    el.style.backgroundImage = bg;
    flush(el);
  }
}

export function installDebug(loop: Loop, renderer: PageRenderer, extras: DebugExtras = {}): void {
  const host = () => renderer.scene?.host ?? null;
  const artPending = (): number => host()?.stats().art.pending ?? 0;
  const model = () => loop.state.model;
  const script = extras.script;
  const surface = {
    state: () => plain(loop.state),
    lines: () => readoutLines(loop.state),
    commit: () => loop.state.commit,
    present: () => plain(play.present(loop.state.play)),
    ready: renderer.ready,
    settled: () => loop.settled() && artPending() === 0,
    redraw: () => loop.wake(),
    zoom: (to: string | { seat: string } | null) => {
      const z = to === null ? null : typeof to === "string" ? { group: to } : { seat: seatId(to.seat) };
      extras.input?.({ t: "zoom", stamp: { at: now(), commit: loop.state.commit }, to: z });
      loop.wake();
    },
    outstanding: () => ({ cards: loop.state.cardAsks.out.size, art: artPending() }),
    seats: () => model()?.seats.map((s) => s.id as string) ?? [],
    card: (id: number) => plain(model()?.cards.get(id as CardId) ?? null),
    zone: (seat: string, zone: Zone) => [...(model()?.zone(seatId(seat), zone) ?? [])],
    attachments: (id: number) => [...(model()?.attachments(id as CardId) ?? [])],
    hits: () => plain(loop.state.plan?.hits.groups ?? []),
    stack: () => plain(loop.state.plan?.stack ?? []),
    plan: () => plain(loop.state.plan),
    floors: () => {
      const plan = loop.state.plan, me = model()?.viewer.perspective, u = plan ? designUnit(plan.viewport) : 1, out: Record<string, { role: string; mine: boolean; width: number; floor: number }> = {};
      for (const sp of plan?.seats.values() ?? [])
        for (const s of seatShapes(plan!.projector, sp, sp.seat === me)) {
          const unit = sp.units.find((x) => x.id === s.group);
          if (unit) out[s.group] = { role: unit.role, mine: sp.seat === me, width: s.width, floor: s.floor * u };
        }
      return out;
    },
    deadlines: () => [...loop.state.deadlines.items].map(([id, d]) => [id, d.due] as const),
    scene: {
      inspect: () => plain(renderer.scene?.inspect() ?? null),
      seatAt: (x: number, y: number) => renderer.scene?.seatAt({ x, y }) ?? null,
      pick: (x: number, y: number, skip: readonly string[] = []) => plain(renderer.scene?.pick({ x, y }, new Set(skip)) ?? null),
      stats: () => plain(host()?.stats() ?? null),
      frames: (reset = false) => plain(host()?.frameIntervals(reset) ?? null),
      boxes: () => {
        const sc = renderer.scene, h = host();
        return plain(sc?.renderer && h ? sc.renderer.screen(h.camera, h.size.w, h.size.h) : []);
      },
      faces: () => {
        const sc = renderer.scene, h = host();
        return plain(sc?.renderer && h ? sc.renderer.measure(h.camera, h.size.w, h.size.h) : {});
      },
      labels: () => {
        const sc = renderer.scene, h = host();
        return plain(sc?.renderer && h ? sc.renderer.labels(h.camera, h.size.w, h.size.h) : []);
      },
      under: (x: number, y: number, skip: readonly string[] = []) => {
        const sc = renderer.scene, h = host();
        return sc?.renderer && h ? sc.renderer.under(h.camera, x, y, h.size.w, h.size.h, new Set(skip)) : null;
      },
    },
    art: {
      pending: artPending,
      async preload(urls: readonly string[]): Promise<void> {
        await renderer.ready;
        host()?.preloadArt(urls);
        await Promise.all(urls.map(preloadImage));
        if (globalThis.document) repaintPictures(globalThis.document.body);
        // On the platform clock: a recorder preloads before it freezes its virtual clock.
        while (artPending() > 0) await new Promise<void>((r) => void after(20, r));
      },
    },
    ...(script
      ? {
          script: {
            push: (envelope: unknown) => script.push(structuredClone(envelope)),
            reply: (token: number, outcome: Parameters<ScriptedTransport["reply"]>[1], attempt?: number) =>
              script.reply(token as Parameters<ScriptedTransport["reply"]>[0], structuredClone(outcome), attempt),
            link: (up: boolean) => script.link(up),
            art: (names: readonly string[]) => script.art([...names]),
            catalog: (json: unknown, error: string | null = null) => script.catalog(structuredClone(json), error),
            decks: (list: readonly string[] | null, error: string | null = null) => script.deckList(list ? [...list] : null, error),
            answers: () => plain(script.answers),
            cardRequests: () => plain(script.cardRequests),
            acks: () => plain(script.acks),
            backlog: () => script.backlog,
          },
        }
      : {}),
  };
  Object.assign(globalThis, { __deckmaster: surface });
  renderer.ready.then(
    () => {
      document.documentElement.dataset["ready"] = "scene";
    },
    () => {
      document.documentElement.dataset["ready"] = "failed"; // the cause is the app's fault notice
    },
  );
  document.documentElement.dataset["ready"] = "app";
}
