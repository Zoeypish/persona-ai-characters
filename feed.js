// Persona homepage feed: a personal mix for each visitor.
//
//   50%  from characters the visitor follows
//   35%  similar to what they follow (shared style keywords from SEARCH_TAGS in data.js)
//   15%  random, from everything else
//
// Freshness: inside each group, pins the visitor has not seen yet come first, newest first.
// Pins they have already seen go to the end of the feed, the longest-ago seen first, so the top
// of the homepage keeps changing. "Seen" means the pin was on screen; it is kept in this browser.
//
// If they follow nobody yet, "similar" uses their saved pins instead. With no follows and no saves,
// the feed is fresh pins first with every character mixed in.
var Feed = (function () {
  var SEEN = "persona-seen-v1", KEEP = 500;
  var SHARE = { following: 0.5, similar: 0.35, random: 0.15 };

  function readSeen() { try { return JSON.parse(localStorage.getItem(SEEN)) || {}; } catch (e) { return {}; } }
  // Seen times as they were when the page opened, so the feed doesn't reshuffle while you scroll.
  var seenAtLoad = readSeen();

  function markSeen(ids) {
    if (!ids.length) return;
    var m = readSeen(), now = Date.now();
    ids.forEach(function (id) { m[id] = now; });
    var keys = Object.keys(m);
    if (keys.length > KEEP) keys.sort(function (a, b) { return m[a] - m[b]; }).slice(0, keys.length - KEEP).forEach(function (k) { delete m[k]; });
    try { localStorage.setItem(SEEN, JSON.stringify(m)); } catch (e) {}
  }

  // Newer first: uploads carry a timestamp; built-in images count as older, higher number = newer.
  function age(p) {
    if (p.created) return p.created;
    var n = parseInt(String(p.id).split("-").pop(), 10);
    return isNaN(n) ? 0 : n;
  }
  function fresher(a, b) {
    var sa = seenAtLoad[a.id] || 0, sb = seenAtLoad[b.id] || 0;
    if (!sa !== !sb) return sa ? 1 : -1;          // unseen before seen
    if (sa && sb && sa !== sb) return sa - sb;    // seen longest ago first
    return age(b) - age(a);                       // newest first
  }

  function tagsOf(p) {
    var T = window.SEARCH_TAGS || { characters: {}, pins: {} }, own = T.pins[p.id];
    return (own ? own.styles.concat(own.words) : []).concat(T.characters[p.slug] || []);
  }
  // What this visitor likes: keywords of the characters they follow and the pins they saved.
  function taste(following, saved, all) {
    var w = {}, T = window.SEARCH_TAGS || { characters: {}, pins: {} };
    function add(list, n) { list.forEach(function (t) { w[t] = (w[t] || 0) + n; }); }
    following.forEach(function (s) {
      add(T.characters[s] || [], 2);
      (all[s] || []).forEach(function (p) { add(tagsOf(p), 0.5); });
    });
    saved.forEach(function (p) { add(tagsOf(p), 1); });
    return w;
  }
  function likeness(p, w) {
    var seen = {}, n = 0;
    tagsOf(p).forEach(function (t) { if (!seen[t]) { seen[t] = 1; n += w[t] || 0; } });
    return n;
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // all: { slug: [pins] }. Returns the pins in feed order, each with p.why = "following" | "similar" | "random".
  function build(all, following, saved) {
    following = (following || []).filter(function (s) { return all[s]; });
    var follow = {}; following.forEach(function (s) { follow[s] = 1; });
    var w = taste(following, saved || [], all);
    var groups = { following: [], similar: [], random: [] };

    // "Similar" means clearly alike: at least 40% of the best match. Weak matches go to the random group,
    // so random picks really come from outside the visitor's usual taste.
    var others = [], best = 0;
    Object.keys(all).forEach(function (s) {
      all[s].forEach(function (p) {
        if (follow[s]) return groups.following.push(p);
        p._like = likeness(p, w); best = Math.max(best, p._like); others.push(p);
      });
    });
    // The least alike 30% always stay random, even when everything shares a common style.
    others.sort(function (a, b) { return b._like - a._like; });
    var cut = Math.ceil(others.length * 0.7);
    others.forEach(function (p, i) { (best && i < cut && p._like >= best * 0.4 ? groups.similar : groups.random).push(p); });
    groups.following.sort(fresher);
    // Most alike first, but an unseen pin always beats one already seen.
    groups.similar.sort(function (a, b) {
      var sa = !!seenAtLoad[a.id], sb = !!seenAtLoad[b.id];
      if (sa !== sb) return sa ? 1 : -1;
      return (b._like - a._like) || fresher(a, b);
    });
    // Random picks: unseen first, otherwise in random order.
    var fresh = shuffle(groups.random.filter(function (p) { return !seenAtLoad[p.id]; }));
    var old = groups.random.filter(function (p) { return seenAtLoad[p.id]; }).sort(fresher);
    groups.random = fresh.concat(old);

    // Nobody followed and nothing saved: there is no taste to go on yet, so show fresh pins from everyone.
    if (!following.length && !groups.similar.length) {
      return groups.random.slice().sort(fresher).map(function (p) { p.why = "random"; return p; });
    }

    // Fill the unseen part of the feed slot by slot, always topping up the group furthest below its share
    // (an empty group's share passes to the others). Already-seen pins follow after, in the same way.
    function take(onlyUnseen) {
      var q = {}, out = [], got = { following: 0, similar: 0, random: 0 };
      Object.keys(groups).forEach(function (k) {
        q[k] = groups[k].filter(function (p) { return onlyUnseen ? !seenAtLoad[p.id] : !!seenAtLoad[p.id]; });
      });
      for (;;) {
        var live = Object.keys(q).filter(function (k) { return q[k].length; });
        if (!live.length) break;
        var sum = live.reduce(function (n, k) { return n + SHARE[k]; }, 0), n = out.length + 1, pick = null, gap = -Infinity;
        live.forEach(function (k) {
          var g = SHARE[k] / sum * n - got[k];
          if (g > gap + 1e-9) { gap = g; pick = k; }
        });
        var p = q[pick].shift(); p.why = pick; got[pick]++; out.push(p);
      }
      return out;
    }
    return take(true).concat(take(false));
  }

  // Count a pin as seen once at least half of it has been on screen.
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    var ids = [];
    entries.forEach(function (e) { if (e.isIntersecting) { ids.push(e.target.dataset.id); io.unobserve(e.target); } });
    markSeen(ids);
  }, { threshold: 0.5 }) : null;
  function watch(el) { if (io) el.querySelectorAll(".pin[data-id]").forEach(function (p) { io.observe(p); }); }

  return { build: build, watch: watch, markSeen: markSeen, share: SHARE };
})();
