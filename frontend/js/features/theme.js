// theme.js – colour themes: which ones exist, which one is chosen, and remembering the choice in this browser.
//
// A theme is a block of CSS tokens in css/styles.css selected by data-theme on <html>; nothing else changes. The choice is kept in
// localStorage (this browser only, never sent anywhere); ?theme=light in the address overrides it for that visit (handy for screenshots and
// links) without saving it. Pure functions with injected storage / document, so Node can test them; the page calls setupThemeSwitcher().
// The same lookup runs once more in a tiny inline script in the <head> of each page, before the first paint, so that the page does not flash
// in the wrong colours: keep the two in step (the regular expression and the key).

export const STORAGE_KEY = "spherex-blink-theme";
// DEFAULT_THEME is the fallback when a page does not provide data-default-theme. The 4.0 Science and Overview pages start in the light signal-red palette;
// Learn starts in Nebula. A saved choice or ?theme= overrides the page default (scratch/test_theme.mjs checks the order).
export const DEFAULT_THEME = "light";
export const THEMES = [
  { id: "midnight", label: "Midnight / dark", scheme: "dark", themeColor: "#0B0F19" },
  { id: "nebula", label: "Paper / violet", scheme: "light", themeColor: "#FCFAFF" },
  { id: "deep-space", label: "Paper / blue", scheme: "light", themeColor: "#F8FBFE" },
  { id: "observatory", label: "Paper / green", scheme: "light", themeColor: "#F8FBF9" },
  { id: "light", label: "Paper / signal red", scheme: "light", themeColor: "#FBFBF9" },
  { id: "classic", label: "Paper / earth", scheme: "light", themeColor: "#FCFAF5" },
];

export const isTheme = (id) => THEMES.some((t) => t.id === id);

/** localStorage can throw (private window, blocked site data): every access is wrapped, and the page works without it. */
function safe(fn, fallback = null) {
  try { return fn(); } catch { return fallback; }
}

/** The theme to use: the address (?theme=), else the saved choice, else the default. Unknown names are ignored. */
export function readTheme({ search = "", storage = null, defaultTheme = DEFAULT_THEME } = {}) {
  const fromUrl = safe(() => new URLSearchParams(search).get("theme"));
  if (isTheme(fromUrl)) return fromUrl;
  const saved = storage ? safe(() => storage.getItem(STORAGE_KEY)) : null;
  return isTheme(saved) ? saved : defaultTheme;
}

/** Put a theme on the page (and the browser's own bars), and remember it unless it was only asked for in the address. */
export function applyTheme(id, { root = document.documentElement, storage = null, persist = true, doc = typeof document === "undefined" ? null : document } = {}) {
  if (!isTheme(id)) id = DEFAULT_THEME;
  root.dataset.theme = id;
  const theme = THEMES.find((t) => t.id === id);
  const meta = doc?.querySelector?.('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme.themeColor);
  if (persist && storage) safe(() => storage.setItem(STORAGE_KEY, id));
  return id;
}

/** Fill a <select> with the themes, show the active one, and apply + save a new choice. Returns the active theme id. */
export function setupThemeSwitcher(select, { win = window } = {}) {
  const storage = safe(() => win.localStorage);
  const fromUrl = isTheme(safe(() => new URLSearchParams(win.location.search).get("theme")));
  const active = readTheme({ search: win.location.search, storage, defaultTheme: select.dataset?.defaultTheme });
  select.replaceChildren(...THEMES.map((t) => Object.assign(win.document.createElement("option"), { value: t.id, textContent: t.label })));
  applyTheme(active, { storage, persist: false });
  select.value = active;
  select.addEventListener("change", () => {
    const id = applyTheme(select.value, { storage });
    select.value = id;
  });
  return { active, fromUrl };
}
