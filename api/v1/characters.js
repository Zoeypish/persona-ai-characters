// GET  /api/v1/characters — your characters.
// POST /api/v1/characters — create one: { name, handle?, bio?, avatar_url?, image_urls?, live? }
const { Persona, apiKey, send, body, handler, origin, ApiError } = require("../_lib/persona");
module.exports = handler(async (req, res) => {
  const key = apiKey(req);
  if (req.method === "GET") {
    const me = await Persona.me(key);
    const o = origin(req);
    return send(res, 200, { characters: me.characters.map((c) => Object.assign(c, { profile_url: o + "/profile.html?c=" + c.slug })) });
  }
  if (req.method === "POST") return send(res, 201, await Persona.createCharacter(key, await body(req), origin(req)));
  throw new ApiError(405, "Use GET or POST.", "method");
});
