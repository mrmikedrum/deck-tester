// Game states to test the board against, from three cards each to the late-game pile-up in data.js.
// Scenario.load(key) rewrites window.GAME in place (Proto holds references to it and its player objects).
(function () {
  const G = window.GAME, DB = window.CARDS;
  const LATE = JSON.parse(JSON.stringify(G));

  // A seat: { life, poison, bf: [spec], hand: [name], cmd: commander name, inCommand, library, graveyard: [name], ... }
  // A spec is "Name" or ["Name", { tapped, counters, power, toughness, sick, as: label, attach: label, attack: pid, block: label, n }].
  function build(def) {
    let id = 1;
    const cards = {}, labels = {}, combat = { attackers: [], blockers: [] }, pending = [];
    const pt = (name, counters) => {
      const f = DB[name].faces[0], n = v => (v == null || isNaN(+v) ? 0 : +v), p1 = (counters && counters.P1P1) || 0;
      return /Creature/.test(f.type) ? { power: n(f.power) + p1, toughness: n(f.toughness) + p1 } : {};
    };
    const make = (pid, name, zone, o = {}) => {
      const c = Object.assign({ id: id++, card: name, owner: pid, controller: pid, zone }, zone === "battlefield" ? pt(name, o.counters) : {});
      if (/^Token/.test(DB[name].faces[0].type)) c.token = true;
      ["tapped", "counters", "power", "toughness", "sick", "commander", "keywords"].forEach(k => o[k] != null && (c[k] = o[k]));
      cards[c.id] = c;
      if (o.as) labels[o.as] = c.id;
      if (o.attack) combat.attackers.push({ id: c.id, defender: o.attack });
      if (o.block) pending.push(() => combat.blockers.push({ id: c.id, blocking: labels[o.block] }));
      if (o.attach) pending.push(() => (c.attachedTo = labels[o.attach]));
      return c;
    };
    const players = Object.entries(def.seats).map(([pid, s], seat) => {
      const cmd = make(pid, s.cmd, s.inCommand ? "command" : "battlefield", Object.assign({ commander: true }, s.cmdOpts || {}));
      (s.bf || []).forEach(spec => {
        const [name, o] = Array.isArray(spec) ? spec : [spec, {}];
        for (let i = 0; i < (o.n || 1); i++) make(pid, name, "battlefield", o);
      });
      return {
        id: pid, name: pid === "you" ? "You" : pid[0].toUpperCase() + pid.slice(1), seat, commander: [cmd.id],
        life: s.life, poison: s.poison || 0, monarch: !!s.monarch, jev: pid !== "you",
        hand: (s.hand || []).map(n => make(pid, n, "hand").id), handCount: s.hand ? s.hand.length : s.handCount,
        library: s.library, graveyard: (s.graveyard || []).map(n => make(pid, n, "graveyard").id), exile: [],
        command: s.inCommand ? [cmd.id] : [], commanderDamage: s.commanderDamage || {}, manaPool: {},
      };
    });
    pending.forEach(f => f());
    const ids = names => names.map(n => Object.values(cards).find(c => c.card === n && (c.zone === "hand" || c.zone === "battlefield")).id);
    return {
      actionable: ids(def.actionable || []), playable: ids(def.playable || []), turn: def.turn, active: def.active,
      phase: def.phase, priority: def.priority, players, cards, stack: [], log: [],
      combat: combat.attackers.length ? combat : null, decision: def.decision || null, step: def.step || def.phase,
    };
  }

  const LANDS = { you: ["Forest", "Plains", "Command Tower"], ana: ["Swamp", "Breeding Pool", "Command Tower"], bo: ["Island", "Island", "Mystic Sanctuary"], cy: ["Plains", "Ancient Tomb", "Talon Gates of Madara"] };
  const early = () => build({
    turn: 3, active: "you", phase: "Main 1", priority: "you", step: "Your main phase",
    playable: ["Evolution Sage", "Farseek", "Forest", "Swords to Plowshares"],
    seats: {
      you: { life: 40, cmd: "Marath, Will of the Wild", inCommand: true, library: 92, bf: [...LANDS.you, "Sol Ring", "Incubation Druid"],
        hand: ["Evolution Sage", "Ouroboroid", "Swords to Plowshares", "Farseek", "Forest", "Felidar Retreat"] },
      ana: { life: 40, cmd: "Atraxa, Praetors' Voice", inCommand: true, library: 93, handCount: 5, bf: [...LANDS.ana, "Steel Overseer"] },
      bo: { life: 40, cmd: "Princess Yue", inCommand: true, library: 93, handCount: 6, bf: [...LANDS.bo, "Faerie Mastermind"] },
      cy: { life: 38, cmd: "Dack Fayden, Helping Hand", inCommand: true, library: 94, handCount: 6, bf: [...LANDS.cy, "Thorn of Amethyst"] },
    },
  });
  const MID = {
    you: { life: 36, cmd: "Marath, Will of the Wild", cmdOpts: { counters: { P1P1: 3 }, as: "marath" }, library: 84, graveyard: ["Farseek", "Nature's Lore"],
      bf: ["Evolution Sage", ["Ouroboroid", { counters: { P1P1: 1 } }], ["Herd Baloth", { as: "baloth" }], ["Beast", { as: "beast" }], "Felidar Retreat",
        ["Wrenn and Realmbreaker", { counters: { LOYALTY: 5 } }], ["Forest", { n: 2 }], "Plains", "Mountain", "Command Tower", "Temple Garden", "Stomping Ground", "Sol Ring", "Arcane Signet"],
      hand: ["Swords to Plowshares", "Chaos Warp", "Harmonize", "Song of the Worldsoul"] },
    ana: { life: 33, cmd: "Atraxa, Praetors' Voice", library: 86, handCount: 3, graveyard: ["Unnatural Restoration"],
      bf: [["Glissa, Herald of Predation", { as: "glissa" }], ["Steel Overseer", { counters: { P1P1: 2 } }], "Filigree Vector", "Throne of Geth", "Arcane Signet",
        "Swamp", "Island", "Breeding Pool", "Overgrown Tomb", "Watery Grave", "Command Tower"] },
    bo: { life: 30, cmd: "Princess Yue", library: 85, handCount: 4, commanderDamage: { 1: 3 },
      bf: [["Meloku the Clouded Mirror", { as: "meloku" }], ["Master of Waves", { as: "waves" }], ["Elemental (Waves)", { n: 2, power: 2, toughness: 1 }], "Illusion",
        "Springleaf Drum", ["Island", { n: 5 }], "Otawara, Soaring City"] },
    cy: { life: 38, cmd: "Dack Fayden, Helping Hand", library: 87, handCount: 4,
      bf: [["Restoration Angel", { as: "resto" }], "Fiend Hunter", "Rule of Law", "Trinisphere", "Smothering Tithe", "Sol Ring", "Mana Vault", ["Treasure", { n: 2 }],
        ["Plains", { n: 2 }], "Ancient Tomb", "Cavern of Souls", "Great Hall of the Citadel"] },
  };
  const clone = o => JSON.parse(JSON.stringify(o));
  const mid = () => build({
    turn: 6, active: "you", phase: "Main 1", priority: "you", step: "Your main phase",
    actionable: ["Wrenn and Realmbreaker"], playable: ["Swords to Plowshares", "Chaos Warp", "Harmonize"], seats: clone(MID),
  });
  // Your attack: Marath and a Beast at Ana, Herd Baloth at Cy. Ana blocks the Beast with Glissa; Cy blocks with Restoration Angel.
  const attack = () => {
    const s = clone(MID);
    s.you.cmdOpts = { counters: { P1P1: 5 }, as: "marath", attack: "ana", tapped: true };
    s.you.bf = s.you.bf.map(x => (Array.isArray(x) && x[1].as === "beast" ? ["Beast", { as: "beast", attack: "ana", tapped: true }] : Array.isArray(x) && x[1].as === "baloth" ? ["Herd Baloth", { as: "baloth", attack: "cy", tapped: true }] : x));
    s.ana.bf = s.ana.bf.map(x => (Array.isArray(x) && x[1].as === "glissa" ? ["Glissa, Herald of Predation", { block: "beast" }] : x));
    s.cy.bf = s.cy.bf.map(x => (Array.isArray(x) && x[1].as === "resto" ? ["Restoration Angel", { block: "baloth" }] : x));
    return build({ turn: 7, active: "you", phase: "Combat", priority: "you", step: "Blockers declared — damage next", seats: s });
  };
  // Bo attacks: Meloku, Master of Waves and two Elementals at you, an Illusion at Cy. You choose blockers.
  const defend = () => {
    const s = clone(MID);
    s.bo.bf = s.bo.bf.map(x => {
      if (!Array.isArray(x)) return x === "Illusion" ? ["Illusion", { attack: "cy", tapped: true }] : x;
      const o = Object.assign({}, x[1]);
      if (["meloku", "waves"].includes(o.as) || x[0] === "Elemental (Waves)") { o.attack = "you"; o.tapped = true; }
      return [x[0], o];
    });
    s.you.cmdOpts.counters = { P1P1: 4 };
    return build({ turn: 8, active: "bo", phase: "Combat", priority: "you", step: "Bo attacks — choose blockers", decision: "blockers", seats: s });
  };

  const SCENARIOS = {
    early: { title: "Early", make: early },
    mid: { title: "Mid", make: mid },
    attack: { title: "Attacking", make: attack },
    defend: { title: "Blocking", make: defend },
    late: { title: "Late", make: () => Object.assign(clone(LATE), { step: "Ana's main phase — you have priority", combat: null, decision: null }) },
  };
  let current = "late";
  function load(key) {
    const s = SCENARIOS[key].make();
    G.players.forEach((p, i) => { Object.keys(p).forEach(k => delete p[k]); Object.assign(p, s.players[i]); });
    Object.keys(G).forEach(k => k !== "players" && delete G[k]);
    Object.assign(G, s, { players: G.players });
    current = key;
  }
  window.Scenario = { list: SCENARIOS, load, get current() { return current; } };
})();
