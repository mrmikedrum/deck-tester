// modelOf over every real envelope: it never throws, every card is in exactly one zone, references resolve, seats are
// stable across a game, and the change sets between consecutive envelopes partition their changes into moments.
import { describe, expect, it } from "vitest";
import { diff, modelOf, playerViewer, ZONES } from "../../src/model";
import type { TableModel } from "../../src/model";
import { catalog, corpusNames, corpusRuns, corpusSnapshot, viewerOf } from "./fixtures";
import { expectPartition } from "./laws";

const models = new Map(corpusNames.map((n) => [n, modelOf(corpusSnapshot(n), catalog, viewerOf())]));
const withView = corpusNames.filter((n) => models.get(n));
const model = (n: string): TableModel => models.get(n)!;

describe("modelOf over the corpus", () => {
  it("models every envelope with a view, and none without", () => {
    expect(corpusNames.length).toBeGreaterThanOrEqual(50);
    for (const n of corpusNames) expect(!!models.get(n), n).toBe(!!corpusSnapshot(n).view);
    expect(withView.length).toBeGreaterThan(40);
  });

  it.each(withView)("%s: every card is in exactly one zone, and the index agrees", (n) => {
    const m = model(n);
    const indexed = m.seats.flatMap((s) => ZONES.flatMap((z) => m.zone(s.id, z).map((id) => ({ id, z }))));
    expect(indexed.length).toBe(m.cards.size);
    expect(new Set(indexed.map((x) => x.id)).size).toBe(m.cards.size);
    for (const { id, z } of indexed) expect(m.cards.get(id)?.zone).toBe(z);
  });

  it.each(withView)("%s: attachments, stack sources and combatants resolve", (n) => {
    const m = model(n);
    for (const c of m.cards.values()) {
      if (c.attachedTo === null) continue;
      expect(m.cards.has(c.attachedTo), `${c.name} attached to ${c.attachedTo}`).toBe(true);
      expect(m.attachments(c.attachedTo)).toContain(c.id);
    }
    for (const s of m.stack) if (s.source !== null) expect(m.cards.has(s.source)).toBe(true);
    for (const a of m.combat?.attackers ?? []) {
      expect(m.cards.has(a.attacker)).toBe(true);
      expect(a.defending === null || m.seat(a.defending) !== undefined).toBe(true);
    }
    for (const b of m.combat?.blockers ?? []) expect(m.cards.has(b.blocker) && m.cards.has(b.attacker)).toBe(true);
  });

  it.each(withView)("%s: the perspective sits first, then the turn order, and the eliminated keep their seats", (n) => {
    const m = model(n), view = corpusSnapshot(n).view!;
    expect(m.seats[0]!.id).toBe("You");
    expect(m.seats.map((s) => s.id)).toEqual(["You", "Atraxa", "Dack", "Princess"]);
    const present = m.seats.filter((s) => !s.out).map((s) => s.id as string);
    const listed = view.players.map((p) => p.name as string);
    expect(new Set(present)).toEqual(new Set(listed));
    // the same cyclic order as the engine's turn order
    const at = present.indexOf(listed[0]!);
    expect([...present.slice(at), ...present.slice(0, at)]).toEqual(listed);
  });

  it("an eliminated viewer is still the perspective (players no longer lists me, and players[0] is someone else)", () => {
    const n = withView.find((x) => !corpusSnapshot(x).view!.players.some((p) => p.name === "You"))!;
    expect(n).toBeDefined();
    const m = model(n), present = new Set(corpusSnapshot(n).view!.players.map((p) => p.name as string));
    expect(m.seats[0]!.id).toBe("You");
    expect(m.seats.map((s) => [s.id, s.out])).toEqual(m.seats.map((s) => [s.id, !present.has(s.id)]));
    expect(m.seats[0]!.out).toBe(true);
    expect(playerViewer(corpusSnapshot(n))?.perspective).toBe("You");
  });

  it("the stack is bottom first (the wire is top first)", () => {
    const n = withView.find((x) => corpusSnapshot(x).view!.stack.length > 1)!;
    const wire = corpusSnapshot(n).view!.stack.map((s) => s.id);
    expect(model(n).stack.map((s) => s.id)).toEqual([...wire].reverse());
  });

  it("rev is a content hash: equal for equal content, different otherwise", () => {
    for (const n of withView) expect(modelOf(corpusSnapshot(n), catalog, viewerOf())!.rev).toBe(model(n).rev);
    // the model's content is the view, the game and the seating (two envelopes can differ only by their decision)
    const content = (n: string) => {
      const s = corpusSnapshot(n);
      return JSON.stringify([s.gen, s.view, s.pilots]);
    };
    for (const a of withView) for (const b of withView) expect(model(a).rev === model(b).rev, `${a} ${b}`).toBe(content(a) === content(b));
    // art arriving changes the content
    const n = withView[3]!, bare = modelOf(corpusSnapshot(n), new Map(), viewerOf())!;
    expect(bare.rev).not.toBe(model(n).rev);
  });

  it("a card with no catalog entry still models, from what the view says", () => {
    const n = withView.find((x) => corpusSnapshot(x).view!.stack.some((s) => s.source?.name === "Lightning Bolt"))!;
    const m = modelOf(corpusSnapshot(n), new Map(), viewerOf())!;
    const bolt = [...m.cards.values()].find((c) => c.name === "Lightning Bolt")!;
    expect(bolt.face).toMatchObject({ name: "Lightning Bolt", type: "Instant", cost: "{R}", catalogued: false, art: null });
    expect(bolt.face.text).toMatch(/deals 3 damage/);
    const blade = [...m.cards.values()].find((c) => c.name === "Doom Blade");
    if (blade) expect(blade.face.cost).toBe("{1}{B}");
  });
});

