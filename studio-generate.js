// Studio: generate images right in the Shot builder, from the compiled prompt (see api/generate.js).
// One image per request, so a batch is a short queue that stops at the daily free limit.
// Results stay here until the creator keeps some; kept images are saved as hidden drafts with an origin record
// (tool, prompt, seed, recipe), the rights confirmation, and the shot recipe for the drift guard. Every pin shows the AI label.
(function () {
  "use strict";
  var MAX_BATCH = 8;
  var G = { status: null, loading: null, trays: {}, busy: false, stop: false };

  function $(id) { return document.getElementById(id); }
  function token() {
    if (!Studio.client) return Promise.resolve(null);
    return Studio.client.auth.getSession().then(function (r) { return r.data.session ? r.data.session.access_token : null; });
  }
  function call(method, payload) {
    return token().then(function (t) {
      var h = { "Content-Type": "application/json" };
      if (t) h.Authorization = "Bearer " + t;
      return fetch("api/generate", { method: method, headers: h, body: payload ? JSON.stringify(payload) : undefined });
    }).then(function (r) {
      return r.text().then(function (txt) {
        var d = null; try { d = JSON.parse(txt); } catch (e) {}
        if (!r.ok) {
          var err = new Error((d && d.error && d.error.message) || (r.status === 404 ? "Image generation isn't on this deployment yet." : "Something went wrong (" + r.status + ")."));
          err.code = d && d.error && d.error.code; throw err;
        }
        return d;
      });
    });
  }
  function status(force) {
    if (Studio.mode !== "supabase") return Promise.resolve({ ready: false, message: "Generating works on the live site after you sign in." });
    if (G.status && !force) return Promise.resolve(G.status);
    if (!G.loading || force) G.loading = call("GET").then(function (s) { G.status = s; return s; }, function (e) { return { ready: false, message: e.message }; });
    return G.loading;
  }
  function left(s) {
    if (!s || !s.limits || !s.usage) return MAX_BATCH;
    return Math.max(0, Math.min(s.limits.per_creator - s.usage.user_used, s.limits.site - s.usage.site_used));
  }
  function usageText(s) {
    if (!s.usage) return "";
    return "Today: you’ve made " + s.usage.user_used + " of " + s.limits.per_creator + ", Persona " + s.usage.site_used + " of " + s.limits.site + ". Resets at midnight UTC.";
  }
  function b64ToFile(b64, mime, name) {
    var bin = atob(b64), n = bin.length, u8 = new Uint8Array(n);
    for (var i = 0; i < n; i++) u8[i] = bin.charCodeAt(i);
    return new File([u8], name, { type: mime });
  }

  // ctx: { c, family?, shots(n, mode, family) -> [{ prompt, recipe, label }], specVersion, tag(id, recipe), reload() }
  function mount(box, ctx) {
    var c = ctx.c, tray = G.trays[c.slug] = G.trays[c.slug] || [];
    box.innerHTML = '<div class="gen"><h3>Generate here</h3><p class="muted small" id="gen-info">Checking the image model…</p></div>';
    status().then(function (s) {
      if (!box.isConnected) return;
      if (!s.ready) {
        box.innerHTML = '<div class="gen"><h3>Generate here</h3><p class="muted small">' + esc(s.message || "Image generation isn't switched on yet.") + '</p>' + trayHtml() + '</div>';
        wireTray(); return;
      }
      var m = s.model;
      box.innerHTML = '<div class="gen"><h3>Generate here</h3>' +
        '<p class="muted small" id="gen-info"><b>' + esc(m.name) + '</b>' + (m.free ? " · free" : "") + ' · ' + esc(m.size.replace("x", "×")) +
        (m.size === "1024x1024" ? " square" : "") + '. Uses the ' + esc(m.family) + ' version of this prompt. <span id="gen-use">' + esc(usageText(s)) + '</span></p>' +
        '<label class="rights gen-ok"><input type="checkbox" id="gen-ok"' + (G.ok ? " checked" : "") + '><span>' + esc(c.name) + ' is an invented character. These images won’t show or copy a real person’s face. <a href="content-policy.html" target="_blank">Content Policy</a></span></label>' +
        '<div class="gen-row"><label class="ct-field"><span>How many</span><select id="gen-n">' +
        [1, 2, 3, 4, 6, 8].map(function (n) { return '<option value="' + n + '"' + (n === (G.n || 1) ? " selected" : "") + '>' + n + (n === 1 ? " image" : " images") + '</option>'; }).join("") + '</select></label>' +
        '<label class="ct-field"><span>Batch</span><select id="gen-mode"><option value="seeds">Same shot, different takes</option><option value="fresh"' + (G.mode === "fresh" ? " selected" : "") + '>A fresh set-up for each image</option></select></label>' +
        '<button class="btn" type="button" id="gen-go">Generate</button><button class="btn ghost" type="button" id="gen-stop" hidden>Stop</button></div>' +
        '<p class="ct-msg" id="gen-msg"></p>' + trayHtml() + '</div>';
      $("gen-ok").onchange = function () { G.ok = this.checked; if (this.checked) { this.parentNode.classList.remove("need"); say(""); } };
      $("gen-n").onchange = function () { G.n = +this.value; };
      $("gen-mode").onchange = function () { G.mode = this.value; };
      $("gen-stop").onclick = function () { G.stop = true; this.disabled = true; };
      $("gen-go").onclick = function () { run(s); };
      wireTray();
      if (G.busy) lock(true);
    });

    function say(t, bad) { var el = $("gen-msg"); if (el) { el.textContent = t || ""; el.className = "ct-msg" + (bad ? " err" : ""); } }
    function lock(on) { var g = $("gen-go"), st = $("gen-stop"); if (g) g.disabled = on; if (st) { st.hidden = !on; st.disabled = false; } }

    function run(s) {
      if (G.busy) return;
      if (!$("gen-ok").checked) { var box2 = document.querySelector(".gen-ok"); box2.classList.remove("need"); void box2.offsetWidth; box2.classList.add("need"); say("Tick the box to confirm the character is invented.", true); return; }
      var room = left(s);
      if (!room) { say("No free images left today. They reset at midnight UTC.", true); return; }
      var want = Math.min(+$("gen-n").value || 1, room, MAX_BATCH);
      var jobs = ctx.shots(want, $("gen-mode").value, s.model.family);
      if (!jobs.length) { say("Build a shot first.", true); return; }
      G.busy = true; G.stop = false; lock(true);
      var done = 0, failed = null;
      say("Making image 1 of " + jobs.length + "…");
      jobs.reduce(function (pr, job, i) {
        return pr.then(function () {
          if (G.stop || failed) return;
          say("Making image " + (i + 1) + " of " + jobs.length + "…");
          return call("POST", { character: c.slug, prompt: job.prompt }).then(function (d) {
            done++;
            var file = b64ToFile(d.image, d.mime, "gen-" + Date.now() + "-" + i + ".jpg");
            tray.unshift({ file: file, url: URL.createObjectURL(file), prompt: job.prompt, recipe: job.recipe, label: job.label,
              seed: d.seed, model: d.model.name, keep: true, made: Date.now() });
            if (G.status) { G.status.usage = d.usage; G.status.limits = d.limits; }
            var u = $("gen-use"); if (u && G.status) u.textContent = usageText(G.status);
            drawTray();
          }, function (e) { failed = e; });
        });
      }, Promise.resolve()).then(function () {
        G.busy = false; lock(false);
        if (failed) say((done ? done + " made. Then: " : "") + failed.message, true);
        else say(G.stop ? "Stopped after " + done + "." : done + (done === 1 ? " image" : " images") + " ready below. Tick the ones to keep, then save.");
        G.stop = false;
      });
    }

    function trayHtml() {
      return '<div class="gen-tray" id="gen-tray"></div>';
    }
    function drawTray() {
      var el = $("gen-tray"); if (!el) return;
      if (!tray.length) { el.innerHTML = ""; return; }
      var kept = tray.filter(function (t) { return t.keep; }).length;
      el.innerHTML = '<div class="gen-grid">' + tray.map(function (t, i) {
        return '<figure class="gen-item' + (t.keep ? " on" : "") + '"><img src="' + t.url + '" alt="Generated image ' + (i + 1) + '">' +
          '<figcaption><label><input type="checkbox" data-keep="' + i + '"' + (t.keep ? " checked" : "") + '> Keep</label>' +
          '<small class="muted">' + esc(t.label || "") + ' · seed ' + t.seed + '</small></figcaption></figure>';
      }).join("") + '</div>' +
        '<div class="gen-save"><button class="btn" type="button" id="gen-save"' + (kept ? "" : " disabled") + '>Save ' + kept + ' to ' + esc(c.name) + '</button>' +
        '<button class="linkbtn" type="button" id="gen-clear">Discard the rest</button>' +
        '<small class="muted">Saved as hidden drafts with an AI label and origin record. Each one uses an upload from your allowance.</small></div>' +
        '<p class="ct-msg" id="gen-savemsg"></p>';
      el.querySelectorAll("[data-keep]").forEach(function (cb) { cb.onchange = function () { tray[+cb.dataset.keep].keep = cb.checked; drawTray(); }; });
      $("gen-clear").onclick = function () {
        for (var i = tray.length - 1; i >= 0; i--) if (!tray[i].keep) { URL.revokeObjectURL(tray[i].url); tray.splice(i, 1); }
        drawTray();
      };
      $("gen-save").onclick = save;
    }
    function wireTray() { drawTray(); }

    function save() {
      var btn = $("gen-save"), msg = $("gen-savemsg");
      var keep = tray.filter(function (t) { return t.keep; });
      if (!keep.length) return;
      btn.disabled = true;
      Studio.quota().then(function (q) {
        var take = keep.slice(0, q.left);
        if (!take.length) throw new Error("You've used all " + q.limit + " uploads. Every " + Studio.POINTS_PER_UPLOAD + " points unlocks one more.");
        msg.textContent = "Saving " + take.length + "…"; msg.className = "ct-msg";
        return take.reduce(function (pr, t) {
          return pr.then(function () {
            var origin = { tool: t.model, recipe: (t.prompt + "\n\nSeed: " + t.seed + "\nRecipe: " + JSON.stringify(t.recipe)).slice(0, 4000) };
            return Studio.upload(c, [t.file], false, true, origin).then(function (ids) {
              var id = ids && ids[0];
              if (id && t.recipe) return ctx.tag(id, t.recipe).catch(function () {});
            }).then(function () {
              var i = tray.indexOf(t); if (i >= 0) { URL.revokeObjectURL(t.url); tray.splice(i, 1); }
            });
          });
        }, Promise.resolve()).then(function () {
          return take.length + " saved as hidden drafts" + (take.length < keep.length ? ". " + (keep.length - take.length) + " didn't fit in your upload allowance." : ". Switch them live in Images.");
        });
      }).then(function (text) {
        G.note = text; ctx.reload();
      }, function (e) { btn.disabled = false; msg.textContent = e.message; msg.className = "ct-msg err"; });
    }
    if (G.note) { var n = G.note; G.note = null; setTimeout(function () { var el = $("gen-msg"); if (el) { el.textContent = n; el.className = "ct-msg"; } }, 0); }
  }

  window.StudioGen = { mount: mount, status: status };
})();
