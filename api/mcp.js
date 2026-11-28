// Persona MCP server (Model Context Protocol, Streamable HTTP, stateless JSON responses).
// Connect from Claude, ChatGPT (developer mode), Cursor, Claude Desktop/Code or any MCP client:
//   URL:  https://persona-ai-characters.vercel.app/api/mcp?key=psn_...
//   or    https://persona-ai-characters.vercel.app/api/mcp with header "Authorization: Bearer psn_..."
"use strict";
const { Persona, apiKey, origin, body, cors, ApiError } = require("./_lib/persona");

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "persona", title: "Persona", version: "1.0.0" };
const INSTRUCTIONS =
  "Persona is a Pinterest-style home for AI characters. These tools act for one creator. " +
  "Start with whoami. To design a character, read get_templates, agree the details with the user, then create_character. " +
  "Add images with add_image (https image_url or base64). Gallery images use one upload each and stay hidden unless live is true. " +
  "Reuse one identity sentence (face, hair, signature detail) in every image prompt so the character stays consistent.";

const imageProps = {
  image_url: { type: "string", description: "https address of a JPEG, PNG or WebP image (up to 10 MB)" },
  image_base64: { type: "string", description: "The image itself as base64 or a data: URL, if there is no web address" },
};
const TOOLS = [
  { name: "whoami", title: "Who am I",
    description: "The creator this connection acts for: name, characters (with slugs) and how many uploads are left.",
    inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "get_templates", title: "Get character templates",
    description: "Persona's character template, a filled example (Nova Reyes), an image prompt pack with shot types, and starter ideas. Read this before designing a character.",
    inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "create_character", title: "Create a character",
    description: "Create a new character owned by this creator. Optionally set a profile photo and up to 6 first images from https URLs. Returns the slug other tools need and the public profile link.",
    inputSchema: { type: "object", required: ["name"], properties: {
      name: { type: "string", maxLength: 60 }, handle: { type: "string", maxLength: 40, description: "Optional @handle" },
      bio: { type: "string", maxLength: 600, description: "Two or three short sentences" },
      avatar_url: { type: "string", description: "Optional https URL of a profile photo" },
      image_urls: { type: "array", items: { type: "string" }, maxItems: 6, description: "Optional https URLs of first images" },
      live: { type: "boolean", description: "Publish the first images right away (default false)" } } } },
  { name: "add_image", title: "Add an image",
    description: "Save an image to one of the creator's characters. Uses one upload unless as_profile_photo is true. Hidden until published unless live is true.",
    inputSchema: { type: "object", required: ["character"], properties: Object.assign({
      character: { type: "string", description: "Character slug, e.g. nova-reyes" } }, imageProps, {
      live: { type: "boolean", description: "Publish right away (default false)" },
      as_profile_photo: { type: "boolean", description: "Use as the profile photo instead of a gallery image" } }) } },
  { name: "list_images", title: "List images",
    description: "A character's uploaded images with their ids and whether each is live.",
    inputSchema: { type: "object", required: ["character"], properties: { character: { type: "string" } } },
    annotations: { readOnlyHint: true } },
  { name: "set_image_live", title: "Publish or hide an image",
    description: "Show (live true) or hide (live false) one image on Persona.",
    inputSchema: { type: "object", required: ["image_id", "live"], properties: { image_id: { type: "string" }, live: { type: "boolean" } } },
    annotations: { idempotentHint: true } },
];
const PROMPTS = [
  { name: "design_character", title: "Design a new Persona character",
    description: "Walks through designing a character from a one-line idea and publishing it.",
    arguments: [{ name: "idea", description: "One line, e.g. a night-shift DJ from Toronto", required: false }] },
];

