// Hand-made and seeded cards for the arrangement engine's tests: ArrCards built directly (the model's mapping is
// classify.test.ts's), the across leaf as a container, and a call with sensible defaults.
import { arrange } from "../../../src/layout/arrange/solver";
import { leafContainer } from "../../../src/layout/arrange/leaf";
import { readyTapped } from "../../../src/layout/arrange/policies/ready-tapped";
import { NO_ACTING, NO_RELATIONS } from "../../../src/layout/arrange/contract";
import type { Acting, ArrCard, ArrangeInput, ArrangeResult, Clock, ContainerMemory, FramePose, Policy, TypeSet } from "../../../src/layout/arrange/contract";
import { REST } from "../../../src/layout/arrange/moment";
import type { Moment } from "../../../src/layout/arrange/moment";
import { pinhole } from "../../../src/layout/projector";
import { tableTemplate } from "../../../src/layout/template";
import type { CardId, SeatId, Viewport } from "../../../src/layout/types";
import { prng } from "../boards";

export const THEM = "ana" as SeatId;
export const ME = "you" as SeatId;
export type Kind = "creature" | "land" | "artifact" | "enchantment" | "planeswalker" | "battle" | "rock";

let next = 1;
export const resetIds = (n = 1): void => {
  next = n;
};

export interface Spec {
  readonly id?: number;
  readonly name?: string;
  readonly kind?: Kind;
  /** Extra current types (an artifact creature, an animated land). */
  readonly also?: readonly Kind[];
  readonly subtypes?: readonly string[];
  readonly power?: number;
  readonly toughness?: number;
  readonly loyalty?: number;
  readonly tapped?: boolean;
  readonly token?: boolean;
  readonly commander?: boolean;
  readonly legendary?: boolean;
  readonly basic?: boolean;
  readonly keywords?: readonly string[];
  readonly counters?: number;
  readonly attachedTo?: number | null;
  readonly binds?: boolean;
  readonly controller?: SeatId;
  readonly manaValue?: number;
}

export function ac(o: Spec): ArrCard {
  const id = (o.id ?? next++) as CardId, kind = o.kind ?? "creature";
  const flags = new Set<Kind>([kind, ...(o.also ?? [])]);
  const types: TypeSet = {
    creature: flags.has("creature"),
    land: flags.has("land"),
    artifact: flags.has("artifact") || flags.has("rock"),
    enchantment: flags.has("enchantment"),
    planeswalker: flags.has("planeswalker"),
    battle: flags.has("battle"),
  };
  const name = o.name ?? `${kind} ${id}`;
  const power = types.creature ? (o.power ?? 2) : null, toughness = types.creature ? (o.toughness ?? o.power ?? 2) : null;
  const typeKey = Object.entries(types).filter(([, v]) => v).map(([k]) => k[0]).join("");
  return {
    id,
    controller: o.controller ?? THEM,
    owner: o.controller ?? THEM,
    name,
    cardKey: name,
    lookKey: [name, typeKey, (o.subtypes ?? []).join(" "), o.counters ?? 0, power ?? "", toughness ?? "", o.loyalty ?? "", [...(o.keywords ?? [])].sort().join(",")].join("|"),
    types,
    subtypes: o.subtypes ?? [],
    supertypes: { legendary: !!o.legendary || !!o.commander, basic: !!o.basic },
    token: !!o.token,
    commander: !!o.commander,
    copy: false,
    faceDown: false,
    manaSource: flags.has("land") || flags.has("rock"),
    tapped: !!o.tapped,
    sick: false,
    power,
    toughness,
    loyalty: types.planeswalker ? (o.loyalty ?? 4) : null,
    defense: types.battle ? 5 : null,
    keywords: o.keywords ?? [],
    counters: o.counters ?? 0,
    attachedTo: o.attachedTo == null ? null : (o.attachedTo as CardId),
    reach: o.binds ? "table" : "self",
    manaValue: o.manaValue ?? 3,
    produces: flags.has("land") || flags.has("rock") ? ["G"] : [],
  };
}

export const many = (n: number, o: Spec): ArrCard[] => Array.from({ length: n }, () => ac(o));

export const VP: Viewport = { w: 1180, h: 820 };
export const SUPPORTED: readonly Viewport[] = [
  { w: 1024, h: 768 },
  { w: 1180, h: 820 },
  { w: 1366, h: 1024 },
];

