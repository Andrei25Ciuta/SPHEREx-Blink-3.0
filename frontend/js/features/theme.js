// theme.js – colour themes: which ones exist, which one is chosen, and remembering the choice in this browser.
//
// A theme is a block of CSS tokens in css/styles.css selected by data-theme on <html>; nothing else changes. The choice is kept in
// localStorage (this browser only, never sent anywhere); ?theme=light in the address overrides it for that visit (handy for screenshots and
// links) without saving it. Pure functions with injected storage / document, so Node can test them; the page calls setupThemeSwitcher().
// The same lookup runs once more in a tiny inline script in the <head> of each page, before the first paint, so that the page does not flash
// in the wrong colours: keep the two in step (the regular expression and the key).

export const STORAGE_KEY = "spherex-blink-theme";
export const DEFAULT_THEME = "deep-space";
export const THEMES = [
  { id: "deep-space", label: "Deep Space", scheme: "dark", themeColor: "#080D18" },
  { id: "observatory", label: "Observatory", scheme: "dark", themeColor: "#111827" },
  { id: "light", label: "Light research", scheme: "light", themeColor: "#F5F7FB" },
  { id: "classic", label: "Classic (teal)", scheme: "dark", themeColor: "#0E1C22" },
];

export const isTheme = (id) => THEMES.some((t) => t.id === id);

/** localStorage can throw (private window, blocked site data): every access is wrapped, and the page works without it. */
function safe(fn, fallback = null) {
  try { return fn(); } catch { return fallback; }
}

/** The theme to use: the address (?theme=), else the saved choice, else the default. Unknown names are ignored. */
export function readTheme({ search = "", storage = null } = {}) {
  const fromUrl = safe(() => new URLSearchParams(search).get("theme"));
  if (isTheme(fromUrl)) return fromUrl;
  const saved = storage ? safe(() => storage.getItem(STORAGE_KEY)) : null;
  return isTheme(saved) ? saved : DEFAULT_THEME;
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
  const active = readTheme({ search: win.location.search, storage });
  select.replaceChildren(...THEMES.map((t) => Object.assign(win.document.createElement("option"), { value: t.id, textContent: t.label })));
  applyTheme(active, { storage, persist: false });
  select.value = active;
  select.addEventListener("change", () => {
    const id = applyTheme(select.value, { storage });
    select.value = id;
  });
  return { active, fromUrl };
}
