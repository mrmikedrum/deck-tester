// Serve the build on a free port. Workers inherit BEHAVIOUR_BASE.
const { serve } = require("../serve.js");
module.exports = async () => {
  const { base, server } = await serve();
  process.env.BEHAVIOUR_BASE = base;
  global.__behaviourServer = server;
};
