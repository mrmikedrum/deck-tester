// @vitest-environment happy-dom
// The tools' surface hands out plain data: nothing a person or a tool does to what it returns reaches the running app,
// nothing it returns closes over live state, and the model's lookups are narrow queries that return copies.
import { describe, expect, it } from "vitest";
import { installDebug, plain } from "../../src/app/debug";
import type { PageRenderer } from "../../src/app/renderer";
import { raw } from "../play/rig";
import { rig } from "./rig";

interface Surface {
  state(): { deadlines: { items: Map<string, unknown> }; moments: { open: unknown[] }; plan: { hits: { groups: unknown[] } } | null; model: Record<string, unknown> };
  plan(): { hits: { groups: unknown[] } } | null;
  present(): { controls: { cardActions: Map<unknown, unknown>; prompt: { buttons: unknown[] } | null } };
  seats(): string[];
  card(id: number): { id: number; name: string } | null;
  zone(seat: string, zone: string): number[];
  attachments(id: number): number[];
  hits(): { id: string; members: number[]; quad: unknown }[];
  settled(): boolean;
  scene: { stats(): Record<string, unknown> | null; frames(reset?: boolean): { intervals: number[]; count: number; max: number } | null };
  art: { pending(): number };
}

/** Every function reachable from `v`, by path. */
function functionsIn(v: unknown, path = "", seen = new Set<unknown>()): string[] {
  if (typeof v === "function") return [path];
  if (typeof v !== "object" || v === null || seen.has(v)) return [];
  seen.add(v);
  if (v instanceof Map) return [...v].flatMap(([k, x], i) => [...functionsIn(k, `${path}<${i}>`, seen), ...functionsIn(x, `${path}[${String(k)}]`, seen)]);
  if (v instanceof Set) return [...v].flatMap((x, i) => functionsIn(x, `${path}{${i}}`, seen));
  return Object.entries(v).flatMap(([k, x]) => functionsIn(x, `${path}.${k}`, seen));
}

function started() {
  const r = rig();
  r.loop.start();
  r.frame(0);
  r.transport.push(raw("030-play-watching.json")); // auto-pass counts down: a live timer to protect
  r.frame(10);
  return r;
}

const noScene = { scene: null, ready: Promise.resolve(), show: () => ({ active: false, fault: null, scene: null }), dispose: () => undefined } as unknown as PageRenderer;
const surface = () => (globalThis as unknown as { __deckmaster: Surface }).__deckmaster;

describe("window.__deckmaster", () => {
  it("returns detached copies of state, the plan and the presentation", () => {
    const r = started();
    installDebug(r.loop, noScene);
    const dm = surface();
    const timers = r.state.deadlines.items.size;
    const groups = r.state.plan!.hits.groups.length;
    const buttons = dm.present().controls.prompt!.buttons.length;
    expect([timers, groups, buttons].every((n) => n > 0)).toBe(true);

    const s = dm.state();
    s.deadlines.items.clear();
    s.plan!.hits.groups.length = 0;
    dm.plan()!.hits.groups.length = 0;
    dm.hits().length = 0;
    dm.present().controls.prompt!.buttons.length = 0;
    dm.present().controls.cardActions.clear();

    expect(r.state.deadlines.items.size).toBe(timers);
    expect(r.state.plan!.hits.groups).toHaveLength(groups);
    expect(dm.hits()).toHaveLength(groups);
    expect(dm.present().controls.prompt!.buttons).toHaveLength(buttons);
    expect(dm.state()).toEqual(plain(r.state));
  });

  it("state is plain data: no functions anywhere (the model's lookups are queries of their own)", () => {
    const r = started();
    installDebug(r.loop, noScene);
    const dm = surface();
    expect(functionsIn(r.state).length).toBeGreaterThan(0); // the live model has lookups closing over its maps
    expect(functionsIn(dm.state())).toEqual([]);
    expect(functionsIn(dm.plan())).toEqual([]);
    expect(functionsIn(dm.present())).toEqual([]);
    expect(Object.getPrototypeOf(dm.state().model)).toBe(Object.prototype);
  });

  it("the model's lookups return copies", () => {
    const r = started();
    installDebug(r.loop, noScene);
    const dm = surface();
    const m = r.state.model!;
    const seats = dm.seats();
    expect(seats).toEqual(m.seats.map((s) => s.id));
    const me = seats[0]!;
    const field = dm.zone(me, "battlefield");
    expect(field).toEqual([...m.zone(m.seats[0]!.id, "battlefield")]);
    expect(field.length).toBeGreaterThan(0);
    const id = field[0]!;
    const card = dm.card(id)!;
    expect(card.name).toBe(m.cards.get(id as never)!.name);
    card.name = "changed";
    field.length = 0;
    expect(m.cards.get(id as never)!.name).not.toBe("changed");
    expect(m.zone(m.seats[0]!.id, "battlefield").length).toBeGreaterThan(0);
    expect(dm.card(-1)).toBeNull();
    expect(dm.attachments(id)).toEqual([...m.attachments(id as never)]);
  });

  it("exposes the host's counters and frame pacing, and is not settled while art is loading", () => {
    const r = started();
    let pending = 0;
    const stats = { textures: { live: 3, idle: 1, bytes: 400, idleBytes: 100 }, art: { pending: 0, decodes: 2 }, geometries: 5, gpuTextures: 4, frames: 9 };
    const host = {
      stats: () => ({ ...stats, art: { ...stats.art, pending } }),
      frameIntervals: (reset: boolean) => ({ intervals: [16, 17, reset ? 40 : 16], count: 3, max: 17, over33: 0 }),
    };
    const renderer = { ...noScene, scene: { host, inspect: () => null, pick: () => null } } as unknown as PageRenderer;
    installDebug(r.loop, renderer);
    const dm = surface();
    expect(dm.scene.stats()).toMatchObject({ textures: { live: 3, idle: 1, bytes: 400, idleBytes: 100 }, geometries: 5, gpuTextures: 4 });
    expect(dm.scene.frames()).toMatchObject({ intervals: [16, 17, 16], count: 3, max: 17 });
    r.frame(20);
    const settled = dm.settled();
    pending = 1;
    expect(dm.art.pending()).toBe(1);
    expect(dm.settled()).toBe(false);
    pending = 0;
    expect(dm.settled()).toBe(settled);
  });
});

describe("pictures repainted once art is in", () => {
  it("every element showing a picture is taken off it and put back, so the next paint draws it decoded", async () => {
    const { repaintPictures } = await import("../../src/app/debug");
    document.body.innerHTML = `<div id="ui"><div class="a" style="background-image:url(&quot;/x.jpg&quot;)"></div><div class="b"></div></div>`;
    const ui = document.getElementById("ui")!;
    const seen: string[] = [];
    const obs = new MutationObserver((ms) => ms.forEach((m) => seen.push(m.oldValue ?? "")));
    obs.observe(ui, { attributes: true, subtree: true, attributeFilter: ["style"], attributeOldValue: true });
    repaintPictures(ui);
    await Promise.resolve();
    obs.disconnect();
    expect(seen).toHaveLength(2); // off the picture, then back on it
    expect(seen[1]).toMatch(/background-image: none/);
    expect((ui.querySelector(".a") as HTMLElement).style.backgroundImage).toBe('url("/x.jpg")');
  });
});