async function callTool(name, a, key, o) {
  a = a || {};
  switch (name) {
    case "whoami": return Persona.me(key);
    case "get_templates": return Persona.templates();
    case "create_character": return Persona.createCharacter(key, a, o);
    case "add_image": return Persona.addImage(key, a.character, a, { live: !!a.live, avatar: !!a.as_profile_photo });
    case "list_images": return { images: await Persona.listImages(key, a.character) };
    case "set_image_live": return Persona.setLive(key, a.image_id, a.live !== false);
    default: throw Object.assign(new Error("Unknown tool: " + name), { rpcCode: -32602 });
  }
}

async function handle(msg, key, o) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return { jsonrpc: "2.0", id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32600, message: "Invalid request" } };
  const isNote = msg.id === undefined || msg.id === null;
  const ok = (result) => (isNote ? null : { jsonrpc: "2.0", id: msg.id, result });
  const fail = (code, message) => (isNote ? null : { jsonrpc: "2.0", id: msg.id, error: { code, message } });
  const p = msg.params || {};
  switch (msg.method) {
    case "initialize": {
      const v = PROTOCOL_VERSIONS.indexOf(p.protocolVersion) > -1 ? p.protocolVersion : PROTOCOL_VERSIONS[0];
      return ok({ protocolVersion: v, capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "ping": return ok({});
    case "tools/list": return ok({ tools: TOOLS });
    case "prompts/list": return ok({ prompts: PROMPTS });
    case "prompts/get": {
      if (p.name !== "design_character") return fail(-32602, "Unknown prompt");
      const idea = (p.arguments && p.arguments.idea) || "";
      return ok({ description: PROMPTS[0].description, messages: [{ role: "user", content: { type: "text", text:
        "Help me design a new character for Persona" + (idea ? ": " + idea : "") + ". First call whoami and get_templates. " +
        "Fill in the character template with me (name, handle, short bio, look, style, world), show it and let me change it. " +
        "Then write one identity sentence and three image prompts from the prompt pack. When I approve, call create_character." } }] });
    }
    case "tools/call": {
      if (!TOOLS.some((t) => t.name === p.name)) return fail(-32602, "Unknown tool: " + p.name);
      try {
        if (!key) throw new ApiError(401, "No Persona API key. Add ?key=psn_... to the connector URL, or send it as a Bearer token. Create one in Persona Studio → Connect AI.");
        const out = await callTool(p.name, p.arguments, key, o);
        return ok({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: Array.isArray(out) ? { items: out } : out });
      } catch (e) {
        if (e.rpcCode) return fail(e.rpcCode, e.message);
        const message = e instanceof ApiError ? e.message : "Something went wrong on Persona's side.";
        if (!(e instanceof ApiError)) console.error(e);
        return ok({ content: [{ type: "text", text: message }], isError: true });
      }
    }
    default:
      if (msg.method.startsWith("notifications/")) return null;
      return fail(-32601, "Method not found: " + msg.method);
  }
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method === "GET") {
    // No server-to-client stream in this stateless server. Browsers get a friendly note instead.
    if (/text\/html/.test(req.headers.accept || "")) { res.statusCode = 200; res.setHeader("Content-Type", "text/plain; charset=utf-8"); return res.end("Persona MCP server. Add this address as a connector in Claude, ChatGPT or another MCP app. Setup: /connect.html"); }
    res.statusCode = 405; res.setHeader("Allow", "POST, OPTIONS"); return res.end();
  }
  if (req.method === "DELETE") { res.statusCode = 405; return res.end(); }
  if (req.method !== "POST") { res.statusCode = 405; return res.end(); }

  let key = null;
  try { key = apiKey(req); } catch (e) { key = null; } // initialize/tools/list work without a key; tools/call explains what's missing
  let msg;
  try { msg = await body(req); }
  catch (e) { res.statusCode = 400; res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })); }

  const o = origin(req);
  const out = Array.isArray(msg)
    ? (await Promise.all(msg.map((m) => handle(m, key, o)))).filter(Boolean)
    : await handle(msg, key, o);
  if (!out || (Array.isArray(out) && !out.length)) { res.statusCode = 202; return res.end(); }
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(out));
};
