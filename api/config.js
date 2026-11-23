// Vercel serverless function: exposes the public Supabase settings from environment variables.
module.exports = function (req, res) {
  var url = process.env.SUPABASE_URL || "", key = process.env.SUPABASE_ANON_KEY || "";
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(url && key
    ? "window.PERSONA_CONFIG = " + JSON.stringify({ supabaseUrl: url, supabaseAnonKey: key }) + ";"
    : "/* Supabase not configured: demo mode */");
};
