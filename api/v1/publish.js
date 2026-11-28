// POST /api/v1/publish — show or hide an image on Persona: { image_id, live }
const { Persona, apiKey, send, body, handler, ApiError } = require("../_lib/persona");
module.exports = handler(async (req, res) => {
  if (req.method !== "POST") throw new ApiError(405, "Use POST.", "method");
  const key = apiKey(req), b = await body(req);
  send(res, 200, await Persona.setLive(key, b.image_id, b.live !== false));
});
