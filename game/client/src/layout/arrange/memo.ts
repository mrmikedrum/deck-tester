// What does not change between plans is kept between plans: a container's rows (its geometry and keepouts, not its
// cards) and the audit of an arrangement whose drawn geometry has not changed. Pure memoization: a cached answer is
// exactly what computing it again would give, keyed by everything the computation reads, so `arrange` stays
// deterministic. Small and bounded (oldest out first).
import type { ArrangeInput, ArrCard, Container, ContainerMemory, Policy, PolicyMemory } from "./contract";
import { momentKey } from "./moment";
import { onFrame } from "./frame";
import type { Band } from "./rows";

const all: { readonly lru: Lru<unknown>; readonly rows: boolean }[] = [];

/** Forget what is kept between plans (the bench's measurements): everything, or all but the rows per container
 *  geometry (what a plan in which a leaf's cards changed still has). */
export function clearArrangeCaches(keepRows = false): void {
  for (const c of all) if (!(keepRows && c.rows)) c.lru.clear();
}

export class Lru<V> {
  private readonly map = new Map<string, V>();
  constructor(
    private readonly size: number,
    rows = false,
  ) {
    all.push({ lru: this as Lru<unknown>, rows });
  }
  clear(): void {
    this.map.clear();
  }
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, v: V): V {
    this.map.delete(key);
    this.map.set(key, v);
    if (this.map.size > this.size) this.map.delete(this.map.keys().next().value!);
    return v;
  }
}

const n = (x: number): string => x.toFixed(6);

/**
 * Everything a container's rows read: its frame, how the camera sees it (two points of the frame on screen and the
 * viewport), its poses (a row holds under each), its keepouts, floors and safe area, the card scale and design unit,
 * and the policy's bands.
 */
export function containerKey(c: Container, s: number, du: number, bands: readonly Band[]): string {
  const f = c.frame, p = c.projector;
  const a = p.project(f.anchor), b = p.project(onFrame(f, f.w / 2, f.d, 1));
  return [
    [f.anchor.x, f.anchor.y, f.anchor.z, f.across.x, f.across.y, f.across.z, f.away.x, f.away.y, f.away.z, f.normal.x, f.normal.y, f.normal.z, f.w, f.d].map(n).join(","),
    [p.viewport.w, p.viewport.h, p.pitch, p.eye.x, p.eye.y, p.eye.z, a.x, a.y, b.x, b.y].map(n).join(","),
    c.poses.map((x) => n(x.shift)).join(","),
    JSON.stringify(c.keepouts),
    JSON.stringify(c.floors),
    JSON.stringify(c.safe),
    n(s),
    n(du),
    bands.map((x) => `${x.posture}${x.markers ? "m" : ""}${x.proud ? "p" : ""}:${x.tiers.map((t) => t.id).join("+")}`).join("|"),
  ].join("#");
}

// ---- the whole arrangement, by its input ---------------------------------------------------------------------------

/** Two FNV-1a 32-bit hashes run side by side (64 bits of key): strings by their UTF-16 units, numbers as text. */
class Hash {
  private a = 0x811c9dc5;
  private b = 0x01000193 ^ 0x5bd1e995;
  str(s: string): this {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.a = Math.imul(this.a ^ c, 0x01000193);
      this.b = Math.imul(this.b ^ c, 0x5bd1e995) ^ (this.b >>> 15);
    }
    // a separator, so "ab"+"c" and "a"+"bc" differ
    this.a = Math.imul(this.a ^ 0xff, 0x01000193);
    this.b = Math.imul(this.b ^ 0xff, 0x5bd1e995);
    return this;
  }
  val(v: unknown): this {
    return this.str(v === null ? "~" : v === undefined ? "?" : String(v));
  }
  done(): string {
    return `${(this.a >>> 0).toString(36)}.${(this.b >>> 0).toString(36)}`;
  }
}

/** A string's two hashes, kept: the same names and look keys come back plan after plan. */
const STRINGS = new Map<string, readonly [number, number]>();
function strHash(x: string): readonly [number, number] {
  let h = STRINGS.get(x);
  if (h) return h;
  let a = 0x811c9dc5, b = 0x5bd1e995;
  for (let i = 0; i < x.length; i++) {
    const c = x.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15);
  }
  if (STRINGS.size > 4096) STRINGS.clear();
  STRINGS.set(x, (h = [a >>> 0, b >>> 0]));
  return h;
}

/** Folds numbers into two running hashes. */
class Mix {
  a = 0x811c9dc5;
  b = 0x01000193;
  num(v: number): this {
    // the value's bits: integers exactly, other numbers by their 32-bit float pattern and integer part
    const lo = v | 0, hi = Math.round((v - lo) * 1e6) | 0;
    this.a = Math.imul(this.a ^ lo, 0x01000193) ^ hi;
    this.b = Math.imul(this.b ^ (lo + 0x9e3779b9), 0x5bd1e995) ^ (this.b >>> 13) ^ hi;
    return this;
  }
  str(x: string): this {
    const [p, q] = strHash(x);
    return this.num(p).num(q);
  }
  opt(v: number | null): this {
    return v === null ? this.num(-0x7fffffff) : this.num(v);
  }
}

/** One card's every field. (`lookKey` already holds its name, current types and subtypes, counters, stats and
 *  keywords; the rest are here in full.) */
