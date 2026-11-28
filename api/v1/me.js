// GET /api/v1/me — the creator behind this API key, their characters and upload allowance.
const { Persona, apiKey, send, handler, ApiError } = require("../_lib/persona");
module.exports = handler(async (req, res) => {
  if (req.method !== "GET") throw new ApiError(405, "Use GET.", "method");
  send(res, 200, await Persona.me(apiKey(req)));
});
