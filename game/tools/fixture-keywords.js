// The subset and order sent by Session.shown (SHOWN_KEYWORDS). The catalog also tags
// things like triggered abilities and the keywords a spell grants to other cards.
const SHOWN = ["Flying", "Reach", "Trample", "Vigilance", "Deathtouch", "Lifelink", "Haste", "First strike",
  "Double strike", "Menace", "Hexproof", "Indestructible", "Defender", "Flash", "Ward"];

function fixtureKeywords(face) {
  const keywords = SHOWN.filter(k => face.keywords?.includes(k));
  return keywords.length ? { keywords } : {};
}

module.exports = { fixtureKeywords };
