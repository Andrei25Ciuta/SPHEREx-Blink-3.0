// urlState.js – keep the app state in the page URL, e.g.
//   http://localhost:8000/?ra=133.75976&dec=-7.24219&fov=5&det=D3
// Why? So a link (or an <iframe> embed) opens the tool on exactly the same view.
//
// We only READ and WRITE strings here; validation stays in coords.js / main.js.

const KEYS = ["ra", "dec", "fov", "det", "mode", "dateFrom", "dateTo"];

/**
 * Read the current URL query string.
 * Returns an object with only the keys that are present, e.g. { ra: "133.7", dec: "-7.2" }.
 * Values are raw strings – the caller must validate them (URLs can contain anything!).
 */
export function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  const state = {};
  for (const key of KEYS) {
    const value = params.get(key);
    if (value !== null && value.trim() !== "") state[key] = value.trim();
  }
  return state;
}

/**
 * Merge `updates` into the current URL without reloading the page.
 * - A key set to null/undefined/"" is removed from the URL.
 * - We use history.replaceState (not pushState) so every slider move does NOT
 *   add a new entry to the browser's Back button history.
 */
export function writeUrlState(updates) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(updates)) {
    if (!KEYS.includes(key)) continue;                       // ignore unknown keys
    if (value === null || value === undefined || value === "") params.delete(key);
    else params.set(key, String(value));
  }
  const query = params.toString();
  const newUrl = window.location.pathname + (query ? `?${query}` : "") + window.location.hash;
  window.history.replaceState(null, "", newUrl);
}
