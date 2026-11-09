// surveyCoverage.js – which SPHEREx survey images cover a place on the sky (pure: no DOM, no network unless fetchFn is given).
//
// The images come from the backend's /api/survey, which asks IRSA's table `spherex.plane` (a live query of what the SURVEY has published; not the files on this computer: those are
// the footprints of skyExplorer.js). For each image the backend sends the detector, the dates (MJD) and the corners of its footprint on the sky.
//
//   coverage(planes, ra, dec)   what covers the centre of the search: how many images, of which detectors, in how many survey passes, over how many days
//   planeOffsets(plane, ra, dec) the footprint as offsets (arcmin) in the tangent plane at the search centre, east to the LEFT and north UP, to draw at true scale
//   fetchSurvey(apiBase, params) the request, with the errors said in words
//
// Geometry: the footprints are spherical polygons whose edges are great circles. In the GNOMONIC (tangent plane) projection a great circle is a straight line, so a polygon stays a
// polygon with straight edges and "is this point inside it" is an ordinary point-in-polygon test: exact for any size of image, no flat-sky approximation.

import { DEFAULTS } from "./movers.js";

const RAD = Math.PI / 180, DEG = 180 / Math.PI;

export const PASS_GAP_DAYS = DEFAULTS.minPassGapDays;   // the rule of Find movers and of the timeline (passIndices): images 30 days or more apart are different survey passes
export const MOVERS_MIN_PASSES = 3;              // Find movers needs images from at least 3 passes (README, VALIDATION 10)
export const DETECTORS = ["D1", "D2", "D3", "D4", "D5", "D6"];
export const RADIUS_MAX_DEG = 2, LIMIT_MAX = 1000, LIMIT_DEFAULT = 200;     // the same limits as backend/spherex/survey.py

/** Gnomonic projection of (ra, dec) about (ra0, dec0): [x, y] in arcminutes, x grows to the WEST (east is left), y grows north. null for a point 90 degrees or more away. */
export function tangentOffset(ra, dec, ra0, dec0) {
  const a = (ra - ra0) * RAD, d = dec * RAD, d0 = dec0 * RAD;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a);
  if (cosc <= 1e-9) return null;
  const xi = (Math.cos(d) * Math.sin(a)) / cosc, eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a)) / cosc;
  return [-xi * DEG * 60, eta * DEG * 60];
}

/** The footprint of one image as [[x, y]...] arcmin at the tangent plane of (ra, dec); null if a corner is too far from it to be projected. */
export function planeOffsets(plane, ra, dec) {
  const pts = plane.corners.map(([a, d]) => tangentOffset(a, d, ra, dec));
  return pts.some((p) => p === null) ? null : pts;
}

/** Is the point (x, y) inside the polygon (even-odd rule)? */
export function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Does this image cover the sky position (ra, dec)? */
export function covers(plane, ra, dec) {
  const poly = planeOffsets(plane, ra, dec);
  return poly !== null && pointInPolygon(0, 0, poly);
}

/** MJD -> "YYYY-MM-DD" (UTC). MJD 40587 is 1970-01-01. */
export const mjdToDate = (mjd) => new Date((mjd - 40587) * 86400000).toISOString().slice(0, 10);

/** Survey passes: the sorted dates (MJD) cut wherever two neighbours are gapDays or more apart (as passIndices of movers.js does). -> [{ start, end, count }] */
export function passesOf(mjds, gapDays = PASS_GAP_DAYS) {
  const sorted = [...mjds].filter(Number.isFinite).sort((a, b) => a - b), out = [];
  for (const m of sorted) {
    const last = out.at(-1);
    if (last && m - last.end < gapDays) { last.end = m; last.count++; } else out.push({ start: m, end: m, count: 1 });
  }
  return out;
}

/**
 * What the images found cover at the search centre.
 * -> { found, covering, byDetector: { D2: n }, passes: [{ start, end, count }], spanDays, first, last, enoughForMovers, truncated }
 * `covering` are the images whose footprint contains the centre; `found` all those that touch the search circle.
 */
export function coverage(planes, ra, dec, { truncated = false } = {}) {
  const covering = (planes ?? []).filter((p) => covers(p, ra, dec));
  const byDetector = {};
  for (const p of covering) byDetector[p.detector] = (byDetector[p.detector] ?? 0) + 1;
  const passes = passesOf(covering.map((p) => p.mjdStart));
  const first = passes.length ? passes[0].start : null, last = passes.length ? passes.at(-1).end : null;
  return {
    found: (planes ?? []).length, covering, byDetector, passes, truncated,
    spanDays: first === null ? 0 : last - first, first: first === null ? null : mjdToDate(first), last: last === null ? null : mjdToDate(last),
    enoughForMovers: passes.length >= MOVERS_MIN_PASSES,
  };
}

