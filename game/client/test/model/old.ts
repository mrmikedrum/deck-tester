// The old client's expressions, transcribed as they were, to hold the model's predicates to: live.js `conv` and
// `remember` (the view and the card DB -> GAME), common.js `face`, `name`, `typeLine`, `isLand`, `isCreature`, `isPW`,
// `isMana`, `groupKey`, and h.js buildBoard's `special`, `rock`, the Treasure test and the pile word.
// Test-only, deliberately untyped in spirit: it mirrors JavaScript that read loose objects.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Any = any;

const COUNTER: Record<string, string> = { "+1/+1": "P1P1", "-1/-1": "M1M1", Loyalty: "LOYALTY", LOYAL: "LOYALTY" };
const ctr = (n: string) => COUNTER[n] || n.toUpperCase().replace(/[^A-Z0-9]/g, "");
const typeOf = (t: string) => (t || "").replace(/ - /g, " — ");

const RULES: Record<string, string> = Object.fromEntries(
  [
    "Trinisphere",
    "Thorn of Amethyst",
    "Rule of Law",
    "Deafening Silence",
    "Suppression Field",
    "Cursed Totem",
    "Defense Grid",
    "Smothering Tithe",
    "Paladin Class",
    "Tekuthal, Inquiry Dominus",
    "Unbound Flourishing",
    "Kami of Whispered Hopes",
  ].map((n) => [n, n]),
);

/** The old world for one view: GAME's cards and the mutated DB, with "you" as the viewer's seat id. */
export function oldWorld(view: Any, catalog: Record<string, Any>) {
  const DB: Record<string, Any> = JSON.parse(JSON.stringify(catalog));
  const PIDS = ["you", "ana", "bo", "cy"];
  const pidOf: Record<string, string> = {};
  view.players.forEach((p: Any, i: number) => (pidOf[p.name] = PIDS[i]!));
  // cardsFor: a placeholder for every name the catalog lacks
  const zones = ["battlefield", "command", "graveyard", "exile", "hand"];
  view.players.forEach((p: Any) =>
    zones.forEach((z) =>
      (p[z] || []).forEach((c: Any) => {
        const n = c.faceDown ? "Face-down" : c.name;
        if (!DB[n]) DB[n] = { name: n, faces: [{ name: n, type: "", art: null, img: null, keywords: [] }], produces: [] };
      }),
    ),
  );
  // remember
  const seen: Record<string, Any> = {};
  view.players.forEach((p: Any) => zones.forEach((z) => (p[z] || []).forEach((c: Any) => (seen[c.name] = c))));
  Object.values(seen).forEach((c: Any) => {
    const e = DB[c.name];
    if (!e) return;
    const f = e.faces[0];
    if (!e._engine) {
      e._engine = true;
      f.type = typeOf(c.type) || f.type;
      if (c.text && !f.text) f.text = c.text;
    }
  });
  if (!DB["Face-down"]) DB["Face-down"] = { name: "Face-down", faces: [{ name: "Face-down", type: "Creature", power: "2", toughness: "2" }], produces: [] };
  // conv
  const conv = (c: Any, zone: string) => {
    const out: Any = { id: c.id, card: c.faceDown ? "Face-down" : c.name, owner: pidOf[c.owner] || "you", controller: pidOf[c.controller] || "you", zone };
    ["tapped", "token", "commander", "sick", "attachedTo", "faceDown", "power", "toughness"].forEach((k) => c[k] != null && (out[k] = c[k]));
    if (c.counters) {
      out.counters = {};
      Object.entries(c.counters).forEach(([k, n]) => (out.counters[ctr(k)] = n));
    }
    if (c.loyalty != null) out.counters = Object.assign(out.counters || {}, { LOYALTY: c.loyalty });
    if (c.keywords) out.keywords = c.keywords;
    if (c.copy) out.copyOf = c.name;
    return out;
  };
  const face = (c: Any) => {
    if (c.faceDown) return null;
    const d = DB[c.copyOf || c.card];
    return d.faces[c.transformed ? 1 : 0] || d.faces[0];
  };
  const printed = (c: Any) => DB[c.card].faces[0];
  const name = (c: Any) => (c.faceDown ? (c.controller === "you" ? "Face-down · " + printed(c).name : "Face-down 2/2") : face(c).name);
  const typeLine = (c: Any) => (c.faceDown ? "Creature" : face(c).type);
  const isLand = (c: Any) => !!c.becameLand || /\bLand\b/.test(typeLine(c));
  const isCreature = (c: Any) => !isLand(c) && (c.faceDown || /Creature/.test(typeLine(c)));
  const isPW = (c: Any) => /Planeswalker/.test(typeLine(c));
  const isMana = (c: Any) => !isCreature(c) && !isLand(c) && !isPW(c) && !RULES[c.card] && (DB[c.card].produces || []).length > 0;
  const special = (c: Any) => isLand(c) && (!!c.copyOf || /\b(Whenever|At the beginning)\b/.test((face(c) || {}).text || ""));
  const rock = (c: Any) => isMana(c) && /(^|\n|— )\{T\}[^:\n]*: Add/.test((face(c) || {}).text || "");
  const treasure = (c: Any) => !!c.token && /Treasure/.test(c.card);
  const word = (c: Any) =>
    typeLine(c)
      .split("—")[0]
      .replace(/Legendary|Snow|Basic|Token/g, "")
      .trim()
      .split(" ")
      .pop();
  const groupKey = (c: Any) =>
    [c.card, c.copyOf, c.transformed, c.tapped, c.faceDown, c.sick, c.goaded, JSON.stringify(c.counters || {}), c.power, c.toughness].join("|");
  return { conv, name, typeLine, isLand, isCreature, isPW, isMana, special, rock, treasure, word, groupKey };
}
