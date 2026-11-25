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
      created: row.created || Date.parse(row.created_at) || 0, path: row.path };
  }

  // rows: [{id, live, url?/blob?, ...}] for one character
  function merge(c, rows) {
    var byId = {}; rows.forEach(function (r) { byId[r.id] = r; });
    var builtIn = imagesFor(c).map(function (im) {
      im.live = byId[im.id] ? !!byId[im.id].live : true; return im;
    });
    var ups = rows.filter(function (r) { return r.url || r.blob; })
      .map(function (r) { var im = uploadedImg(r, c); im.live = !!r.live; return im; })
      .sort(function (a, b) { return a.created - b.created; });
    return builtIn.concat(ups);
  }

  // Supabase mode with the characters table: the feed is exactly the DB rows (featured files + uploads).
  function fromRows(c, rows) {
    return rows.map(function (r) {
      var im = r.url ? uploadedImg(r, c)
        : { id: r.id, src: window.IMAGE_BASE + r.id + ".jpg", alt: c.name + ", image " + r.id.split("-").pop(), credit: r.credit, creditUrl: r.credit_url,
            created: Date.parse(r.created_at) || 0 };
      im.live = !!r.live; im.position = r.position == null ? 1000 : r.position; return im;
    }).sort(function (a, b) { return a.position - b.position || a.created - b.created; });
  }

  // ---------- characters ----------
  var LOCAL_CHARS = "persona-characters-v1";
  function fromDb(r) {
    return { slug: r.slug, name: r.name, handle: r.handle || "", link: r.link || "", tagline: r.tagline || "", origin: r.origin || "",
      creator: r.creator || "", creatorUsername: r.creator_username || undefined, since: r.since || "", audience: r.audience || "",
      category: r.category || "", bio: r.bio || [], knownFor: r.known_for || [], owner: r.owner, published: r.published };
  }
  function toDb(c) {
    return { slug: c.slug, name: c.name, handle: c.handle || null, link: c.link || null, tagline: c.tagline || null, origin: c.origin || null,
      creator: c.creator || null, since: c.since || null, audience: c.audience || null, category: c.category || null,
      bio: c.bio || [], known_for: c.knownFor || [] };
  }
  function slugify(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function addLocal(list) {
    (readJSON(LOCAL_CHARS) || []).forEach(function (c) { if (!list.some(function (x) { return x.slug === c.slug; })) list.push(c); });
    return list;
  }

  function rowsFor(c) {
    if (sb) {
      return sb.from("images").select("*").eq("character_slug", c.slug)
        .then(function (r) { return r.error ? [] : r.data; });
    }
    var live = readJSON(LIVE_KEY) || {};
    return tx("readonly", function (st) { return st.getAll(); }).catch(function () { return []; }).then(function (ups) {
      var rows = (ups || []).filter(function (u) { return u.slug === c.slug; })
        .map(function (u) { return { id: u.id, blob: u.blob, created: u.created, live: !!live[u.id] }; });
      imagesFor(c).forEach(function (im) { if (live[im.id] !== undefined) rows.push({ id: im.id, live: live[im.id] }); });
      return rows;
    });
  }

  window.Studio = {
    mode: sb ? "supabase" : "demo",
    fromDb: false, // true once characters were read from the characters table
    all: function (c) {
      if (sb && Studio.fromDb) return sb.from("images").select("*").eq("character_slug", c.slug)
        .then(function (r) { return r.error ? [] : fromRows(c, r.data); });
      return rowsFor(c).then(function (rows) { return merge(c, rows); });
    },
    liveFor: function (c) { return Studio.all(c).then(function (l) { return l.filter(function (im) { return im.live; }); }); },

    setLive: function (c, id, on) {
      if (sb) return sb.from("images").upsert({ id: id, character_slug: c.slug, live: !!on }, { onConflict: "id" });
      var m = readJSON(LIVE_KEY) || {}; m[id] = !!on; writeJSON(LIVE_KEY, m); return Promise.resolve();
    },

    upload: function (c, files) {
      var now = Date.now();
      var list = Array.prototype.slice.call(files).filter(function (f) { return /^image\//.test(f.type); });
      if (sb) {
        return Promise.all(list.map(function (f, i) {
          var id = "up-" + now + "-" + i, ext = (f.name.split(".").pop() || "jpg").toLowerCase();
          var path = c.slug + "/" + id + "." + ext;
          return sb.storage.from(BUCKET).upload(path, f, { contentType: f.type }).then(function (r) {
            if (r.error) throw r.error;
            var url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
            return sb.from("images").insert({ id: id, character_slug: c.slug, url: url, path: path, live: false });
          });
        }));
      }
      return tx("readwrite", function (st) {
        list.forEach(function (f, i) { st.put({ id: "up-" + now + "-" + i, slug: c.slug, name: f.name, blob: f, created: now + i }); });
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

    // Characters come from the DB when it has them; otherwise from data.js (plus demo ones in this browser).
    loadCharacters: function () {
      var fallback = function () { window.CHARACTERS = addLocal(window.CHARACTERS.slice()); return window.CHARACTERS; };
      if (!sb) return Promise.resolve(fallback());
      return sb.from("characters").select("*").order("sort").order("created_at").then(function (r) {
        if (r.error || !r.data || !r.data.length) {
          if (r.error) console.warn("characters table not readable, using data.js:", r.error.message);
          return fallback();
        }
        Studio.fromDb = true;
        window.CHARACTERS = r.data.map(fromDb);
        return window.CHARACTERS;
      }, fallback);
    },
    slugify: slugify,
    isMine: function (c, user) {
      if (!user) return false;
      if (sb && Studio.fromDb) return !!c.owner && c.owner === user.id;
      return (window.CREATOR.characters || []).indexOf(c.slug) > -1 || !!c.local;
    },
    createCharacter: function (fields, user) {
      var c = Object.assign({ bio: [], knownFor: [] }, fields);
      c.slug = slugify(c.slug || c.name);
      if (!c.name || !c.slug) return Promise.reject(new Error("Give the character a name."));
      if (window.CHARACTERS.some(function (x) { return x.slug === c.slug; })) return Promise.reject(new Error("A character called " + c.name + " already exists."));
      c.creator = c.creator || (user && user.name) || "";
      if (sb && Studio.fromDb) {
        return sb.from("characters").insert(Object.assign(toDb(c), { owner: user.id, sort: 100 })).select().single().then(function (r) {
          if (r.error) throw new Error(r.error.code === "23505" ? "That name is taken. Try another." : r.error.message);
          var row = fromDb(r.data); window.CHARACTERS.push(row); return row;
        });
      }
      if (sb) return Promise.reject(new Error("Run supabase/characters.sql in Supabase first, then reload."));
      c.local = true; c.builtIn = 0; c.since = c.since || String(new Date().getFullYear()); c.audience = c.audience || "New on Persona";
      var list = readJSON(LOCAL_CHARS) || []; list.push(c); writeJSON(LOCAL_CHARS, list);
      window.CHARACTERS.push(c); return Promise.resolve(c);
    },

    // ---------- login (Google only) ----------
    session: function () {
      if (sb) return sb.auth.getSession().then(function (r) {
        var s = r.data.session; if (!s) return null;
        var m = s.user.user_metadata || {};
        return { id: s.user.id, email: s.user.email, name: m.full_name || m.name || s.user.email, avatar: m.avatar_url };
      });
      return Promise.resolve(readJSON(SESSION_KEY));
    },
    signInWithGoogle: function () {
      if (sb) return sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname.replace(/[^/]*$/, "") + "studio.html" } });
      writeJSON(SESSION_KEY, { id: "demo", email: "noor@persona.demo", name: CREATOR.name });
      location.href = "studio.html";
      return Promise.resolve();
    },
    signOut: function () {
      if (sb) return sb.auth.signOut();
      writeJSON(SESSION_KEY, null); return Promise.resolve();
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
  // Every page waits on this before reading CHARACTERS.
  window.PersonaReady = Studio.loadCharacters();
})();