const cardMix = (m: Mix, c: ArrCard): void => {
  const t = c.types;
  const bits =
    +t.creature | (+t.land << 1) | (+t.artifact << 2) | (+t.enchantment << 3) | (+t.planeswalker << 4) | (+t.battle << 5) | (+c.supertypes.legendary << 6) | (+c.supertypes.basic << 7) |
    (+c.token << 8) | (+c.commander << 9) | (+c.copy << 10) | (+c.faceDown << 11) | (+c.manaSource << 12) | (+c.tapped << 13) | (+c.sick << 14) | (+(c.reach === "table") << 15);
  m.num(c.id).num(bits).str(c.controller).str(c.owner).str(c.cardKey).str(c.lookKey).str(c.name).str(c.subtypes.join(" ")).str(c.keywords.join(","));
  m.opt(c.power).opt(c.toughness).opt(c.loyalty).opt(c.defense).num(c.counters).opt(c.attachedTo).num(c.manaValue).str(c.produces.join(""));
};

/** A policy memory's content, folded record by record (its keys and values come back plan after plan, so their string
 *  hashes are kept); computed once per memory object. */
const POLICY_HASH = new WeakMap<PolicyMemory, string>();
function policyHash(p: PolicyMemory): string {
  let h = POLICY_HASH.get(p);
  if (h !== undefined) return h;
  const m = new Mix().num(p.step).num(p.page).num(p.edits);
  const rec = (r: Readonly<Record<string, unknown>>) => {
    m.num(Object.keys(r).length);
    for (const k in r) {
      const v = r[k];
      m.str(k);
      if (typeof v === "number") m.num(v);
      else if (typeof v === "string") m.str(v);
      else m.str(JSON.stringify(v));
    }
  };
  rec(p.slots as Readonly<Record<string, unknown>>);
  rec(p.lineage);
  rec(p.tops as Readonly<Record<string, unknown>>);
  rec(p.tiers);
  rec(p.bases);
  rec(p.held);
  m.num(p.folds.length);
  for (const f of p.folds) m.str(f);
  m.str(p.tidy ? `${p.tidy.turn}|${p.tidy.phase}|${p.tidy.ranking.join(",")}` : "-").str(p.seen ? `${p.seen.turn}|${p.seen.phase}` : "-");
  POLICY_HASH.set(p, (h = `${(m.a >>> 0).toString(36)}.${(m.b >>> 0).toString(36)}`));
  return h;
}

/** A memory's content hash, kept with the memory object, so feeding back the memory `arrange` returned costs little. */
const MEMORY_HASH = new WeakMap<ContainerMemory, string>();
export function memoryHash(mem: ContainerMemory | null): string {
  if (!mem) return "-";
  let h = MEMORY_HASH.get(mem);
  if (h !== undefined) return h;
  const m = new Mix().num(mem.v).str(mem.container).str(mem.selection.policy).num(mem.selection.since).num(mem.arrivals.next);
  m.num(Object.keys(mem.arrivals.seq).length);
  for (const k in mem.arrivals.seq) m.str(k).num(mem.arrivals.seq[k]!);
  for (const k of Object.keys(mem.policies).sort()) m.str(k).str(policyHash(mem.policies[k]!));
  MEMORY_HASH.set(mem, (h = `${(m.a >>> 0).toString(36)}.${(m.b >>> 0).toString(36)}`));
  return h;
}

/** Policies by identity: two policies may share an id and differ in their rules. */
const POLICY_IDS = new WeakMap<Policy, number>();
let nextPolicy = 1;
const policyKey = (p: Policy): string => {
  let n = POLICY_IDS.get(p);
  if (n === undefined) POLICY_IDS.set(p, (n = nextPolicy++));
  return `${p.id}#${n}`;
};

const ids = (s: ReadonlySet<number>): string => [...s].sort((a, b) => a - b).join(",");

/** Everything `arrange` reads, as one key: equal keys, equal arrangements. */
export function inputKey(input: ArrangeInput, geometry: string): string {
  const h = new Hash();
  const c = input.container;
  const [g1, g2] = strHash(geometry);
  h.val(g1).val(g2).str(c.id).str(c.role).val(c.owner).str(c.viewer).str(JSON.stringify(c.poses)).str(c.entry).str(JSON.stringify(c.layer)).val(c.stand.lean);
  // the cards in id order (the input's order never matters)
  const m = new Mix();
  const cards = input.cards.length < 2 || input.cards.every((x, i) => i === 0 || input.cards[i - 1]!.id < x.id) ? input.cards : [...input.cards].sort((a, b) => a.id - b.id);
  m.num(cards.length);
  for (const x of cards) cardMix(m, x);
  h.val(m.a >>> 0).val(m.b >>> 0);
  h.str(input.relations.combat ? JSON.stringify(input.relations.combat) : "-").val(input.relations.homes.size);
  const a = input.acting;
  h.str(ids(a.involved)).str(ids(a.offered)).str(ids(a.usable)).val(a.choosing);
  h.str(momentKey(input.moment)).str(policyKey(input.policy)).str(input.selection ? `${input.selection.policy}@${input.selection.since}` : "-");
  const k = input.clock;
  h.val(k.turn).str(String(k.phase)).val(k.active).val(k.settling).val(input.minEdit ?? 0).val(!!input.auditPoses);
  return `${h.done()}|${memoryHash(input.memory)}`;
}
