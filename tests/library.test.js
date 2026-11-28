// Checks the Persona House library: every block rebuilds into a valid block, faces are invented, names don't clash with starters.
"use strict";
const assert = require("assert");
const Blocks = require("../lib/blocks.js");
const lib = require("../templates/library.json");
const starters = require("../templates/blocks.json").blocks.map((b) => b.type + "@" + b.name);
let n = 0;
assert(lib.looks.length >= 150, "library has looks");
lib.looks.forEach((l) => {
  assert(/^\d{6,}$/.test(l.pin), "pin id for " + l.name);
  assert(l.b.wardrobe && l.b.camera && l.b.light, "core blocks for " + l.name);
  Object.keys(l.b).forEach((t) => {
    const b = Blocks.validate({ type: t, name: l.name, version: 1, title: l.title, author: lib.author, data: l.b[t], likeness: t === "face" ? "invented" : undefined });
    assert.strictEqual(b.address, t + "@" + l.name + "/v1");
    assert.deepStrictEqual(b.data, l.b[t], "data survives validation for " + b.address);
    assert(starters.indexOf(t + "@" + l.name) < 0, "name not taken by a starter");
    n++;
  });
});
console.log("library ok: " + lib.looks.length + " looks, " + n + " blocks");
