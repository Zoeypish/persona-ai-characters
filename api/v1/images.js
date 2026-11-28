// GET  /api/v1/images?character=<slug> — a character's uploaded images.
// POST /api/v1/images — add one: { character, image_url | image_base64 | openaiFileIdRefs, live?, as_profile_photo?,
//                                  recipe?, spec_version?, self_check? }  (the last three feed the drift guard)
// New images are drafts (hidden) unless live is true; the creator picks which to publish in Studio.
const { Persona, apiKey, send, body, handler, ApiError } = require("../_lib/persona");
const { faceMatch } = require("../_lib/facematch");
module.exports = handler(async (req, res) => {
  const key = apiKey(req);
  if (req.method === "GET") return send(res, 200, { images: await Persona.listImages(key, (req.query || {}).character) });
  if (req.method === "POST") {
    const b = await body(req);
    const out = await Persona.addImage(key, b.character, b, { live: !!b.live, avatar: !!b.as_profile_photo });
    if (!out || !out.id) return send(res, 201, out);
    let check = b.self_check && typeof b.self_check === "object" ? Object.assign({}, b.self_check) : null;
    // Optional face-match score against the reference sheet (only when a provider is configured; see api/_lib/facematch.js).
    if (process.env.FACE_MATCH_URL) {
      try {
        const reg = await Persona.registryGet(key, b.character);
        const refs = ((reg.spec && reg.spec.references) || []).map((r) => r.url).filter((u) => /^https:\/\//.test(u || ""));
        const fm = await faceMatch(refs, out.url);
        if (fm.score !== null) { check = Object.assign(check || {}, { face_score: fm.score, face_score_source: "face-match" }); out.face_score = fm.score; }
      } catch (e) { /* the image is saved either way */ }
    }
    if (b.recipe || b.spec_version || check) {
      try {
        await Persona.tagImage(key, out.id, b.recipe, b.spec_version, check);
        Object.assign(out, { recipe: b.recipe || null, spec_version: b.spec_version || null, self_check: check });
      } catch (e) { out.warnings = ["Image saved, but its shot details weren't: " + e.message]; }
    }
    return send(res, 201, out);
  }
  throw new ApiError(405, "Use GET or POST.", "method");
});
