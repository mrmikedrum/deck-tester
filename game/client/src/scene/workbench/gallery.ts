// The painted pieces on plain canvases, at the size they are painted: faces across their states, plates, signs, tags,
// chips, halos, shades, a page and the tome. This is the look check for the theme painters (no WebGL involved).
import {
  counterChip,
  paintBack,
  paintChip,
  paintDrop,
  paintFace,
  paintHalo,
  paintPage,
  paintPageShade,
  paintPlate,
  paintShade,
  paintSign,
  paintTable,
  paintTag,
  paintVellumTile,
  seat,
  seatInk,
} from "../../theme";
import type { FaceEnv, FaceSpec } from "../../theme";
import { faceOf, SEAT_PLACES } from "./fixtures";
import type { Entry } from "./fixtures";

type Paint = (canvas: HTMLCanvasElement) => void;

function figure(parent: HTMLElement, label: string, paint: Paint, id?: string, scale = 1): HTMLCanvasElement {
  const fig = document.createElement("figure"),
    canvas = document.createElement("canvas"),
    cap = document.createElement("figcaption");
  paint(canvas);
  canvas.style.width = `${canvas.width * scale}px`;
  canvas.style.height = `${canvas.height * scale}px`;
  cap.textContent = label;
  if (id) fig.id = id;
  fig.append(canvas, cap);
  parent.append(fig);
  return canvas;
}

function section(root: HTMLElement, id: string, title: string): HTMLElement {
  const s = document.createElement("section"),
    h = document.createElement("h2"),
    row = document.createElement("div");
  s.id = id;
  h.textContent = title;
  row.className = "row";
  s.append(h, row);
  root.append(s);
  return row;
}

const FACES: readonly {
  readonly label: string;
  readonly entry: Entry;
  readonly far?: boolean;
  readonly over?: Partial<FaceSpec>;
}[] = [
  {
    label: "creature, mine, up-buffed",
    entry: {
      name: "Brimaz, Blight of Oreskos",
      frame: "W",
      kind: "creature",
      power: 5,
      toughness: 4,
      basePower: 3,
      baseToughness: 4,
      keywords: ["Vigilance", "Lifelink", "First strike"],
      gem: "lit",
      commander: true,
    },
  },
  {
    label: "creature, mine",
    entry: {
      name: "Herd Baloth",
      frame: "G",
      kind: "creature",
      power: 4,
      toughness: 4,
      keywords: ["Trample"],
      gem: "idle",
    },
  },
  {
    label: "far: long name, flying",
    entry: {
      name: "Meloku the Clouded Mirror",
      frame: "U",
      kind: "creature",
      power: 2,
      toughness: 2,
      keywords: ["Flying"],
    },
    far: true,
  },
  {
    label: "far: two lines",
    entry: {
      name: "Chrome Host Seedshark",
      frame: "U",
      kind: "creature",
      power: 3,
      toughness: 3,
      keywords: ["Flying"],
    },
    far: true,
  },
  {
    label: "tapped",
    entry: {
      name: "Restoration Angel",
      frame: "W",
      kind: "creature",
      power: 3,
      toughness: 4,
      keywords: ["Flying"],
      tapped: true,
    },
  },
  {
    label: "down-buffed",
    entry: {
      name: "Mulldrifter",
      frame: "U",
      kind: "creature",
      power: 1,
      toughness: 1,
      basePower: 2,
      baseToughness: 2,
    },
  },
  {
    label: "token (dashed)",
    entry: { name: "Beast", frame: "T", kind: "creature", power: 3, toughness: 3, token: true },
  },
  {
    label: "copy, owner seal, tip",
    entry: {
      name: "Phyrexian Metamorph",
      frame: "U",
      kind: "creature",
      power: 3,
      toughness: 2,
      tags: ["Copy", "Goaded"],
    },
    over: { owner: { label: "Ana's", colour: seat.left }, tip: { label: "blocks Baloth", colour: seat.across } },
  },
  {
    label: "planeswalker",
    entry: { name: "Wrenn and Realmbreaker", frame: "G", kind: "walker", loyalty: "5", gem: "idle" },
  },
  { label: "dual land", entry: { name: "Sacred Foundry", frame: "L", kind: "land", mana: ["R", "W"] } },
  {
    label: "five-colour land",
    entry: { name: "Command Tower", frame: "L", kind: "land", mana: ["W", "U", "B", "R", "G"] },
  },
  { label: "artifact", entry: { name: "Sol Ring", frame: "C", kind: "rock", typeLine: "Artifact" } },
  { label: "enchantment", entry: { name: "Smothering Tithe", frame: "W", kind: "enchantment" } },
  {
    label: "gold (multicolour)",
    entry: { name: "Marath, Will of the Wild", frame: "M", kind: "creature", power: 3, toughness: 3 },
  },
  {
    label: "black frame, equipment",
    entry: { name: "Sword of Truth and Justice", frame: "B", kind: "artifact", typeLine: "Artifact — Equipment" },
  },
  { label: "red frame", entry: { name: "Chaos Warp", frame: "R", kind: "enchantment", typeLine: "Sorcery" } },
  {
    label: "no art: its text",
    entry: {
      name: "Mystery Card",
      art: "",
      frame: "C",
      kind: "artifact",
      text: "Whenever a creature enters the battlefield under your control, you may pay {1}. If you do, draw a card. (This is reminder text.)",
    },
  },
];

