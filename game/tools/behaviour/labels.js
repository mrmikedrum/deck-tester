// The button labels the new entry renamed (game/tools/look/intent.md: the prompt says the least, in game terms). A spec
// that asserts one names the current client's label and reads the client under test's through `label`; what the client
// sends for it is unchanged, and is what the spec pins.
const NEW = process.env.BEHAVIOUR_CLIENT === "new";
const RENAMED = {
  "Let Forge decide": "Auto",
  "Everyone attacks": "All attack",
  "Pass toward blocks": "To blocks",
  "Pass priority": "OK", // someone else's item up and nothing to answer it with
  "Choose a play (6)": "All plays (6)",
};
/** The label on the client under test: `renamed` where the new entry says it differently in this case. */
const label = (old, renamed = RENAMED[old]) => (NEW && renamed !== undefined ? renamed : old);
module.exports = { label };
