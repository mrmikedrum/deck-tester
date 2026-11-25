/// <reference types="node" />
// Every real envelope in tests/fixtures/protocol decodes, keys match the bridge's, and ids resolve.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { answerProblem, decodeSnapshot } from "../../src/protocol";
import type { Card, Decision, Snapshot, View } from "../../src/protocol";

const CORPUS = resolve(import.meta.dirname, "../../../../tests/fixtures/protocol");

interface IndexEntry {
  readonly tags: readonly string[];
  readonly answer: {
    readonly key: string;
    readonly id: number;
    readonly answer: readonly number[];
    readonly refused?: string;
  } | null;
}
const index = JSON.parse(readFileSync(resolve(CORPUS, "index.json"), "utf8")) as {
  readonly files: Readonly<Record<string, IndexEntry>>;
};
const names = readdirSync(CORPUS)
  .filter((n) => /^\d.*\.json$/.test(n))
  .sort();
const raw = new Map(names.map((n) => [n, JSON.parse(readFileSync(resolve(CORPUS, n), "utf8")) as unknown]));

function decoded(name: string): Snapshot {
  const r = decodeSnapshot(raw.get(name));
  if (!r.ok) throw new Error(`${name}: ${r.error.summary}`);
  return r.value;
}

function cardsOf(view: View): Card[] {
  return view.players.flatMap((p) => [...(p.hand ?? []), ...p.battlefield, ...p.command, ...p.graveyard, ...p.exile]);
}

/** Everything an id on the wire may point at: cards in zones, stack items and their source cards, seats. */
function referents(snap: Snapshot): { ids: Set<number>; seats: Set<string> } {
  const view = snap.view;
  const ids = new Set<number>(view ? cardsOf(view).map((c) => c.id) : []);
  for (const s of view?.stack ?? []) {
    ids.add(s.id);
    if (s.source) ids.add(s.source.id);
  }
  // An eliminated player can still be named (a target, a defender): pilots lists every seat.
  const seats = new Set<string>([...Object.keys(snap.pilots), ...(view?.players.map((p) => p.name) ?? [])]);
  return { ids, seats };
}

const resolves = (r: ReturnType<typeof referents>, x: number | string | null): boolean =>
  x === null || (typeof x === "number" ? r.ids.has(x) : r.seats.has(x));

describe("the protocol corpus", () => {
  it("is all here", () => {
    expect(names.length).toBeGreaterThanOrEqual(50);
    expect(names).toEqual(Object.keys(index.files).sort());
  });

  it.each(names)("%s decodes", (name) => {
    const r = decodeSnapshot(raw.get(name));
    expect(r.ok ? "ok" : r.error.summary).toBe("ok");
  });

  it("covers every known decision kind but none unknown", () => {
    const kinds = new Set(names.map((n) => decoded(n).decision?.kind).filter(Boolean));
    expect([...kinds].sort()).toEqual(
      ["attack", "block", "choose", "confirm", "mode", "mulligan", "number", "order", "pay", "play", "targets"].sort(),
    );
  });

  it("every saved answer names its decision's id and key, and every accepted answer passes the engine's check", () => {
    let answered = 0;
    for (const name of names) {
      const sent = index.files[name]?.answer;
      if (!sent) continue;
      answered++;
      const d = decoded(name).decision;
      expect(d, name).not.toBeNull();
      if (!d) continue;
      expect(d.key, name).toBe(sent.key);
      expect(d.id, name).toBe(sent.id);
      if (!sent.refused) expect(answerProblem(d, sent.answer), name).toBeNull();
    }
    expect(answered).toBeGreaterThan(20);
  });

  it("decision refs align with options and point into the view", () => {
    for (const name of names) {
      const snap = decoded(name);
      const d: Decision | null = snap.decision;
      if (!d) continue;
      const r = referents(snap);
      switch (d.kind) {
        case "play":
          expect(d.refs).toHaveLength(d.options.length);
          d.refs.forEach((ref, i) => {
            expect(ref.card === null, `${name} option ${i + 1}`).toBe(d.options[i] === "pass");
            expect(resolves(r, ref.card), `${name} play ref ${ref.card}`).toBe(true);
          });
          break;
        case "pay":
        case "targets":
        case "choose":
          expect(d.refs).toHaveLength(d.options.length);
          for (const ref of d.refs) {
            // a choose may offer hidden cards (a library search): their ids are not in the view
            if (d.kind !== "choose") expect(resolves(r, ref.card), `${name} ${d.kind} card ${ref.card}`).toBe(true);
            expect(resolves(r, ref.player), `${name} ${d.kind} player ${ref.player}`).toBe(true);
          }
          break;
        case "attack":
          expect(d.refs).toHaveLength(d.options.length);
          for (const ref of d.refs) expect(resolves(r, ref.card) && resolves(r, ref.to), name).toBe(true);
          break;
        case "block":
          expect(d.refs).toHaveLength(d.options.length);
          for (const ref of d.refs) expect(resolves(r, ref.card) && resolves(r, ref.blocks), name).toBe(true);
          break;
        case "number":
          expect(d.options).toEqual([]);
          break;
        default:
          expect("refs" in d, `${name} ${d.kind} has no refs`).toBe(false);
      }
    }
  });

  it("ids in the stack and combat resolve to cards or players in the view", () => {
    for (const name of names) {
      const snap = decoded(name);
      const view = snap.view;
      if (!view) continue;
      const r = referents(snap);
      for (const s of view.stack)
        for (const t of s.targets) {
          // a card gone from the game (a token exiled mid-resolution) is still named in the item's text
          const named = typeof t === "number" && s.text.includes(`(${t})`);
          expect(resolves(r, t) || named, `${name} target ${t}`).toBe(true);
        }
      for (const a of view.combat?.attackers ?? []) {
        expect(resolves(r, a.id), `${name} attacker ${a.id}`).toBe(true);
        expect(resolves(r, a.defender), `${name} defender ${a.defender}`).toBe(true);
      }
      for (const b of view.combat?.blockers ?? [])
        expect(resolves(r, b.id) && resolves(r, b.blocking), name).toBe(true);
      for (const c of cardsOf(view)) expect(resolves(r, c.attachedTo), `${name} attachedTo ${c.attachedTo}`).toBe(true);
    }
  });

  it("only the viewer's hand is shown; others show a count", () => {
    for (const name of names) {
      const view = decoded(name).view;
      for (const p of view?.players ?? []) {
        expect(p.hand !== null, name).toBe(p.name === view?.me);
        expect(p.handCount !== null, name).toBe(p.name !== view?.me);
      }
    }
  });

  it("normalises what the engine leaves out", () => {
    const empty = decoded("005-playing-view-empty.json");
    expect(empty.view).toBeNull();
    const none = decoded("001-no-game.json");
    expect([none.gen, none.decision, none.view, none.answer, none.build, none.over]).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(none.pilots).toEqual({});
    const land = names
      .flatMap((n) => {
        const view = decoded(n).view;
        return view ? cardsOf(view) : [];
      })
      .find((c) => c.type.startsWith("Basic Land"));
    expect(land).toMatchObject({ cost: null, power: null, tapped: expect.any(Boolean), counters: {}, keywords: [] });
  });
});
