// A live game starts empty: four seats in my order (me, then left, across, right) that live.js fills from the engine.
window.SeatLive = true;
window.CARDS = {};
window.GAME = {
  players: ["you", "ana", "bo", "cy"].map((id, seat) => ({
    id, seat, name: id === "you" ? "You" : "…", life: 40, poison: 0, commander: [], hand: [], handCount: 0, library: 0,
    graveyard: [], exile: [], command: [], commanderDamage: {}, manaPool: {},
  })),
  cards: {}, stack: [], log: [], playable: [], actionable: [], turn: 0, phase: "", step: "", active: "you", priority: null, combat: null,
};
