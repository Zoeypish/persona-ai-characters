// GET /api/v1/wardrobe?q=<words> — real items from Persona's product catalog to dress a character in.
// Pass the chosen ids as "products" to POST /api/v1/shots, and the outfit is written into the prompt.
const { Persona, send, handler, ApiError } = require("../_lib/persona");
module.exports = handler(async (req, res) => {
  if (req.method !== "GET") throw new ApiError(405, "Use GET.", "method");
  const q = String((req.query || {}).q || "").trim();
  if (q.length < 2) throw new ApiError(400, "Search with at least 2 letters, e.g. ?q=black boots", "bad_request");
  res.setHeader("Cache-Control", "public, max-age=600");
  send(res, 200, { products: await Persona.wardrobe(q) });
});