/** One of each composition the table draws (designer's `frames.png`). */
const TABLE_FACES: readonly { label: string; entry: Entry }[] = [
  { label: "creature", entry: { name: "Herd Baloth", frame: "G", kind: "creature", power: 4, toughness: 4, keywords: ["Trample"] } },
  { label: "token", entry: { name: "Beast", frame: "G", kind: "creature", power: 4, toughness: 4, token: true } },
  { label: "commander", entry: { name: "Atraxa, Grand Unifier", frame: "M", kind: "creature", power: 8, toughness: 8, commander: true, keywords: ["Flying", "Deathtouch"] } },
  { label: "artifact creature", entry: { name: "Steel Overseer", frame: "C", kind: "creature", made: ["artifact"], power: 6, toughness: 6, gem: "idle" } },
  { label: "artifact (rock)", entry: { name: "Sol Ring", frame: "C", kind: "rock", mana: ["C", "C"] } },
  { label: "enchantment", entry: { name: "Rule of Law", frame: "W", kind: "enchantment" } },
  { label: "enchantment creature", entry: { name: "Courser of Kruphix", frame: "G", kind: "creature", made: ["enchantment"], power: 2, toughness: 4 } },
  { label: "planeswalker", entry: { name: "Tezzeret, Cruel Captain", frame: "U", kind: "walker", loyalty: "5" } },
  { label: "commander planeswalker", entry: { name: "Dack Fayden", frame: "M", kind: "walker", loyalty: "3", commander: true } },
  { label: "battle", entry: { name: "Invasion of Zendikar", frame: "G", kind: "enchantment", made: [], whole: "battle", defense: "3" } },
  { label: "basic land", entry: { name: "Island", frame: "U", kind: "land", basic: true, mana: ["U"] } },
  { label: "dual land", entry: { name: "Breeding Pool", frame: "G", kind: "land", mana: ["G", "U"] } },
  { label: "any-colour land", entry: { name: "Command Tower", frame: "L", kind: "land", mana: ["W", "U", "B", "R", "G"] } },
  { label: "utility land", entry: { name: "Mystic Sanctuary", frame: "L", kind: "land", mana: ["U"], gem: "idle" } },
  { label: "vehicle, not crewed", entry: { name: "Smuggler's Copter", frame: "C", kind: "artifact", hollow: true, power: 3, toughness: 3, keywords: ["Flying"] } },
  { label: "the same, crewed", entry: { name: "Smuggler's Copter", frame: "C", kind: "creature", made: ["artifact"], power: 3, toughness: 3, keywords: ["Flying"] } },
  { label: "land creature", entry: { name: "Dryad Arbor", frame: "G", kind: "creature", made: ["land"], mana: ["G"], power: 1, toughness: 1 } },
  { label: "artifact enchantment", entry: { name: "Spear of Heliod", frame: "W", kind: "artifact", made: ["artifact", "enchantment"], gem: "idle" } },
];

