// What the painters are given for the model's cards and seats: a card's FaceSpec (theme/grimoire/face.ts), a seat's
// plate, its counter chips and its place's colours. The mapping the workbench fixtures stood in for. Pure.
import { hasAbilities, isArtifact, isBasic, isEnchantment, isLand, isManaSource, isPlaneswalker } from "../../model";
import type { Card, SeatId, TableModel } from "../../model";
import type { Mark } from "../../play";
import { counterChip, counterKind, faceSpec, seat as seatColour, seatInk } from "../../theme";
import type { ChipSpec, FaceSpec, FrameKey, PlateSpec, SeatPlace } from "../../theme";

/** The table's places in viewer-relative order (layout's template slots: near first, then clockwise). */
const PLACES: readonly SeatPlace[] = ["near", "left", "across", "right"];

/** A seat's place: its index in the model's seat order (the perspective first) is its slot's. */
export function placeOf(model: TableModel, seat: SeatId | null): SeatPlace {
  const i = seat === null ? 0 : model.seats.findIndex((s) => s.id === seat);
  return PLACES[i < 0 ? 0 : i % PLACES.length] ?? "near";
}

export const colourOf = (model: TableModel, seat: SeatId | null): string => seatColour[placeOf(model, seat)];
export const inkOf = (model: TableModel, seat: SeatId | null): string => seatInk[placeOf(model, seat)];

/** The mana colours a card makes, in WUBRG order, each once ("any colour" is all five). */
function colouredMana(c: Card): string[] {
  const made = new Set(c.face.produces.filter((m) => "WUBRG".includes(m)));
  return ["W", "U", "B", "R", "G"].filter((m) => made.has(m));
}

/**
 * The face a card wears on the table, composed from what it is now (its type line is the engine's, so a crewed
 * vehicle, an animated land or a stationed spacecraft wears what it has become). `mark` lights its ability gem when it
 * is an option; `small`: it is under 56 px on screen, and wears the small form.
 */
export function faceOfCard(model: TableModel, c: Card, mark: Mark | null = null, small = false): FaceSpec {
  const type = c.face.type;
  const land = isLand(c),
    body = c.faceDown || /\bCreature\b/.test(type),
    walker = isPlaneswalker(c),
    battle = /\bBattle\b/.test(type);
  const made: FaceSpec["made"] = [
    ...(isArtifact(c) ? (["artifact"] as const) : []),
    ...(isEnchantment(c) ? (["enchantment"] as const) : []),
    ...(land ? (["land"] as const) : []),
  ];
  const colours = colouredMana(c);
  const printed = c.face.basePower !== 0 || c.face.baseToughness !== 0 || /\b(Vehicle|Spacecraft)\b/.test(type);
  const foot: FaceSpec["foot"] =
    body || printed
      ? {
          kind: "creature",
          power: c.power ?? c.face.basePower,
          toughness: c.toughness ?? c.face.baseToughness,
          basePower: c.face.basePower,
          baseToughness: c.face.baseToughness,
          ...(body ? {} : { hollow: true }),
        }
      : walker
        ? { kind: "walker", loyalty: String(c.loyalty ?? c.counters["LOYALTY"] ?? "") }
        : battle
          ? { kind: "battle", defense: String(c.counters["DEFENSE"] ?? "") }
          : { kind: "type", typeLine: type };
  // A whole face, where what it is is all there is to say; a body takes the creature composition, marks added.
  const whole: FaceSpec["whole"] = body
    ? null
    : walker
      ? "walker"
      : battle
        ? "battle"
        : !land
          ? null
          : isBasic(c) && colours.length === 1
            ? "basic"
            : colours.length >= 4
              ? "any"
              : colours.length >= 2
                ? "dual"
                : "utility";
  // Stock is the card's colour; a land's is the colour it makes (earth when it makes none or many).
  const stockOf = (cs: readonly string[]): FrameKey =>
    cs.length > 1 ? "M" : cs[0] === "W" || cs[0] === "U" || cs[0] === "B" || cs[0] === "R" || cs[0] === "G" ? cs[0] : "C";
  const frame: FrameKey = land && !body ? (whole === "basic" || whole === "dual" ? stockOf(colours.slice(0, 1)) : "L") : stockOf(c.face.colors);
  const makes = land || isManaSource(c) ? (whole === "any" ? ["W", "U", "B", "R", "G"] : c.face.produces.slice(0, 3)) : [];
  const owner = c.owner !== c.controller ? { label: String(c.owner), colour: colourOf(model, c.owner) } : null;
  return faceSpec({
    down: c.faceDown,
    name: c.face.name,
    frame,
    token: c.token,
    commander: c.commander,
    tapped: c.tapped,
    far: c.controller !== model.viewer.perspective,
    art: c.face.art,
    text: c.face.text,
    foot,
    keywords: c.keywords,
    gem: hasAbilities(c) ? (mark === "option" ? "lit" : "idle") : "none",
    tags: c.copy ? ["Copy"] : [],
    owner,
    made,
    whole,
    mana: whole === "basic" || whole === "dual" ? colours : makes,
    small,
  });
}

/** Counter chips on a card (loyalty is on its face). */
export function chipsOf(c: Card): ChipSpec[] {
  return Object.entries(c.counters)
    .filter(([k, n]) => counterKind(k) !== "LOYALTY" && n !== 0)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, n]) => counterChip(k, n));
}

/** A seat's plaque: name, life, seal in its place's colour, the turn's ember, the commander's art in the seal. */
export function plateOf(model: TableModel, seat: SeatId, mark: Mark | null): PlateSpec {
  const s = model.seat(seat);
  const cmd = model.zone(seat, "command").map((id) => model.cards.get(id)).find((c) => c?.commander);
  // Anywhere in view, or as last seen: a commander out of sight keeps its plate (live.js `known`).
  const anyCmd = cmd ?? model.commanders.get(seat)?.[0];
  return {
    name: String(seat),
    life: s?.life ?? 0,
    seat: colourOf(model, seat),
    monarch: s?.monarch ?? false,
    turn: model.active === seat,
    ring: mark === "option" ? "option" : mark === "selected" ? "selected" : "none",
    art: anyCmd?.face.art ?? null,
  };
}

/** The strongest mark among cards: danger over selected over option (a pile shows its members' strongest). */
export function strongest(marks: readonly (Mark | undefined)[]): Mark | null {
  if (marks.includes("danger")) return "danger";
  if (marks.includes("selected")) return "selected";
  if (marks.includes("option")) return "option";
  return null;
}
