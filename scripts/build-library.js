// Builds the Persona House fashion library (templates/library.json) and its seed SQL (supabase/house-library.sql)
// from templates/library/looks.txt (one look per line, written by looking at each reference pin) and
// templates/library/pins.txt (pin id, saves, board, image ratio). Run: node scripts/build-library.js
//
// Rights: the reference photos stay on Pinterest. The library stores only our own written description of the style,
// scene, camera and light, plus a link to the pin; the page shows the photo through Pinterest's official embed.
// Face blocks are invented (they never describe the person in the photo), as the Content Policy requires.
"use strict";
const fs = require("fs"), path = require("path");
const Blocks = require("../lib/blocks.js");
const root = path.join(__dirname, "..");
const AUTHOR = "Persona House";
const BOARDS = { hb: "Harper's Bazaar US", hu: "Harper's Bazaar", ww: "Who What Wear", is: "InStyle", r: "Refinery29", v: "Vogue" };

// ---------- read sources ----------
const pins = {};
fs.readFileSync(path.join(root, "templates/library/pins.txt"), "utf8").trim().split(";").forEach((s) => {
  const [i, id, saves, board, ratio] = s.trim().split(/\s+/);
  pins[i] = { id, saves: +saves, board: BOARDS[board] || board, ratio: +ratio / 100 };
});
const looks = fs.readFileSync(path.join(root, "templates/library/looks.txt"), "utf8").split("\n")
  .map((l) => l.trim()).filter((l) => l && !/\|SKIP$/.test(l)).map((l) => {
    const f = l.split("|");
    if (f.length !== 15) throw new Error("Bad line (" + f.length + " fields): " + l.slice(0, 60));
    const [i, age, faceStyle, hair, build, outfit, style, palette, camera, light, location, props, motion, mood, pose] = f;
    if (!pins[i]) throw new Error("No pin for look " + i);
    return { i, age, faceStyle, hair: hair.split(";"), build, outfit, style: list(style), palette: list(palette), camera, light, location,
      props: list(props), motion, mood: mood.split(";"), pose, pin: pins[i] };
  });

function list(s) { return String(s || "").split(",").map((x) => x.trim()).filter((x) => x && x !== "n/a"); }
function na(s) { return !s || /^n\/a$/i.test(s.trim()); }
function short(s, max) {
  if (s.length <= max) return s;
  const cut = s.search(/ (with|over|and|under) /);
  if (cut > 8 && cut <= max) return s.slice(0, cut);
  s = s.slice(0, max); return s.slice(0, s.lastIndexOf(" ")).replace(/\s+(with|and|in|of|over|a)$/, "");
}
function cap(s) { s = String(s || "").trim(); return s.charAt(0).toUpperCase() + s.slice(1); }

// ---------- invented faces ----------
// Picked by a fixed rule from each look's number, so a rebuild gives the same faces. None of this comes from the photo.
const SHAPES = ["soft oval face, high cheekbones", "heart-shaped face, pointed chin", "long face, defined jaw", "round face, full cheeks",
  "square face, strong brow line", "diamond face, sharp cheekbones", "oval face, straight nose, wide mouth", "angular face, hollow cheeks",
  "soft square face, short chin", "long oval face, aquiline nose", "round face, small upturned nose", "heart face, wide-set features"];
const EYES = ["dark brown almond-shaped", "hazel, slightly hooded", "grey-green, upturned", "deep brown, monolid", "amber, wide-set",
  "pale blue, downturned", "black-brown, large and round", "green, deep-set", "light brown, cat-like", "blue-grey, heavy-lidded"];
const SKINS = ["fair skin, cool undertone", "light olive skin", "warm beige skin", "golden tan skin", "light brown skin, warm undertone",
  "medium brown skin", "deep brown skin, satin finish", "rich ebony skin", "pale skin with rosy cheeks", "sun-kissed skin with freckles"];
const MARKS = ["a small mole above the lip", "a faint scar through one eyebrow", "a tiny gap between the front teeth", "freckles across the nose",
  "a dimple on the left cheek only", "a beauty mark under the right eye", "a slightly crooked smile", "a thin silver nose stud",
  "three small ear piercings climbing the left ear", "very straight, thick brows", "a cleft chin", "a light dusting of freckles on the cheeks"];
function pick(arr, n, salt) { return arr[(n * 7 + salt * 13) % arr.length]; }
function ageText(a) { const m = /^(\d+)-(\d+)$/.exec(a || ""); return m ? m[1] + " to " + m[2] : ""; }