/** The coverage in words. Says what was counted and what was not (a cut-off list is not a count). */
export function coverageText(c) {
  if (!c.found) return "IRSA lists no survey image whose footprint touches this circle.";
  if (!c.covering.length) return `${c.found} survey image${c.found === 1 ? "" : "s"} touch${c.found === 1 ? "es" : ""} the circle, but none covers its centre.${c.truncated ? " The list was cut off: more may exist." : ""}`;
  const dets = Object.entries(c.byDetector).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([d, n]) => `${d} ×${n}`).join(", ");
  const n = c.passes.length;
  const moversWord = c.truncated ? "the list was cut off, so the real number of passes may be higher"
    : c.enoughForMovers ? `enough for Find movers (it needs at least ${MOVERS_MIN_PASSES} passes about 6 months apart)` : `fewer than the ${MOVERS_MIN_PASSES} passes Find movers needs`;
  return `${c.covering.length} image${c.covering.length === 1 ? "" : "s"} cover the centre (${dets}), in ${n} survey pass${n === 1 ? "" : "es"} from ${c.first} to ${c.last} (${Math.round(c.spanDays)} days): ${moversWord}.`
    + (c.found > c.covering.length ? ` ${c.found - c.covering.length} more touch the circle without covering its centre.` : "");
}

/** The words for one image in the table. */
export const planeRow = (p, ra, dec) => ({
  date: mjdToDate(p.mjdStart), mjd: p.mjdStart, detector: p.detector,
  wavelength: p.wavelengthMinUm == null || p.wavelengthMaxUm == null ? "–" : `${p.wavelengthMinUm.toFixed(2)}–${p.wavelengthMaxUm.toFixed(2)}`,
  coversCentre: covers(p, ra, dec),
});

// ------------------------------------------------------------------ the request

/** Check the inputs the way the backend does, and say what is wrong in words. -> { ok: true, params } | { ok: false, error } */
export function checkParams({ ra, dec, radiusDeg, det = "all", limit = LIMIT_DEFAULT }) {
  if (![ra, dec, radiusDeg, limit].every(Number.isFinite)) return { ok: false, error: "Right ascension, declination and radius must be numbers." };
  if (ra < 0 || ra >= 360) return { ok: false, error: "Right ascension must be from 0 up to (not including) 360 degrees." };
  if (dec < -90 || dec > 90) return { ok: false, error: "Declination must be from -90 to +90 degrees." };
  if (!(radiusDeg > 0 && radiusDeg <= RADIUS_MAX_DEG)) return { ok: false, error: `The radius must be above 0 and at most ${RADIUS_MAX_DEG} degrees.` };
  if (det !== "all" && !DETECTORS.includes(det)) return { ok: false, error: "The detector must be All or one of D1 to D6." };
  if (!(Number.isInteger(limit) && limit >= 1 && limit <= LIMIT_MAX)) return { ok: false, error: `The limit must be a whole number from 1 to ${LIMIT_MAX}.` };
  return { ok: true, params: { ra, dec, radiusDeg, det, limit } };
}

export function surveyUrl(apiBase, { ra, dec, radiusDeg, det = "all", limit = LIMIT_DEFAULT }) {
  const q = new URLSearchParams({ ra: ra.toFixed(6), dec: dec.toFixed(6), radius: String(radiusDeg), det, limit: String(limit) });
  return `${apiBase}/api/survey?${q}`;
}

/** Ask the backend. Resolves with its answer; rejects with an Error whose message says what went wrong (never a silent empty list). */
export async function fetchSurvey(apiBase, params, { fetchFn = fetch, timeoutMs = 150000 } = {}) {
  const checked = checkParams(params);
  if (!checked.ok) throw new Error(checked.error);
  let response;
  try {
    response = await fetchFn(surveyUrl(apiBase, checked.params), { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new Error(err?.name === "TimeoutError" ? "The backend did not answer in time (IRSA can be slow: try again, or a smaller circle)." : `Cannot reach the backend at ${apiBase} (${err?.message ?? err}).`);
  }
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.json()).detail ?? ""; } catch { /* not JSON */ }
    throw new Error(response.status === 502 ? `IRSA did not answer: ${detail || "the backend could not reach it"}.` : `The backend refused the search (HTTP ${response.status})${detail ? `: ${detail}` : ""}.`);
  }
  const answer = await response.json();
  if (!Array.isArray(answer?.planes)) throw new Error("The backend answered with something that is not a list of survey images.");
  return answer;
}
