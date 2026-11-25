// The render study's board: the turn-15 table hand-placed in the arrangement engine's terms (one card size, S = 1.85;
// creatures standing in rows leaning back 25 degrees, the rest lying behind them; copies and lands in piles), as poses
// the three variants draw alike. Only what each variant does with a pose differs.
import { tableTemplate } from "../../layout";
import type { SeatSlot, V3 } from "../../layout";
import { faceSpec, frameKeyOf } from "../../theme";
import type { FaceSpec } from "../../theme";
import { CATALOG, SEATS } from "./turn15";
import type { StudyCard } from "./turn15";

/** One card size on the whole table (the engine's S_table at 1180 x 820). */
const S = 1.85;
/** A card in world units at that size: 63 x 88 mm. */
export const CW = 0.716 * S;
export const CH = S;
/** One millimetre in world units (a card is 88 mm tall). */
const MM = CH / 88;
/** A real card's thickness, about 0.3 mm. */
export const THICK = 0.3 * MM;
/** A presented card leans back this far from upright (the engine's LEAN). */
const LEAN = (25 * Math.PI) / 180;
/** A tapped lying card turns a notch clockwise (the engine's NOTCH). */
const NOTCH = (15 * Math.PI) / 180;
/** A standing card's foot is lifted a finger's width (the engine's LIFT), where its stand holds it. */
const LIFT = 0.02;

type Posture = "stand" | "lie";

export interface Piece {
  readonly key: string;
  readonly seat: number;
  /** The top card's name ("" for a library), and whether the piece is tapped. */
  readonly name: string;
  readonly tapped: boolean;
  /** The top card's face, or the back for a library. */
  readonly face: FaceSpec;
  /** Cards in the piece: 1, or a pile. */
  readonly count: number;
  readonly posture: Posture;
  /** The face's centre (a pile's top card's), and its right and up directions; the face looks along right x up. */
  readonly centre: V3;
  readonly right: V3;
  readonly up: V3;
  /** Where the piece meets the table (a standing card's foot middle; a lying piece's bottom centre). */
  readonly base: V3;
  /** +1/+1 counters, shown as a chip. */
  readonly plus: number;
  /** Show the pile's count. */
  readonly counted: boolean;
  /** A deterministic jitter seed for a pile's messiness. */
  readonly seed: number;
}

interface Frame {
  readonly anchor: V3;
  readonly across: V3;
  readonly away: V3;
}

const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
const madd = (a: V3, b: V3, k: number): V3 => v3(a.x + b.x * k, a.y + b.y * k, a.z + b.z * k);
const UP = v3(0, 1, 0);

/** The engine's slot frame: anchored at the seat's fixed edge, rows laid away from it. */
function slotFrame(slot: SeatSlot): Frame {
  const c = Math.cos(slot.yaw),
    s = Math.sin(slot.yaw);
  const across = v3(c, 0, -s),
    away = v3(-s, 0, -c);
  return { anchor: madd(v3(slot.x, 0, slot.z), away, -slot.d / 2), across, away };
}

const onFrame = (f: Frame, u: number, v: number, h = 0): V3 =>
  madd(madd(madd(f.anchor, f.across, u), f.away, v), UP, h);

const ART = (url: string): string => url;

/** The face a card wears, as the game maps it (scene/stage/faces.ts), from the study's catalog. */
export function faceOf(
  card: Pick<StudyCard, "name" | "tapped" | "token" | "commander" | "power" | "toughness">,
  far: boolean,
): FaceSpec {
  const e = CATALOG[card.name];
  if (!e) throw new Error(`the study's catalog lacks ${card.name}`);
  const land = /\bLand\b/.test(e.type);
  const creature = /\bCreature\b/.test(e.type);
  const walker = /\bPlaneswalker\b/.test(e.type);
  const foot: FaceSpec["foot"] = creature
    ? {
        kind: "creature",
        power: card.power ?? e.power ?? 0,
        toughness: card.toughness ?? e.toughness ?? 0,
        basePower: e.power ?? 0,
        baseToughness: e.toughness ?? 0,
      }
    : walker
      ? { kind: "walker", loyalty: e.loyalty ?? "" }
      : land
        ? { kind: "land", mana: e.produces ?? [] }
        : { kind: "type", typeLine: e.type };
  return faceSpec({
    name: card.name,
    frame: frameKeyOf({ token: card.token === true, land, colours: e.colors }),
    token: card.token === true,
    commander: card.commander === true,
    tapped: card.tapped === true,
    far,
    art: ART(e.art),
    text: e.text,
    foot,
    keywords: e.keywords ?? [],
  });
}

const BACK = faceSpec({ name: "", down: true });

interface Item {
  readonly cards: readonly StudyCard[];
  /** A library: face down. */
  readonly back?: boolean;
  /** Cards in a pile when they are not all listed (a library, a graveyard). */
  readonly count?: number;
  /** A graveyard's top. */
  readonly top?: string;
}

const one = (c: StudyCard): Item => ({ cards: [c] });