export function gallery(root: HTMLElement, env: FaceEnv, isReady: (url: string) => boolean): void {
  const faces = section(root, "faces", "Faces");
  for (const f of FACES) {
    const spec = { ...faceOf(f.entry, f.far ?? false, isReady), ...f.over };
    figure(faces, f.label, (c) => paintFace(c, spec, env));
  }
  figure(faces, "face down", (c) =>
    paintFace(c, { ...faceOf({ name: "x", frame: "C", kind: "artifact" }, false, isReady), down: true }, env),
  );
  figure(faces, "back", (c) => paintBack(c, env));
  figure(faces, "face down, tapped", (c) =>
    paintFace(
      c,
      { ...faceOf({ name: "x", frame: "C", kind: "artifact" }, false, isReady), down: true, tapped: true },
      env,
    ),
  );

  // The table faces, composed from what each card is now, at their standard size and in the small form (at the 44 px floor).
  const table = section(root, "table-faces", "Table faces");
  for (const f of TABLE_FACES) {
    const spec = faceOf(f.entry, false, isReady);
    figure(table, f.label, (c) => paintFace(c, spec, env));
    figure(table, `${f.label}, small`, (c) => paintFace(c, { ...spec, small: true }, env));
  }

  const plates = section(root, "plates", "Plates");
  const rows: readonly {
    readonly id: keyof typeof SEAT_PLACES;
    readonly name: string;
    readonly life: number;
    readonly monarch: boolean;
    readonly turn: boolean;
    readonly ring: "none" | "option" | "selected";
    readonly art: string;
  }[] = [
    { id: "you", name: "You", life: 40, monarch: false, turn: true, ring: "none", art: "brimaz-blight-of-oreskos" },
    { id: "ana", name: "Ana", life: 23, monarch: true, turn: false, ring: "option", art: "marath-will-of-the-wild" },
    {
      id: "bo",
      name: "Bo of the Many Names",
      life: 7,
      monarch: false,
      turn: false,
      ring: "selected",
      art: "meloku-the-clouded-mirror",
    },
    { id: "cy", name: "Cy", life: -2, monarch: false, turn: false, ring: "none", art: "tezzeret-cruel-captain" },
  ];
  for (const r of rows)
    figure(
      plates,
      `${r.id}: ${r.ring === "none" ? "" : r.ring + " ring "}${r.turn ? "turn " : ""}${r.monarch ? "monarch" : ""}`.trim(),
      (c) =>
        paintPlate(
          c,
          {
            name: r.name,
            life: r.life,
            seat: seat[SEAT_PLACES[r.id]],
            monarch: r.monarch,
            turn: r.turn,
            ring: r.ring,
            art: isReady(`cache/cards/art/${r.art}.jpg`) ? `cache/cards/art/${r.art}.jpg` : null,
          },
          env.surfaces,
          env.art,
        ),
    );

  const strips = section(root, "strips", "Signs, tags, chips");
  figure(strips, "sign", (c) => void paintSign(c, { text: "Graveyard 8", colour: seat.near, sub: null }, env.surfaces));
  figure(
    strips,
    "sign, two lines",
    (c) =>
      void paintSign(
        c,
        { text: "Creatures 31", colour: null, sub: "Elemental 8 · Cat Beast 6 · 5 tapped" },
        env.surfaces,
      ),
  );
  figure(strips, "tab", (c) => void paintSign(c, { text: "Tokens 23", colour: null, sub: null }, env.surfaces));
  figure(strips, "stack tag", (c) => paintTag(c, "Swords to Plowshares", seat.across, env.surfaces));
  figure(strips, "chip +1/+1", (c) => paintChip(c, counterChip("P1P1", 2), env.surfaces));
  figure(strips, "chip charge", (c) => paintChip(c, counterChip("CHARGE", 3), env.surfaces));
  figure(strips, "chip count", (c) => paintChip(c, { text: "×4", ink: "#1a120a", sub: null }, env.surfaces));

  const decals = section(root, "decals", "Halos, shades, pages");
  for (const k of ["option", "selected", "danger"] as const)
    figure(decals, `halo ${k}`, (c) => paintHalo(c, k), undefined, 0.8);
  figure(decals, "drop", paintDrop);
  figure(decals, "shade", paintShade);
  figure(decals, "page shade", paintPageShade, undefined, 0.5);
  const pg = { w: 8.4, d: 12.2, seed: 7 + 131 + 121 };
  figure(
    decals,
    "page ink (across)",
    (c) => paintPage(c, { ...pg, layer: "ink", ink: seatInk.across }, env.surfaces),
    undefined,
    0.4,
  );
  figure(
    decals,
    "page glow",
    (c) => paintPage(c, { ...pg, layer: "glow", ink: seatInk.across }, env.surfaces),
    undefined,
    0.4,
  );
  figure(decals, "page mask", (c) => paintPage(c, { ...pg, layer: "mask", ink: "#000" }, env.surfaces), undefined, 0.4);
  figure(decals, "vellum tile", (c) => paintVellumTile(c, true, "#cdbb92", env.surfaces), undefined, 0.3);
  figure(decals, "the tome (table)", (c) => paintTable(c, env.surfaces), "tome", 0.3);
}
