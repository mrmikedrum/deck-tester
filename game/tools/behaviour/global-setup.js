// Starts tools/serve.js on a free port (the built new entry with BEHAVIOUR_CLIENT=new); workers read the address from
// BEHAVIOUR_BASE (inherited by them).
const { serve } = require("../serve.js");
module.exports = async () => {
  const { base, server } = await serve(0, { dist: process.env.BEHAVIOUR_CLIENT === "new" });
  process.env.BEHAVIOUR_BASE = base;
  global.__behaviourServer = server;
};
