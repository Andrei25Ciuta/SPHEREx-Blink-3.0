// urlState.js – keep the app state in the page URL, e.g.
//   http://localhost:8000/?ra=133.75976&dec=-7.24219&fov=5&det=D3
// Why? So a link (or an <iframe> embed) opens the tool on exactly the same view.
//
// We only READ and WRITE strings here; validation stays in coords.js / main.js.

const KEYS = ["ra", "dec", "fov", "det", "mode", "dateFrom", "dateTo"];
const REQUEST_KEY = "request_id";
const usesApi = (params) => params.get("data") === "api";

export const isPublicFieldRequestId = (value) => typeof value === "string" && value.length === 35 && /^fr-[a-f0-9]{32}$/.test(value);

function canonicalDecimal(params, key, places, min, max, inclusive = true) {
  const values = params.getAll(key);
  if (values.length !== 1) return NaN;
  const [raw] = values;
  const decimal = new RegExp(`^-?(?:0|[1-9]\\d*)(?:\\.\\d{1,${places}})?$`);
  // Number#toString emits e-notation for very small submitted coordinates.
  const number = Number(raw);
  if (raw !== raw.trim()) return NaN;
  if (!decimal.test(raw) && !(raw.includes("e-") && raw === String(number) &&
      number === Number(number.toFixed(places)))) return NaN;
  return Number.isFinite(number) && number >= min && (inclusive ? number <= max : number < max) ? number : NaN;
}

/** Read an unambiguous restore target without filling defaults, wrapping, or rounding. */
export function readSkyZoneRequest(params = new URLSearchParams(window.location.search)) {
  if (!usesApi(params) || params.getAll("data").length !== 1) return null;
  const ids = params.getAll(REQUEST_KEY);
  if (ids.length !== 1 || !isPublicFieldRequestId(ids[0])) return null;
  const ra = canonicalDecimal(params, "ra", 8, 0, 360, false);
  const dec = canonicalDecimal(params, "dec", 8, -90, 90);
  const fov = canonicalDecimal(params, "fov", 4, 1, 10);
  return [ra, dec, fov].every(Number.isFinite) ? { requestId: ids[0], query: { ra, dec, fov } } : null;
}

/** Presence of even an invalid ID fences off the unscoped startup loader. */
export function readWorkspaceStartup(params = new URLSearchParams(window.location.search)) {
  if (params.has(REQUEST_KEY) || (usesApi(params) && params.get("sky_browse") === "1")) {
    return { kind: "request", target: readSkyZoneRequest(params) };
  }
  return { kind: "legacy" };
}

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
    if (key === REQUEST_KEY) {
      if (value != null && value !== "" && (!usesApi(params) || !isPublicFieldRequestId(value))) continue;
    } else if (!KEYS.includes(key)) continue;               // ignore unknown keys
    if (value === null || value === undefined || value === "") params.delete(key);
    else params.set(key, String(value));
  }
  const query = params.toString();
  const newUrl = window.location.pathname + (query ? `?${query}` : "") + window.location.hash;
  window.history.replaceState(null, "", newUrl);
}