export function across(vp: Viewport = VP, poses: readonly FramePose[] = []) {
  const tpl = tableTemplate(4);
  return leafContainer({ id: "rest:ana", seat: THEM, viewer: ME, slot: tpl.slots[2]!, projector: pinhole(tpl.camera, vp), safe: { left: 0, top: 0, right: vp.w, bottom: vp.h }, poses });
}

export const CLOCK: Clock = { turn: 5, phase: "MAIN1", active: THEM, settling: false };

export interface Run {
  readonly cards: readonly ArrCard[];
  readonly policy?: Policy;
  readonly memory?: ContainerMemory | null;
  readonly acting?: Partial<Acting>;
  readonly moment?: Moment;
  readonly clock?: Partial<Clock>;
  readonly vp?: Viewport;
  readonly poses?: readonly FramePose[];
  readonly container?: ArrangeInput["container"];
  readonly selection?: ContainerMemory["selection"];
}

export function inputOf(r: Run): ArrangeInput {
  return {
    container: r.container ?? across(r.vp, r.poses),
    cards: r.cards,
    relations: NO_RELATIONS,
    acting: { ...NO_ACTING, ...r.acting },
    moment: r.moment ?? REST,
    policy: r.policy ?? readyTapped,
    memory: r.memory ?? null,
    clock: { ...CLOCK, ...r.clock },
    ...(r.selection ? { selection: r.selection } : {}),
  } as ArrangeInput;
}

export const run = (r: Run): ArrangeResult => arrange(inputOf(r));

const CREATURES = ["Elf", "Beast", "Angel", "Goblin", "Wurm", "Spirit", "Knight", "Drake"];
const KEYWORDS = ["flying", "deathtouch", "trample", "menace", "lifelink", "haste", "reach"];

/**
 * A seeded board of `n` permanents: lands, rocks, creatures (copies, tokens, keywords, tapped), planeswalkers, works
 * that bind the table, attachments, artifact creatures and animated lands. Deterministic in `seed`; ids from `base`.
 */
export function board(seed: number, n: number, o: { creatureLight?: boolean; base?: number } = {}): ArrCard[] {
  const rnd = prng(seed), out: ArrCard[] = [];
  resetIds(o.base ?? 1);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const cw = o.creatureLight ? 0.08 : 0.4;
  for (let i = 0; i < n; i++) {
    const r = rnd(), tapped = rnd() < 0.3;
    if (r < 0.35) out.push(ac({ kind: "land", name: rnd() < 0.7 ? pick(["Forest", "Island", "Swamp"]) : `Land ${Math.floor(rnd() * 8)}`, basic: rnd() < 0.7, tapped }));
    else if (r < 0.43) out.push(ac({ kind: "rock", name: pick(["Sol Ring", "Arcane Signet", "Fellwar Stone"]), tapped }));
    else if (r < 0.43 + cw) {
      const token = rnd() < 0.45, p = 1 + Math.floor(rnd() * 5);
      const name = token ? pick(["Beast Token", "Elf Token", "Thopter"]) : `${pick(CREATURES)} ${Math.floor(rnd() * 12)}`;
      const animated = !token && rnd() < 0.05;
      out.push(ac({ name, kind: "creature", also: animated ? ["land"] : rnd() < 0.1 ? ["artifact"] : [], power: token ? 2 : p, token, tapped, legendary: !token && rnd() < 0.1, keywords: rnd() < 0.3 ? [pick(KEYWORDS)] : [] }));
    } else if (r < 0.9) out.push(ac({ kind: pick(["artifact", "enchantment"] as const), name: `Work ${Math.floor(rnd() * 15)}`, binds: rnd() < 0.2, counters: rnd() < 0.15 ? 2 : 0, legendary: rnd() < 0.1, tapped: rnd() < 0.1 }));
    else out.push(ac({ kind: "planeswalker", name: `Walker ${Math.floor(rnd() * 4)}`, loyalty: 2 + Math.floor(rnd() * 5), legendary: true }));
  }
  if (rnd() < 0.6) out.push(ac({ kind: "creature", name: "The Commander", power: 4, commander: true, legendary: true }));
  const hosts = out.filter((c) => c.types.creature && !c.token);
  if (hosts.length > 1) out.push(ac({ kind: "enchantment", name: "Aura", attachedTo: hosts[0]!.id, subtypes: ["Aura"] }));
  if (hosts.length > 2 && rnd() < 0.5) out.push(ac({ kind: "artifact", name: "Equipment", attachedTo: hosts[1]!.id, subtypes: ["Equipment"] }));
  return out;
}
