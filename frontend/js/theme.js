// Colour theme for the standalone pages (planet-x.html, sky.html, simulator.html): the same themes, the same saved choice and the same names as js/features/theme.js
// (the module used by index.html and results.html), so a theme chosen on one page is the theme of all of them. This is a plain script, not a module: it runs before the first paint.
(() => {
  const palettes = new Map([
    ["nebula", "Nebula (violet)"], ["deep-space", "Deep Space"], ["observatory", "Observatory"], ["light", "Light research"], ["classic", "Classic (teal)"],
  ]);
  const key = "spherex-blink-theme";
  const fallback = "light";
  function apply(value) {
    const theme = palettes.has(value) ? value : fallback;
    document.documentElement.dataset.theme = theme;
    for (const select of document.querySelectorAll("[data-theme-picker]")) select.value = theme;
  }
  let first = null;
  try { first = new URLSearchParams(location.search).get("theme") || localStorage.getItem(key); } catch { /* blocked storage: the default */ }
  apply(first);
  document.addEventListener("DOMContentLoaded", () => {
    for (const select of document.querySelectorAll("[data-theme-picker]")) {
      select.replaceChildren(...Array.from(palettes, ([id, name]) => new Option(name, id)));
      select.value = document.documentElement.dataset.theme;
      select.addEventListener("change", () => {
        apply(select.value);
        try { localStorage.setItem(key, select.value); } catch { /* Session-only selection. */ }
      });
    }
  });
  window.addEventListener("storage", event => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();
