// GET  /api/v1/registry?character=<slug>[&version=<n>] — the character's spec (latest or a given version) and its history.
// POST /api/v1/registry — save a new version: { character, spec, note? }. Old versions are never changed.
const { Persona, apiKey, send, body, handler, ApiError } = require("../_lib/persona");
module.exports = handler(async (req, res) => {
  const key = apiKey(req);
  if (req.method === "GET") {
    const q = req.query || {};
    if (!q.character) throw new ApiError(400, "Say which character, e.g. ?character=nova-reyes", "bad_request");
    return send(res, 200, await Persona.registryGet(key, q.character, q.version));
  }
  if (req.method === "POST") {
    const b = await body(req);
    if (!b.character) throw new ApiError(400, "Say which character (its slug).", "bad_request");
    return send(res, 201, await Persona.registrySave(key, b.character, b.spec, b.note));
  }
  throw new ApiError(405, "Use GET or POST.", "method");
});
