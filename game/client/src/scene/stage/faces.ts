// What the painters are given for the model's cards and seats: a card's FaceSpec (theme/grimoire/face.ts), a seat's
// plate, its counter chips and its place's colours. The mapping the workbench fixtures stood in for. Pure.
import { hasAbilities, isCreature, isLand, isPlaneswalker } from "../../model";
import type { Card, SeatId, TableModel } from "../../model";
import type { Mark } from "../../play";
import { counterChip, counterKind, faceSpec, frameKeyOf, seat as seatColour, seatInk } from "../../theme";
import type { ChipSpec, FaceSpec, PlateSpec, SeatPlace } from "../../theme";

/** The table's places in viewer-relative order (layout's template slots: near first, then clockwise). */
const PLACES: readonly SeatPlace[] = ["near", "left", "across", "right"];

/** A seat's place: its index in the model's seat order (the perspective first) is its slot's. */
export function placeOf(model: TableModel, seat: SeatId | null): SeatPlace {
  const i = seat === null ? 0 : model.seats.findIndex((s) => s.id === seat);
  return PLACES[i < 0 ? 0 : i % PLACES.length] ?? "near";
}

export const colourOf = (model: TableModel, seat: SeatId | null): string => seatColour[placeOf(model, seat)];
export const inkOf = (model: TableModel, seat: SeatId | null): string => seatInk[placeOf(model, seat)];

/** The face a card wears on the table. `mark` lights its ability gem when it is an option. */
export function faceOfCard(model: TableModel, c: Card, mark: Mark | null = null): FaceSpec {
  const land = isLand(c);
  const foot: FaceSpec["foot"] = isCreature(c)
    ? {
        kind: "creature",
        power: c.power ?? c.face.basePower,
        toughness: c.toughness ?? c.face.baseToughness,
        basePower: c.face.basePower,
        baseToughness: c.face.baseToughness,
      }
    : isPlaneswalker(c)
      ? { kind: "walker", loyalty: String(c.loyalty ?? c.counters["LOYALTY"] ?? "") }
      : land
        ? { kind: "land", mana: c.face.produces }
        : { kind: "type", typeLine: c.face.type };
  const owner = c.owner !== c.controller ? { label: String(c.owner), colour: colourOf(model, c.owner) } : null;
  return faceSpec({
    down: c.faceDown,
    name: c.face.name,
    frame: frameKeyOf({ token: c.token, land, colours: c.face.colors }),
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
