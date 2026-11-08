// Apply the stored palette before the first paint, including in an embedded workspace.
(() => {
  const palettes = new Map([
    ["deep-space", "Deep Space"], ["observatory", "Observatory"], ["light-research", "Light Research"],
  ]);
  const key = "spherex-blink.theme";
  function apply(value) {
    const theme = palettes.has(value) ? value : "deep-space";
    document.documentElement.dataset.theme = theme;
    for (const select of document.querySelectorAll("[data-theme-picker]")) select.value = theme;
  }
  try { apply(localStorage.getItem(key)); } catch { apply(null); }
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
