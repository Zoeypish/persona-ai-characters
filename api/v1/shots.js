// POST /api/v1/shots — build an on-model image prompt: { character, camera?, lighting?, location?, pose?, outfit?, extra?, surprise? }
//      Missing presets are filled with fresh ones the character hasn't used lately.
// GET  /api/v1/shots?character=<slug> — drift guard report: variety, near-duplicates and same-face checks.
const { Persona, apiKey, send, body, handler, ApiError } = require("../_lib/persona");
module.exports = handler(async (req, res) => {
  const key = apiKey(req);
  if (req.method === "GET") {
    const c = (req.query || {}).character;
    if (!c) throw new ApiError(400, "Say which character, e.g. ?character=nova-reyes", "bad_request");
    return send(res, 200, await Persona.driftReport(key, c));
  }
  if (req.method === "POST") {
    const b = await body(req);
    if (!b.character) throw new ApiError(400, "Say which character (its slug).", "bad_request");
    return send(res, 200, await Persona.buildShot(key, b.character, b));
  }
  throw new ApiError(405, "Use GET or POST.", "method");
});
