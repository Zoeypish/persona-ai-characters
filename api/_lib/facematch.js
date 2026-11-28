// Face-match hook for the drift guard's consistency check.
// Scoring "is this the same face?" needs a vision/face model, which costs money per image, so it is off until configured.
// To switch it on, set two environment variables in Vercel:
//   FACE_MATCH_URL  — an https endpoint that accepts POST { references: [url...], image: url } and returns { score: 0-100 }
//   FACE_MATCH_KEY  — sent as "Authorization: Bearer <key>"
// Any provider works behind that small contract (a face-embedding service, or a tiny function that asks a vision model).
"use strict";
async function faceMatch(references, image) {
  const url = (process.env.FACE_MATCH_URL || "").trim();
  if (!url) return { score: null, status: "not_configured" };
  if (!references || !references.length || !image) return { score: null, status: "no_references" };
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (process.env.FACE_MATCH_KEY || "") },
      body: JSON.stringify({ references: references.slice(0, 4), image }),
    });
    const j = await r.json().catch(() => ({}));
    const score = Number(j.score);
    if (!r.ok || !isFinite(score)) return { score: null, status: "error" };
    return { score: Math.max(0, Math.min(100, Math.round(score))), status: "ok" };
  } catch (e) { return { score: null, status: "error" }; }
  finally { clearTimeout(t); }
}
module.exports = { faceMatch };
