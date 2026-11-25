// One game's boards from turn 2 to turn 15, for judging layout as a game fills the table. Each stage is a live view
// (the bridge's shape) with every seat's battlefield grown from the stage before: lands, rocks, creatures, support,
// token swarms, tapped cards and counters. Ids stay stable between stages, so a card that stays put is the same card.
global.window = global.window || {}; require("../client/data.js"); const CARDS = window.CARDS;
const { fixtureKeywords } = require("./fixture-keywords.js");

const NAMES = ["You", "Marath", "Atraxa", "Dack"];
// What each seat has on the battlefield at each stage, as [name, count, options]. Later stages list everything.
const DECKS = {
  You: {
    cmd: "Princess Yue",
    lands: ["Island", "Island", "Mystic Sanctuary", "Island", "Otawara, Soaring City", "Island", "Seat of the Synod", "Island", "Minamo, School at Water's Edge", "Island", "Vesuva", "Island", "Thespian's Stage", "Island"],
    rocks: ["Sol Ring", "Arcane Signet", "Fellwar Stone", "Everflowing Chalice"],
    creatures: ["Faerie Mastermind", "Phantasmal Image", "Master of Waves", "Meloku the Clouded Mirror", "Whirler Rogue", "Mulldrifter", "Tiller Engine"],
    support: ["Springleaf Drum", "Imprisoned in the Moon", "Insight Engine", "Staff of the Storyteller"],
    tokens: [["Illusion", [0, 0, 0, 2, 4, 7]], ["Elemental (Waves)", [0, 0, 0, 0, 3, 5]], ["Thopter", [0, 0, 0, 2, 2, 2]]],
  },
  Marath: {
    cmd: "Marath, Will of the Wild",
    lands: ["Forest", "Command Tower", "Forest", "Temple Garden", "Stomping Ground", "Forest", "Sacred Foundry", "Forest", "Wooded Foothills", "Forest", "Karn's Bastion", "Plains", "Grove of the Burnwillows", "Forest"],
    rocks: ["Sol Ring", "Coalition Relic"],
    creatures: ["Incubation Druid", "Evolution Sage", "Herd Baloth", "Kami of Whispered Hopes", "Pollenbright Druid", "Rishkar, Peema Renegade", "Generous Patron", "Evolution Witness", "Ouroboroid"],
    support: ["Felidar Retreat", "Song of the Worldsoul", "Unbound Flourishing", "Sword of Truth and Justice", "Resourceful Defense"],
    tokens: [["Beast", [0, 0, 1, 3, 6, 9]], ["Elemental (Marath)", [0, 0, 0, 2, 4, 8]], ["Cat Beast", [0, 0, 0, 2, 3, 6]]],
  },
  Atraxa: {
    cmd: "Atraxa, Praetors' Voice",
    lands: ["Breeding Pool", "Overgrown Tomb", "Swamp", "Watery Grave", "Hallowed Fountain", "Godless Shrine", "Polluted Delta", "Island", "Marsh Flats", "Plains", "Reflecting Pool", "Forest", "Fabled Passage", "Swamp"],
    rocks: ["Arcane Signet", "Mox Opal", "Chrome Mox", "Mana Vault", "Grim Monolith"],
    creatures: ["Steel Overseer", "Glissa, Herald of Predation", "Phyrexian Metamorph", "Filigree Vector", "Chrome Host Seedshark", "Cankerbloom", "Tekuthal, Inquiry Dominus", "Brimaz, Blight of Oreskos", "Hangarback Walker"],
    support: ["Throne of Geth", "Tezzeret, Cruel Captain", "Wrenn and Realmbreaker", "Paladin Class", "Smothering Tithe"],
    tokens: [["Incubator", [0, 0, 1, 2, 2, 3]], ["Construct", [0, 0, 0, 1, 2, 3]], ["Thopter", [0, 0, 0, 2, 5, 8]]],
  },
  Dack: {
    cmd: "Dack Fayden, Helping Hand",
    lands: ["Plains", "Ancient Tomb", "Plains", "Great Hall of the Citadel", "Plains", "Cavern of Souls", "Plains", "Urza's Saga", "Mishra's Workshop", "Plains", "City of Traitors", "Plains", "Gemstone Caverns", "Plains"],
    rocks: ["Sol Ring", "Basalt Monolith", "Mox Diamond", "Lion's Eye Diamond"],
    creatures: ["Fiend Hunter", "Restoration Angel", "Felidar Guardian", "Wispweaver Angel", "Haywire Mite", "Generous Patron"],
    support: ["Rule of Law", "Smothering Tithe", "Thorn of Amethyst", "Trinisphere", "Deafening Silence", "Suppression Field", "Defense Grid", "Cursed Totem"],
    tokens: [["Treasure", [0, 1, 2, 4, 7, 10]], ["Spirit", [0, 0, 0, 2, 4, 6]]],
  },
};
// Stages: turn, then how many lands, rocks, creatures and support each seat has (tokens come from their own counts).
const STAGES = [
  { turn: 2, lands: 2, rocks: 1, creatures: 0, support: 0 },
  { turn: 4, lands: 4, rocks: 1, creatures: 2, support: 1 },
  { turn: 6, lands: 6, rocks: 2, creatures: 3, support: 2 },
  { turn: 9, lands: 9, rocks: 3, creatures: 5, support: 3 },
  { turn: 12, lands: 11, rocks: 4, creatures: 7, support: 5 },
  { turn: 15, lands: 14, rocks: 5, creatures: 9, support: 8 },
];

