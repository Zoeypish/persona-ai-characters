// Persona data layer.
// If Supabase is configured (config.js or Vercel env via /api/config), images, live/hidden choices and login use Supabase.
// Otherwise it runs in demo mode: uploads stay in this browser (IndexedDB) and choices in localStorage.
(function () {
  var cfg = window.PERSONA_CONFIG || {};
  // Works with both the legacy anon key (eyJ...) and the new publishable key (sb_publishable_...).
  var key = (cfg.supabaseAnonKey || cfg.supabasePublishableKey || "").trim();
  var sb = null;
  if (cfg.supabaseUrl && key && window.supabase) {
    try { sb = window.supabase.createClient(cfg.supabaseUrl.trim().replace(/\/+$/, ""), key, { auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" } }); }
    catch (e) { console.warn("Supabase disabled:", e); sb = null; }
  }
  var BUCKET = "character-images";
  // Demo mode is only for trying the site on your own computer. On the real site, if Supabase can't load,
  // say so instead of quietly signing people in as the demo creator.
  var isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|)$/.test(location.hostname) || location.protocol === "file:";
  var mode = sb ? "supabase" : (isLocal ? "demo" : "error");
  if (mode !== "demo") { try { localStorage.removeItem("persona-session-v1"); } catch (e) {} }

  // ---------- demo storage ----------
  var DB = "persona-studio", STORE = "uploads", LIVE_KEY = "persona-live-v1", SESSION_KEY = "persona-session-v1";
  function idb() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error("no indexeddb"));
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE, { keyPath: "id" }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function tx(mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, mode), req = fn(t.objectStore(STORE));
        t.oncomplete = function () { res(req && req.result); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)) || null; } catch (e) { return null; } }
  function writeJSON(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  var blobUrls = {};
  function uploadedImg(row, c) {
    var src = row.url || (row.blob && (blobUrls[row.id] || (blobUrls[row.id] = URL.createObjectURL(row.blob))));
    return { id: row.id, src: src, alt: c.name + ", uploaded image", uploaded: true, credit: "Uploaded by " + c.creator,
      created: row.created || Date.parse(row.created_at) || 0, path: row.path,
      origin: { tool: row.origin_tool || (row.origin && row.origin.tool) || "", recipe: row.origin_recipe || (row.origin && row.origin.recipe) || "",
        source: row.origin_source || "", rights: !!(row.rights_confirmed || row.rights) } };
  }

  // Review status: 'ok' is shown; 'review' (reported, waiting for a decision) and 'removed' are hidden everywhere.
  var HIDDEN = {};
  function moderated(im, row) {
    im.moderation = (row && row.moderation) || "ok";
    if (im.moderation !== "ok") HIDDEN[im.id] = im.moderation; else delete HIDDEN[im.id];
    return im;
  }
  // Demo mode keeps reports in this browser.
  var REPORTS_KEY = "persona-reports-v1";
  function demoReports() { return readJSON(REPORTS_KEY) || []; }

  // rows: [{id, live, url?/blob?, ...}] for one character
  function merge(c, rows) {
    var byId = {}; rows.forEach(function (r) { byId[r.id] = r; });
    var builtIn = imagesFor(c).map(function (im) {
      im.live = byId[im.id] ? !!byId[im.id].live : true; return moderated(im, byId[im.id]);
    });
    var ups = rows.filter(function (r) { return r.url || r.blob; })
      .map(function (r) { var im = uploadedImg(r, c); im.live = !!r.live; return moderated(im, r); })
      .sort(function (a, b) { return a.created - b.created; });
    return builtIn.concat(ups);
  }

  function rowsFor(c) {
    if (sb) {
      return sb.from("images").select("*").eq("character_slug", c.slug)
        .then(function (r) { return r.error ? [] : r.data; });
    }
    var live = readJSON(LIVE_KEY) || {};
    return tx("readonly", function (st) { return st.getAll(); }).catch(function () { return []; }).then(function (ups) {
      var rows = (ups || []).filter(function (u) { return u.slug === c.slug; })
        .map(function (u) { return { id: u.id, blob: u.blob, created: u.created, live: !!live[u.id], origin: u.origin, rights: u.rights }; });
      imagesFor(c).forEach(function (im) { if (live[im.id] !== undefined) rows.push({ id: im.id, live: live[im.id] }); });
      var mod = readJSON("persona-moderation-v1") || {};
      rows.forEach(function (r) { if (mod[r.id]) r.moderation = mod[r.id]; });
      imagesFor(c).forEach(function (im) {
        if (mod[im.id] && !rows.some(function (r) { return r.id === im.id; })) rows.push({ id: im.id, live: true, moderation: mod[im.id] });
      });
      return rows;
    });
  }

  // ---------- characters made by creators (Supabase table "characters", or this browser in demo mode) ----------
  var LOCAL_CHARS = "persona-characters-v1";
  var BUILT_IN = (window.CHARACTERS || []).map(function (c) { return c.slug; });
  function slugify(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  }
  function fromRow(r) {
    return { slug: r.slug, name: r.name, handle: r.handle || "", bio: r.bio ? String(r.bio).split(/\n\s*\n/).filter(Boolean) : [],
      tagline: "", origin: "", category: "", knownFor: [], link: "", creator: r.creator_name || "", since: String(new Date(r.created_at || Date.now()).getFullYear()),
      audience: "New on Persona", avatar: r.avatar_url || "", owner: r.owner, builtIn: 0, userMade: true };
  }
  function addChars(rows) {
    rows.forEach(function (r) {
      var c = fromRow(r);
      if (!window.CHARACTERS.some(function (x) { return x.slug === c.slug; })) window.CHARACTERS.push(c);
    });
    return window.CHARACTERS;
  }
  function loadCharacters() {
    if (sb) return sb.from("characters").select("*").order("created_at").then(function (r) {
      if (r.error) { console.warn("Creator characters not loaded:", r.error.message); return window.CHARACTERS; }
      return addChars(r.data || []);
    }, function () { return window.CHARACTERS; });
    return Promise.resolve(addChars(readJSON(LOCAL_CHARS) || []));
  }
  // Shrinks a photo to at most `max` px on its long side, as a JPEG.
  function shrink(file, max) {
    return new Promise(function (res) {
      if (!file || !/^image\//.test(file.type)) return res(null);
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var cv = document.createElement("canvas"); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
        cv.toBlob(function (b) { res(b || file); }, "image/jpeg", 0.88);
      };
      img.onerror = function () { URL.revokeObjectURL(url); res(file); };
      img.src = url;
    });
  }
  function blobToDataUrl(b) {
    return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { res(""); }; fr.readAsDataURL(b); });
  }
  function freeSlug(name) {
    var base = slugify(name) || "character", s = base, n = 2;
    while (BUILT_IN.indexOf(s) > -1 || window.CHARACTERS.some(function (c) { return c.slug === s; })) s = base + "-" + n++;
    return s;
  }

  window.Studio = {
    mode: mode,
    client: sb, // Supabase client (null in demo mode); used by the Connect AI page
    // Every page waits for this before reading CHARACTERS, so creator-made characters are included.
    ready: loadCharacters(),
    slugify: slugify,
    // fields: {name, handle, bio, avatar (File)}. Returns the new character. The account that creates it owns it.
    createCharacter: function (fields, user) {
      var name = String(fields.name || "").trim().slice(0, 60);
      if (!name) return Promise.reject(new Error("Give your character a name."));
      if (!user) return Promise.reject(new Error("Please sign in again."));
      if (!fields.rights) return Promise.reject(new Error("Please tick the box to confirm your character follows the Content Policy."));
      var slug = freeSlug(name);
      var handle = String(fields.handle || "").trim().replace(/^@?/, "@").slice(0, 40);
      if (handle === "@") handle = "@" + slug.replace(/-/g, "");
      var row = { slug: slug, name: name, handle: handle, bio: String(fields.bio || "").trim().slice(0, 600), creator_name: user.name || "", owner: user.id, rights_confirmed: true };
      return shrink(fields.avatar, 800).then(function (blob) {
        if (sb) {
          var up = Promise.resolve();
          if (blob) {
            var path = slug + "/avatar-" + Date.now() + ".jpg";
            up = sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" }).then(function (r) {
              if (r.error) throw r.error;
              row.avatar_url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; row.avatar_path = path;
            });
          }
          return up.then(function () { return sb.from("characters").insert(row).select().single(); }).then(function (r) {
            if (r.error) {
              if (/relation .*characters.* does not exist|schema cache/i.test(r.error.message)) throw new Error("Creating characters isn't switched on yet. Run supabase/create-characters.sql in Supabase first.");
              if (/rights_confirmed/i.test(r.error.message)) throw new Error("The safety update isn't switched on yet. Run supabase/accounts-and-safety.sql in Supabase first.");
              throw new Error(r.error.code === "23505" ? "That name is taken. Try another one." : r.error.message);
            }
            return addChars([r.data]) && window.CHARACTERS.filter(function (c) { return c.slug === slug; })[0];
          });
        }
        return (blob ? blobToDataUrl(blob) : Promise.resolve("")).then(function (data) {
          row.avatar_url = data; row.created_at = new Date().toISOString();
          var list = readJSON(LOCAL_CHARS) || []; list.push(row); writeJSON(LOCAL_CHARS, list);
          addChars([row]);
          return window.CHARACTERS.filter(function (c) { return c.slug === slug; })[0];
        });
      });
    },
    all: function (c) { return rowsFor(c).then(function (rows) { return merge(c, rows); }); },
    liveFor: function (c) { return Studio.all(c).then(function (l) { return l.filter(function (im) { return im.live && im.moderation === "ok"; }); }); },
    // True if an image is under review or was taken down (used to hide it from Saved too).
    isHidden: function (id) { return !!HIDDEN[id]; },

    setLive: function (c, id, on) {
      if (sb) return sb.from("images").upsert({ id: id, character_slug: c.slug, live: !!on }, { onConflict: "id" });
      var m = readJSON(LIVE_KEY) || {}; m[id] = !!on; writeJSON(LIVE_KEY, m); return Promise.resolve();
    },

    // rights: the creator ticked "I own or have the rights to these images, and no real person is shown without consent".
    // origin: {tool, recipe} — which AI tool made the images, and the prompt or recipe (optional). Shown on each image.
    upload: function (c, files, live, rights, origin) {
      origin = origin || {};
      var tool = String(origin.tool || "").trim().slice(0, 80), recipe = String(origin.recipe || "").trim().slice(0, 4000);
      if (!rights) return Promise.reject(new Error("Please tick the box to confirm you have the rights to these images."));
      var now = Date.now();
      var list = Array.prototype.slice.call(files).filter(function (f) { return /^image\//.test(f.type); });
      if (sb) {
        return Promise.all(list.map(function (f, i) {
          var id = "up-" + now + "-" + i, ext = (f.name.split(".").pop() || "jpg").toLowerCase();
          var path = c.slug + "/" + id + "." + ext;
          return sb.storage.from(BUCKET).upload(path, f, { contentType: f.type }).then(function (r) {
            if (r.error) throw r.error;
            var url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
            return sb.from("images").insert({ id: id, character_slug: c.slug, url: url, path: path, live: !!live, rights_confirmed: true,
              origin_tool: tool || null, origin_recipe: recipe || null })
              .then(function (r2) {
                if (r2.error && /rights_confirmed/i.test(r2.error.message)) throw new Error("The safety update isn't switched on yet. Run supabase/accounts-and-safety.sql in Supabase first.");
                if (r2.error) throw r2.error;
              });
          });
        }));
      }
      if (live) { var lm = readJSON(LIVE_KEY) || {}; list.forEach(function (f, i) { lm["up-" + now + "-" + i] = true; }); writeJSON(LIVE_KEY, lm); }
      return tx("readwrite", function (st) {
        list.forEach(function (f, i) { st.put({ id: "up-" + now + "-" + i, slug: c.slug, name: f.name, blob: f, created: now + i, rights: true, rightsAt: now, origin: { tool: tool, recipe: recipe } }); });
      });
    },

    remove: function (c, im) {
      if (sb) {
        return sb.from("images").delete().eq("id", im.id).then(function () {
          if (im.path) return sb.storage.from(BUCKET).remove([im.path]);
        });
      }
      var m = readJSON(LIVE_KEY) || {}; delete m[im.id]; writeJSON(LIVE_KEY, m);
      return tx("readwrite", function (st) { st.delete(im.id); });
    },

    // ---------- login (Google only) ----------
    session: function () {
      if (sb) return sb.auth.getSession().then(function (r) {
        var s = r.data.session; if (!s) return null;
        var m = s.user.user_metadata || {};
        return { id: s.user.id, email: s.user.email, name: m.full_name || m.name || s.user.email, avatar: m.avatar_url };
      });
      return Promise.resolve(mode === "demo" ? readJSON(SESSION_KEY) : null);
    },
    // Slugs of the characters this account may manage. Set by the site owner in Supabase (creators.characters).
    myCharacters: function () {
      if (sb) return Studio.session().then(function (u) {
        if (!u) return [];
        return sb.from("creators").select("characters").eq("id", u.id).maybeSingle()
          .then(function (r) { return (r.data && r.data.characters) || []; });
      });
      return Studio.session().then(function (u) {
        return u ? CREATOR.characters.concat((readJSON(LOCAL_CHARS) || []).map(function (r) { return r.slug; })) : [];
      });
    },
    signInWithGoogle: function () {
      if (sb) return sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname.replace(/[^/]*$/, "") + "studio.html" } });
      if (mode === "error") return Promise.reject(new Error("Sign-in couldn't load. Please refresh the page and try again."));
      writeJSON(SESSION_KEY, { id: "demo", email: "noor@persona.demo", name: CREATOR.name });
      location.href = "studio.html";
      return Promise.resolve();
    },
    signOut: function () {
      // The account keeps its saves and follows; this device forgets them so the next person starts fresh.
      function forget() { if (window.Social) Social.clearLocal(); }
      if (sb) return sb.auth.signOut().then(forget, forget);
      writeJSON(SESSION_KEY, null); forget(); return Promise.resolve();
    },

    // ---------- safety: reports, takedown requests, review ----------
    // r: {image_id, character_slug, reason, details}. Signed-in people only; one report per person per image.
    report: function (r) {
      if (sb) return Studio.session().then(function (u) {
        if (!u) throw new Error("Sign in to report an image.");
        return sb.from("reports").insert({ kind: "report", image_id: r.image_id, character_slug: r.character_slug, image_url: r.image_url || null,
          reason: r.reason, details: (r.details || "").slice(0, 2000) || null });
      }).then(function (res) {
        if (res.error && res.error.code === "23505") return "already";
        if (res.error) throw new Error(/reports/.test(res.error.message) ? "Reporting isn't switched on yet." : res.error.message);
        return "ok";
      });
      return Studio.session().then(function (u) {
        if (!u) throw new Error("Sign in to report an image.");
        var list = demoReports();
        if (list.some(function (x) { return x.kind === "report" && x.image_id === r.image_id && x.reporter === u.id; })) return "already";
        list.push(Object.assign({ id: "rep-" + Date.now(), kind: "report", reporter: u.id, status: "open", created_at: new Date().toISOString() }, r));
        writeJSON(REPORTS_KEY, list); return "ok";
      });
    },
    // t: {image_url, page_url, reason, details, contact_name, contact_email, is_rights_owner}. Anyone can send one.
    takedown: function (t) {
      var row = { kind: "takedown", image_id: t.image_id || null, character_slug: t.character_slug || null, image_url: t.image_url || null, page_url: t.page_url || null,
        reason: t.reason, details: (t.details || "").slice(0, 2000) || null, contact_name: t.contact_name || null, contact_email: t.contact_email,
        is_rights_owner: !!t.is_rights_owner };
      if (sb) return sb.from("reports").insert(row).then(function (res) {
        if (res.error) throw new Error(/reports/.test(res.error.message) ? "Takedown requests aren't switched on yet. Please email us instead." : res.error.message);
        return "ok";
      });
      var list = demoReports(); list.push(Object.assign({ id: "rep-" + Date.now(), status: "open", created_at: new Date().toISOString() }, row));
      writeJSON(REPORTS_KEY, list); return Promise.resolve("ok");
    },
    // Admins review reports and decide. In demo mode the demo creator is the admin.
    isAdmin: function () {
      if (sb) return sb.rpc("is_admin").then(function (r) { return !r.error && r.data === true; }, function () { return false; });
      return Studio.session().then(function (u) { return !!u; });
    },
    reports: function () {
      if (sb) return sb.from("reports").select("*").order("created_at", { ascending: false }).limit(500)
        .then(function (r) { if (r.error) throw r.error; return r.data || []; });
      return Promise.resolve(demoReports().slice().reverse());
    },
    // action: 'keep' (show again), 'remove' (take down), 'review' (hide for now)
    moderate: function (imageId, action, slug) {
      if (sb) return sb.rpc("moderate_image", { p_image_id: imageId, p_action: action, p_slug: slug || null })
        .then(function (r) { if (r.error) throw r.error; return r.data; });
      var st = { keep: "ok", remove: "removed", review: "review" }[action];
      var mod = readJSON("persona-moderation-v1") || {}; if (st === "ok") delete mod[imageId]; else mod[imageId] = st; writeJSON("persona-moderation-v1", mod);
      if (action !== "review") writeJSON(REPORTS_KEY, demoReports().map(function (x) {
        if (x.image_id === imageId && x.status === "open") x.status = action === "keep" ? "kept" : "removed"; return x; }));
      return Promise.resolve(st);
    },
    resolveReport: function (id, status) {
      if (sb) return sb.rpc("resolve_report", { p_id: id, p_status: status }).then(function (r) { if (r.error) throw r.error; });
      writeJSON(REPORTS_KEY, demoReports().map(function (x) { if (x.id === id) x.status = status; return x; }));
      return Promise.resolve();
    },

    // ---------- upload allowance: 5 to start, +1 for every 10 points ----------
    BASE_UPLOADS: 5, POINTS_PER_UPLOAD: 10,
    quota: function () {
      function calc(points, used) {
        var limit = Studio.BASE_UPLOADS + Math.floor(points / Studio.POINTS_PER_UPLOAD);
        return { points: points, used: used, limit: limit, left: Math.max(0, limit - used),
          toNext: Studio.POINTS_PER_UPLOAD - (points % Studio.POINTS_PER_UPLOAD) };
      }
      if (sb) {
        return Studio.session().then(function (u) {
          if (!u) return calc(0, 0);
          return Promise.all([
            sb.from("creators").select("points").eq("id", u.id).maybeSingle(),
            sb.from("images").select("id", { count: "exact", head: true }).eq("owner", u.id).not("url", "is", null),
          ]).then(function (r) { return calc((r[0].data && r[0].data.points) || 0, r[1].count || 0); });
        });
      }
      var pts = readJSON("persona-points-v1") || 0;
      return tx("readonly", function (st) { return st.count(); }).catch(function () { return 0; })
        .then(function (n) { return calc(pts, n || 0); });
    },
    // Demo only: lets you show the points rule live.
    addDemoPoints: function (n) { writeJSON("persona-points-v1", (readJSON("persona-points-v1") || 0) + n); },
  };

  // ---------- "Shop the look": brand products matched to each image (persona_products.pin_ids) ----------
  var productCache = {};
  window.Products = {
    forPin: function (id) {
      if (!sb || !id) return Promise.resolve([]);
      if (!productCache[id]) {
        productCache[id] = sb.from("persona_products")
          .select("id,store,title,price,sale_price,currency,link,image,on_sale")
          .contains("pin_ids", [id]).eq("available", true).limit(12)
          .then(function (r) { return r.error ? [] : r.data || []; }, function () { return []; });
      }
      return productCache[id];
    },
  };
})();
