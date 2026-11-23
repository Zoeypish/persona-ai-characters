// Shared helpers. Images show a soft placeholder with the initial until they load.
function tileImg(img, name) {
  var initial = (name || "?").charAt(0);
  return '<img src="' + img.src + '" alt="' + img.alt + '" loading="lazy" onload="this.classList.add(\'loaded\')" ' +
    'onerror="this.style.display=\'none\'"><div class="ph">' + initial + '</div>';
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
  });
}

var MARK = '<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29" fill="#fff" stroke="currentColor" stroke-width="4"/><path d="M32 3a29 29 0 0 0 0 58z" fill="currentColor"/></svg>';

// Light header: logo on the left, search and profile on the right.
(function header() {
  var el = document.getElementById("nav");
  if (!el) return;
  var opts = CHARACTERS.map(function (c) { return '<option value="' + esc(c.name) + '">'; }).join("");
  el.className = "nav";
  el.innerHTML =
    '<a class="wordmark" href="./" aria-label="Persona home">' + MARK + '<span>Persona</span></a>' +
    '<div class="nav-right">' +
      '<form class="search" role="search" id="search-form">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
        '<input id="search" type="search" placeholder="Search characters" list="search-list" autocomplete="off" aria-label="Search characters">' +
        '<datalist id="search-list">' + opts + '</datalist>' +
      '</form>' +
      '<a class="avatar" href="studio.html" title="' + esc(CREATOR.name) + '" aria-label="Your profile and studio">' +
        esc(CREATOR.name.split(" ").map(function (w) { return w[0]; }).join("")) + '</a>' +
    '</div>';
  document.getElementById("search-form").onsubmit = function (e) {
    e.preventDefault();
    var q = document.getElementById("search").value.trim().toLowerCase();
    if (!q) return;
    var hit = CHARACTERS.filter(function (c) {
      return (c.name + " " + c.handle + " " + c.category + " " + c.origin + " " + c.creator).toLowerCase().indexOf(q) > -1;
    })[0];
    if (hit) location.href = "profile.html?c=" + hit.slug;
    else document.getElementById("search").value = "", document.getElementById("search").placeholder = "No match for “" + q + "”";
  };
})();
