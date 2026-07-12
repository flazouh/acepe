(function () {
  var STORAGE_KEY = "teach-theme";
  var THEMES = {
    "cursor-dark": { label: "Cursor Dark", icon: "◐", next: "anthropic-light" },
    "anthropic-light": { label: "Anthropic Light", icon: "☀", next: "cursor-dark" }
  };

  function getStoredTheme() {
    var stored = localStorage.getItem(STORAGE_KEY);
    if (stored && THEMES[stored]) {
      return stored;
    }
    return "cursor-dark";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
    updateButton(theme);
  }

  function updateButton(theme) {
    var btn = document.getElementById("theme-toggler");
    if (!btn) {
      return;
    }
    var meta = THEMES[theme];
    btn.setAttribute("aria-label", "Switch to " + THEMES[meta.next].label);
    btn.title = "Switch to " + THEMES[meta.next].label;
    var icon = btn.querySelector(".theme-toggler-icon");
    var label = btn.querySelector(".theme-toggler-label");
    if (icon) {
      icon.textContent = meta.icon;
    }
    if (label) {
      label.textContent = meta.label;
    }
  }

  function createToggler() {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "theme-toggler";
    btn.className = "theme-toggler";
    btn.innerHTML =
      '<span class="theme-toggler-icon" aria-hidden="true">◐</span>' +
      '<span class="theme-toggler-label">Cursor Dark</span>';
    btn.addEventListener("click", function () {
      var current = getStoredTheme();
      applyTheme(THEMES[current].next);
    });
    document.body.appendChild(btn);
  }

  var initial = getStoredTheme();
  document.documentElement.setAttribute("data-theme", initial);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      createToggler();
      updateButton(getStoredTheme());
    });
  } else {
    createToggler();
    updateButton(initial);
  }
})();