function build() {
  let id = 1000; const ids = {};
  const mk = (owner, name, slot, o = {}) => {   // the same (owner, slot) is always the same card id
    const key = owner + "|" + slot; if (!ids[key]) ids[key] = id++;
    const f = CARDS[name].faces[0], c = { id: ids[key], name, type: f.type.replace(/—/g, "-"), text: f.text || "", cost: (f.cost || "").replace(/[{}]/g, " ").trim(), owner, controller: owner, ...fixtureKeywords(f) };
    if (/Creature/.test(f.type)) { c.power = +f.power || 0; c.toughness = +f.toughness || 0; }
    if (/^Token/.test(f.type)) c.token = true;
    if (o.x != null) { c.power = c.toughness = o.x; }   // an X/X token: Forge sends its size
    if (o.p1) { c.counters = { "+1/+1": o.p1 }; c.power += o.p1; c.toughness += o.p1; }
    if (o.tapped) c.tapped = true; if (o.commander) c.commander = true;
    return c;
  };
  return STAGES.map((st, si) => {
    const players = NAMES.map((n, pi) => {
      const d = DECKS[n], bf = [], take = (list, k) => list.slice(0, Math.min(k, list.length));
      const late = si >= 3, cmdOut = si >= 2;
      take(d.lands, st.lands).forEach((l, i) => bf.push(mk(n, l, "land" + i, { tapped: late && i % 3 === 0 })));
      take(d.rocks, st.rocks).forEach((r, i) => bf.push(mk(n, r, "rock" + i, { tapped: late && i === 0 })));
      if (cmdOut) bf.push(mk(n, d.cmd, "cmd", { commander: true, p1: n === "Marath" ? si : n === "Atraxa" ? si - 1 : 0 }));
      take(d.creatures, st.creatures).forEach((c, i) => bf.push(mk(n, c, "cre" + i, { tapped: late && i === 1, p1: n === "Atraxa" && i < 2 ? si : 0 })));
      take(d.support, st.support).forEach((c, i) => bf.push(mk(n, c, "sup" + i)));
      d.tokens.forEach(([t, counts]) => { for (let i = 0; i < counts[si]; i++) bf.push(mk(n, t, t + i, { tapped: late && i % 4 === 1, x: t === "Elemental (Marath)" ? 3 : null })); });
      const gyNames = ["Farseek", "Nature's Lore", "Swords to Plowshares", "Arcane Denial", "Frantic Search", "Snap", "Path to Exile", "Unwind", "Harmonize", "Chaos Warp"];
      const gy = gyNames.slice(0, Math.min(gyNames.length, si * 2 + (pi % 2))).map((g, i) => mk(n, g, "gy" + i));
      const hand = n === "You" ? ["Island", "Snap", "Arcane Denial", "Frantic Search", "Ghostly Flicker", "Reality Shift", "Phantasmal Image"].slice(0, Math.max(3, 7 - si)).map((h, i) => mk(n, h, "hand" + i)) : undefined;
      return { name: n, life: 40 - [0, 1, 3, 6, 9, 14][si] - pi, library: 92 - st.turn - si * 2, battlefield: bf, command: cmdOut ? [] : [mk(n, d.cmd, "cmd", { commander: true })], graveyard: gy, exile: [],
        hand, handCount: n === "You" ? undefined : Math.max(1, 6 - si + pi % 2) };
    });
    const log = [{ i: 0, text: `Turn ${st.turn} (You)`, type: "Turn" }];
    return { turn: st.turn, view: { players, stack: [], combat: null, turn: st.turn, active: "You", priority: "You", phase: "MAIN1", log }, decision: { kind: "play", prompt: "", options: ["Pass"], refs: [{}], min: 1, max: 1 } };
  });
}
const BOARDS = build();
module.exports = { BOARDS, STAGES };
if (require.main === module) BOARDS.forEach(b => console.log("turn " + b.turn + ": " + b.view.players.map(p => p.name + " " + p.battlefield.length).join(", ")));