// ---------- blocks ----------
function buildLook(L, n) {
  const name = "ph-" + String(n).padStart(3, "0");
  const parts = L.outfit.replace(/^duo: /i, "").split(/,|;/).map((x) => x.trim()).filter(Boolean);
  let title = cap(parts[0]).replace(/ (with|over|worn|and|under|cinched|tucked|open) .*$/, "");
  if (parts[1] && title.length + parts[1].length < 50) title += ", " + parts[1].replace(/ (with|over|worn|peeking|tucked) .*$/, "");
  title = short(title, 54);
  if (/^duo:/i.test(L.outfit)) title = "Duo: " + title;
  const tags = ["house"].concat(L.style.slice(0, 5));
  const mk = (type, label, data, extra) => Blocks.validate(Object.assign({ type, name, version: 1, title: title + " · " + label,
    author: AUTHOR, data, tags }, extra || {}));
  const out = [];
  if (!na(L.age)) {
    const styling = na(L.faceStyle) || /^n\/a/.test(L.faceStyle) ? "" : "; styled with " + L.faceStyle;
    const mark = pick(MARKS, n, 4);
    out.push(mk("face", "face", { age_range: ageText(L.age), face: pick(SHAPES, n, 1) + styling, eyes: pick(EYES, n, 2), skin: pick(SKINS, n, 3),
      signature_detail: mark, never_change: [mark] }, { likeness: "invented" }));
  }
  if (!na(L.build)) out.push(mk("body", "body", { build: L.build }));
  const [hc, hl, hcut, ht] = L.hair;
  if (!na(hc) || !na(hcut)) out.push(mk("hair", "hair", { colour: na(hc) ? "" : hc, length: na(hl) ? "" : hl, cut: na(hcut) ? "" : hcut, texture: na(ht) ? "" : ht }));
  out.push(mk("wardrobe", "outfit", { outfit: L.outfit, style: L.style, palette: L.palette }));
  out.push(mk("camera", "camera", { description: L.camera, full_outfit: /full length/i.test(L.camera) }));
  out.push(mk("light", "light", { description: L.light }));
  out.push(mk("location", "location", { description: L.location }));
  out.push(mk("scene", "scene", { description: cap(L.pose) + ", " + L.location, props: L.props }));
  out.push(mk("motion", "motion", { description: /^static$/i.test(L.motion) ? "still moment, no wind, fabric at rest" : L.motion }));
  const [feeling, expression, grade] = L.mood;
  out.push(mk("mood", "mood", { feeling, expression, grade, keywords: [feeling].concat(L.style.slice(0, 2)) }));
  out.push(mk("pose", "pose", { description: L.pose }));
  return {
    n, name, title, saves: L.pin.saves, tags: L.style, palette: L.palette, ratio: L.pin.ratio,
    source: { pin_id: L.pin.id, url: "https://www.pinterest.com/pin/" + L.pin.id + "/", board: L.pin.board },
    blocks: out,
  };
}

// Most-saved first.
looks.sort((a, b) => b.pin.saves - a.pin.saves);
const lib = looks.map((L, k) => buildLook(L, k + 1));
const seen = {};
lib.forEach((l) => l.blocks.forEach((b) => { if (seen[b.address]) throw new Error("Duplicate " + b.address); seen[b.address] = 1; }));
const reserved = JSON.parse(fs.readFileSync(path.join(root, "templates/blocks.json"), "utf8")).blocks.map((b) => b.type + "@" + b.name);
lib.forEach((l) => l.blocks.forEach((b) => { if (reserved.indexOf(b.type + "@" + b.name) > -1) throw new Error("Name taken by a starter: " + b.address); }));

// Lean copy for the Library page: per look, just the data of each block. library.js rebuilds the full blocks
// (address type@ph-NNN/v1, author Persona House, tags, likeness) so the file stays small.
fs.writeFileSync(path.join(root, "templates/library.json"), JSON.stringify({
  about: "Persona House fashion library. Generated by scripts/build-library.js from templates/library/. Each look links to the public Pinterest pin it was studied from; the photo stays on Pinterest. Faces are invented.",
  author: AUTHOR, format: "templates/block-template.json",
  looks: lib.map((l) => ({ n: l.n, name: l.name, title: l.title, saves: l.saves, tags: l.tags, palette: l.palette, ratio: l.ratio, pin: l.source.pin_id, board: l.source.board,
    b: l.blocks.reduce((o, b) => { o[b.type] = b.data; return o; }, {}) })),
}) + "\n");

// ---------- SQL ----------
const q = (s) => (s == null ? "null" : "'" + String(s).replace(/'/g, "''") + "'");
const rows = [];
lib.forEach((l) => l.blocks.forEach((b) => rows.push("  (" + [q(b.address), q(b.type), q(b.name), b.version, q(b.title), q(JSON.stringify(b.data)) + "::jsonb",
  "null", "array[" + b.tags.map(q).join(",") + "]::text[]", "null", q(b.type === "face" ? "invented" : null), q(AUTHOR)].join(", ") + ")")));
const sql = `-- Persona House fashion library: ${lib.length} looks, ${rows.length} blocks.
-- Run once in Supabase (SQL Editor > New query > paste > Run), after supabase/character-blocks.sql.
-- Safe to run again: it updates the rows instead of adding copies.
-- Generated by scripts/build-library.js. The blocks show up in Studio > Combine for everyone, by "Persona House".

insert into public.blocks (address, type, name, version, title, data, preview_url, tags, remix_of, likeness, author_name) values
${rows.join(",\n")}
on conflict (address) do update set title = excluded.title, data = excluded.data, tags = excluded.tags, author_name = excluded.author_name;

-- Check: should show ${lib.length} looks and ${rows.length} blocks.
select count(distinct name) as looks, count(*) as blocks from public.blocks where author_name = '${AUTHOR}';
`;
fs.writeFileSync(path.join(root, "supabase/house-library.sql"), sql);
console.log(lib.length + " looks, " + rows.length + " blocks written.");
