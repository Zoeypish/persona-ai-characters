// GET /api/v1/templates — Persona's character template, a filled example, image prompt pack and starter ideas. No key needed.
const { Persona, send, handler } = require("../_lib/persona");
module.exports = handler(async (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=3600");
  send(res, 200, Persona.templates());
});