export interface Board {
  readonly pieces: readonly Piece[];
  /** Named spots for the close views and the focus: a land pile, the creature row, the target. */
  readonly spots: Readonly<Record<"lands" | "creatures" | "target" | "across", V3>>;
}

/** Lay the board out. */
export function studyBoard(): Board {
  const template = tableTemplate(4);
  const pieces: Piece[] = [];
  let seed = 1;
  const spots: Record<"lands" | "creatures" | "target" | "across", V3> = {
    lands: v3(0, 0, 0),
    creatures: v3(0, 0, 0),
    target: v3(0, 0, 0),
    across: v3(0, 0, -8),
  };

  SEATS.forEach((seat, si) => {
    const slot = template.slots[si];
    if (!slot) return;
    const f = slotFrame(slot);
    const far = si !== 0;
    const by = new Map(seat.battlefield.map((c) => [c.name, c] as const));
    const named = (n: string): StudyCard => {
      const c = by.get(n);
      if (!c) throw new Error(`${seat.name} has no ${n}`);
      return c;
    };
    const all = (n: string): StudyCard[] => seat.battlefield.filter((c) => c.name === n);
    const isLand = (c: StudyCard): boolean => /\bLand\b/.test(CATALOG[c.name]?.type ?? "");
    const lands = seat.battlefield.filter(isLand);

    /** A row of standing cards, centred, with its feet at v; slots a card's height wide (the engine's stand slot). */
    const standRow = (v: number, cards: readonly StudyCard[]): void => {
      const slotW = CH;
      cards.forEach((c, i) => {
        const u = (i - (cards.length - 1) / 2) * slotW;
        const foot = onFrame(f, u, v, LIFT);
        // Square across the frame, leaning back toward `away`.
        const lean = madd(v3(0, Math.cos(LEAN), 0), f.away, Math.sin(LEAN));
        // A tapped card standing turns a quarter clockwise in its own plane: its long edge on the stand, its top to the
        // right. The face still looks the same way (right x up is unchanged).
        const right = c.tapped ? v3(-lean.x, -lean.y, -lean.z) : f.across;
        const up = c.tapped ? f.across : lean;
        const tall = c.tapped ? CW : CH;
        const centre = madd(foot, lean, tall / 2);
        pieces.push({
          key: `${seat.name}:${c.id}`,
          seat: si,
          name: c.name,
          tapped: c.tapped === true,
          face: faceOf(c, far),
          count: 1,
          posture: "stand",
          centre,
          right,
          up,
          base: foot,
          plus: c.plus ?? 0,
          counted: false,
          seed: seed++,
        });
      });
    };

    /** A row of lying items centred at v: piles side by side, singles shingled at `step` (overlapping when below a width). */
    const lieRow = (v: number, groups: readonly (readonly Item[])[], step: number, gap = 0.3): void => {
      // Each group is laid at its own pitch: a pile (one item) takes a slot; a run of singles shingles.
      const widths = groups.map((g) => (g.length === 1 ? CW + 0.4 : (g.length - 1) * step + CW));
      const total = widths.reduce((a, b) => a + b, 0) + gap * (groups.length - 1);
      let u0 = -total / 2;
      groups.forEach((g, gi) => {
        g.forEach((it, i) => {
          const top = it.cards[it.cards.length - 1] ?? null;
          const count = it.count ?? it.cards.length;
          const tapped = it.cards.length > 0 && it.cards.every((c) => c.tapped === true) && !it.back;
          const turn = tapped ? NOTCH : 0;
          const u = g.length === 1 ? u0 + (widths[gi] ?? 0) / 2 : u0 + CW / 2 + i * step;
          // Shingled singles: each lies on the edge of the one before, a card's thickness higher.
          const h = g.length === 1 ? 0 : i * THICK * 1.1;
          const c = Math.cos(turn),
            sn = Math.sin(turn);
          const up = madd(v3(f.away.x * c, 0, f.away.z * c), f.across, sn);
          const right = madd(v3(f.across.x * c, 0, f.across.z * c), f.away, -sn);
          const base = onFrame(f, u, v, h);
          const face = it.back ? BACK : it.top ? faceOf({ name: it.top }, far) : top ? faceOf(top, far) : BACK;
          pieces.push({
            key: `${seat.name}:${top?.id ?? (it.back ? "library" : "grave")}:${gi}:${i}`,
            seat: si,
            name: it.back ? "" : (it.top ?? top?.name ?? ""),
            tapped,
            face,
            count,
            posture: "lie",
            centre: madd(base, UP, count * THICK),
            right,
            up,
            base,
            plus: 0,
            counted: count > 1,
            seed: seed++,
          });
        });
        u0 += (widths[gi] ?? 0) + gap;
      });
    };

    const library: Item = { cards: [], back: true, count: seat.library };
    const grave: Item = { cards: [], count: seat.graveyard, top: seat.graveTop };
    const pile = (cards: readonly StudyCard[]): Item => ({ cards });

    if (si === 0) {
      // Me: lands and piles by my hand, support behind them, creatures standing at the front of my page (z = 1.5).
      const islands = all("Island");
      const nonbasic = lands.filter((c) => c.name !== "Island");
      lieRow(
        1.25,
        [
          [pile(islands.filter((c) => !c.tapped))],
          [pile(islands.filter((c) => c.tapped))],
          nonbasic.map(one),
          [library],
          [grave],
        ],
        0.86,
        0.35,
      );
      const support = [
        "Sol Ring",
        "Arcane Signet",
        "Fellwar Stone",
        "Everflowing Chalice",
        "Springleaf Drum",
        "Insight Engine",
        "Staff of the Storyteller",
        "Imprisoned in the Moon",
      ].map(named);
      lieRow(
        3.3,
        [support.map(one), [pile(all("Illusion"))], [pile(all("Elemental (Waves)"))], [pile(all("Thopter"))]],
        0.86,
        0.35,
      );
      const creatures = [
        "Princess Yue",
        "Faerie Mastermind",
        "Phantasmal Image",
        "Master of Waves",
        "Meloku the Clouded Mirror",
        "Whirler Rogue",
        "Mulldrifter",
        "Tiller Engine",
      ].map(named);
      standRow(5.0, creatures);
      spots.creatures = onFrame(f, 0, 5.0, 0.8);
      const meloku = pieces.find((p) => p.key === `${seat.name}:${named("Meloku the Clouded Mirror").id}`);
      if (meloku) spots.target = meloku.centre;
      return;
    }

    type Rows = { stand1: string[]; stand2: string[]; l1: Item[][]; l2: Item[][]; l3: Item[][] };
    // Each seat's rows, built only for that seat (they name its cards).
    const rows: Record<number, () => Rows> = {
      1: () => ({
        stand1: ["Marath, Will of the Wild", "Rishkar, Peema Renegade", "Herd Baloth", "Evolution Sage"],
        stand2: ["Incubation Druid", "Kami of Whispered Hopes", "Pollenbright Druid", "Generous Patron"],
        l1: [
          [one(named("Evolution Witness"))],
          [one(named("Ouroboroid"))],
          [pile(all("Beast"))],
          [pile(all("Elemental (Marath)"))],
        ],
        l2: [
          [pile(lands)],
          [pile(all("Cat Beast"))],
          [
            "Felidar Retreat",
            "Song of the Worldsoul",
            "Unbound Flourishing",
            "Sword of Truth and Justice",
            "Resourceful Defense",
          ]
            .map(named)
            .map(one),
        ],
        l3: [[library], [grave], ["Sol Ring", "Coalition Relic"].map(named).map(one)],
      }),
      2: () => ({
        stand1: [
          "Atraxa, Praetors' Voice",
          "Tekuthal, Inquiry Dominus",
          "Brimaz, Blight of Oreskos",
          "Glissa, Herald of Predation",
        ],
        stand2: ["Steel Overseer", "Phyrexian Metamorph", "Chrome Host Seedshark", "Filigree Vector"],
        l1: [
          [one(named("Cankerbloom"))],
          [one(named("Hangarback Walker"))],
          [pile(all("Thopter"))],
          [pile(all("Construct"))],
        ],
        l2: [
          [pile(lands)],
          [pile(all("Incubator"))],
          ["Tezzeret, Cruel Captain", "Wrenn and Realmbreaker"].map(named).map(one),
        ],
        l3: [
          [library],
          [grave],
          [
            "Throne of Geth",
            "Paladin Class",
            "Smothering Tithe",
            "Arcane Signet",
            "Mox Opal",
            "Chrome Mox",
            "Mana Vault",
            "Grim Monolith",
          ]
            .map(named)
            .map(one),
        ],
      }),
      3: () => ({
        stand1: ["Dack Fayden, Helping Hand", "Fiend Hunter", "Restoration Angel", "Felidar Guardian"],
        stand2: ["Wispweaver Angel", "Haywire Mite", "Generous Patron"],
        l1: [
          [pile(all("Spirit"))],
          [pile(all("Treasure"))],
          ["Rule of Law", "Smothering Tithe", "Deafening Silence", "Suppression Field"].map(named).map(one),
        ],
        l2: [[pile(lands)], ["Thorn of Amethyst", "Trinisphere", "Defense Grid", "Cursed Totem"].map(named).map(one)],
        l3: [
          [library],
          [grave],
          ["Sol Ring", "Basalt Monolith", "Mox Diamond", "Lion's Eye Diamond"].map(named).map(one),
        ],
      }),
    };
    const r = rows[si]?.();
    if (!r) return;
    // Two standing rows (the second where the first's tops clear the table, as the engine's clearBehind finds), then
    // three lying rows.
    standRow(0.45, r.stand1.map(named));
    standRow(3.25, r.stand2.map(named));
    const deep = si === 2 ? -0.3 : -0.35;
    lieRow(7.45 + deep, r.l1, 0.5);
    lieRow(9.4 + deep, r.l2, 0.5);
    lieRow(11.35 + deep, r.l3, 0.42);
    if (si === 2) {
      spots.across = onFrame(f, 0, 5, 0);
      const landPile = pieces.find((p) => p.seat === 2 && p.count === lands.length);
      if (landPile) spots.lands = landPile.base;
    }
  });
  return { pieces, spots };
}