describe("seats are stable through each run of the corpus", () => {
  it.each(corpusRuns().map((r) => [r[0]!, r] as const))("run from %s", (_, run) => {
    const ms = run.map((n) => models.get(n)).filter((m): m is TableModel => !!m);
    for (const m of ms) expect(m.seats.map((s) => s.id)).toEqual(ms[0]!.seats.map((s) => s.id));
  });
});

describe("diff over consecutive envelopes", () => {
  const pairs = corpusRuns().flatMap((run) => {
    const ms = run.filter((n) => models.get(n));
    return ms.slice(1).map((n, i) => [ms[i]!, n] as const);
  });
  it.each(pairs)("%s -> %s: every change in exactly one moment, consecutively", (a, b) => {
    const set = diff(model(a), model(b), 7);
    expect(set.seq).toBe(7);
    expect(set.rev).toBe(model(b).rev);
    expectPartition(set);
  });
});

describe("commanders out of sight", () => {
  it("a commander the view stops showing is remembered as last seen when the last model of the game is handed on", () => {
    const name = corpusNames.find((n) => n.includes("commander-zone"))!;
    const snap = corpusSnapshot(name);
    const seen = modelOf(snap, catalog, viewerOf())!;
    const [seat, list] = [...seen.commanders].find(([, l]) => l.length > 0)!;
    const ids = new Set(list.map((c) => c.id));
    const strip = <T extends { readonly id: number }>(z: readonly T[] | null): T[] | null => z && z.filter((c) => !ids.has(c.id as never));
    const view = snap.view!;
    const hidden: typeof snap = {
      ...snap,
      view: { ...view, players: view.players.map((p) => ({ ...p, command: strip(p.command) ?? [], battlefield: strip(p.battlefield) ?? [], hand: strip(p.hand) })) },
    };
    expect(modelOf(hidden, catalog, viewerOf())!.commanders.get(seat)).toBeUndefined();
    const kept = modelOf(hidden, catalog, viewerOf(), seen.commanders)!;
    expect(kept.commanders.get(seat)?.map((c) => c.id)).toEqual(list.map((c) => c.id));
    expect([...ids].some((id) => kept.cards.has(id as never))).toBe(false);
  });
});
