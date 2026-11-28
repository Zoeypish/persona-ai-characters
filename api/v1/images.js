// GET  /api/v1/images?character=<slug> — a character's uploaded images.
// POST /api/v1/images — add one: { character, image_url | image_base64 | openaiFileIdRefs, live?, as_profile_photo? }
const { Persona, apiKey, send, body, handler, ApiError } = require("../_lib/persona");
module.exports = handler(async (req, res) => {
  const key = apiKey(req);
  if (req.method === "GET") return send(res, 200, { images: await Persona.listImages(key, (req.query || {}).character) });
  if (req.method === "POST") {
    const b = await body(req);
    return send(res, 201, await Persona.addImage(key, b.character, b, { live: !!b.live, avatar: !!b.as_profile_photo }));
  }
  throw new ApiError(405, "Use GET or POST.", "method");
});
