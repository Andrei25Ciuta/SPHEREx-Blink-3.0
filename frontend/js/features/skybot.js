// skybot.js – known asteroids and comets in the field, at the date of each image (SkyBoT, IMCCE/Paris Observatory).
//
// Why per image? A main-belt asteroid crosses a 5-arcmin field in about half a day (570 arcsec/day for the one
// we tested), so it is a different dot in every SPHEREx image and can never be linked into a straight line over
// months: it must be looked up at the exact date of each image. SkyBoT answers "which known Solar System bodies
// are inside this circle at this date?" with their computed positions.
//
// Reachability (checked 2026-11-07 from the project machine): https://ssp.imcce.fr/webservices/skybot/api/conesearch.php
// answers JSON with "Access-Control-Allow-Origin: *", so the browser calls it directly, no backend proxy. The older
// vo.imcce.fr address answered 403. Nothing here needs an account or key. If a network blocks the service, the
// functions throw an Error with a readable message and the interface says so.
//
// Positions are geocentric (-loc 500); SPHEREx orbits about 700 km above the ground, which shifts a main-belt
// asteroid by at most ~8 arcsec (about 1 pixel). Pure functions + fetches that take an injectable fetch function.

import { skyToCanvas } from "../geometry.js";

export const SKYBOT_URL = "https://ssp.imcce.fr/webservices/skybot/api/conesearch.php";
const JD_OF_MJD0 = 2400000.5;
export const MAX_POSITION_ERROR_ARCSEC = 30;   // a body whose computed position is less sure than this cannot be matched to a dot

/** Request URL for the bodies within radiusDeg of (ra, dec) on the date mjd. */
export function skybotUrl(ra, dec, radiusDeg, mjd) {
  const params = new URLSearchParams({
    "-ep": (mjd + JD_OF_MJD0).toFixed(5),          // epoch as a Julian date
    "-ra": ra.toFixed(6), "-dec": dec.toFixed(6), "-rd": radiusDeg.toFixed(5),
    "-mime": "json", "-output": "basic", "-loc": "500",
  });
  return `${SKYBOT_URL}?${params}`;
}

const hmsToDeg = (s) => { const [h, m, sec] = s.trim().split(/\s+/).map(Number); return 15 * (h + m / 60 + sec / 3600); };
const dmsToDeg = (s) => {
  const t = s.trim(), sign = t.startsWith("-") ? -1 : 1;
  const [d, m, sec] = t.replace(/^[+-]/, "").split(/\s+/).map(Number);
  return sign * (d + m / 60 + sec / 3600);
};

/**
 * SkyBoT JSON (an array) -> [{ name, ra, dec, vmag, cls, errArcsec, distArcsec, rateRaArcsecPerHour,
 * rateDecArcsecPerHour, rateArcsecPerDay }]. Rows without a usable position are dropped.
 */
export function parseSkybot(body) {
  if (!Array.isArray(body)) return [];
  const out = [];
  for (const row of body) {
    const ra = typeof row["RA (hms)"] === "string" ? hmsToDeg(row["RA (hms)"]) : NaN;
    const dec = typeof row["DEC (dms)"] === "string" ? dmsToDeg(row["DEC (dms)"]) : NaN;
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;
    const dRa = Number(row["dRA (arcsec/h)"]), dDec = Number(row["dDEC (arcsec/h)"]);
    out.push({
      name: String(row.Name ?? "?").trim(), ra, dec,
      vmag: Number.isFinite(Number(row["VMag (mag)"])) ? Number(row["VMag (mag)"]) : null,
      cls: row.Class ?? "",
      errArcsec: Number.isFinite(Number(row["Err (arcsec)"])) ? Number(row["Err (arcsec)"]) : null,
      distArcsec: Number(row["d (arcsec)"]),
      rateRaArcsecPerHour: dRa, rateDecArcsecPerHour: dDec,
      rateArcsecPerDay: Number.isFinite(dRa) && Number.isFinite(dDec) ? 24 * Math.hypot(dRa, dDec) : null,
    });
  }
  return out;
}

/** Ask SkyBoT for one date. Resolves to the parsed list ([] if there is no body); throws an Error with a readable message. */
export async function fetchSkybot(ra, dec, radiusDeg, mjd, { fetchFn = fetch, timeoutMs = 15000 } = {}) {
  let response;
  try {
    response = await fetchFn(skybotUrl(ra, dec, radiusDeg, mjd), { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new Error(`SkyBoT did not answer (${err?.name === "TimeoutError" ? "too slow" : "network or blocked"}).`);
  }
  if (response.status === 204) return [];                      // "no Solar System body in this circle"
  const text = await response.text();
  if (!response.ok) {
    let detail = "";
    try { detail = JSON.parse(text).message ?? ""; } catch { /* not JSON */ }
    throw new Error(`SkyBoT answered HTTP ${response.status}${detail ? `: ${detail}` : ""}.`);
  }
  if (!text.trim()) return [];
  let json;
  try { json = JSON.parse(text); } catch { throw new Error("SkyBoT sent something that is not JSON."); }
  if (!Array.isArray(json)) {
    if (json && typeof json === "object" && Number(json.status) >= 400) throw new Error(`SkyBoT reported: ${json.message ?? json.status}.`);
    throw new Error("SkyBoT returned an unexpected JSON response.");
  }
  const objects = parseSkybot(json);
  if (json.length && !objects.length) throw new Error("SkyBoT returned rows with unusable positions.");
  return objects;
}

/** Search circle (degrees) that covers a square field: a bit more than half the diagonal. */
export const fieldRadiusDeg = (fovArcmin) => (fovArcmin * 0.75) / 60;

/**
 * The bodies for every image: one request per image date (4 at a time). Answers are cached in `cache`
 * (a Map, keyed by field and date) so ticking the overlay twice does not ask twice.
 * Returns { perFrame: [objects | null per frame], failures: number, firstError: string }.
 * (A frame whose request failed is null; if EVERY request failed the first error is thrown.)
 */
export async function fetchSkybotForFrames(frames, { ra, dec, fovArcmin }, { fetchFn = fetch, concurrency = 4, onProgress = () => {}, cache = new Map(), shouldStop = () => false } = {}) {
  const radius = fieldRadiusDeg(fovArcmin);
  const perFrame = new Array(frames.length).fill(null);
  let next = 0, done = 0, failures = 0, firstError = "";
  const worker = async () => {
    while (next < frames.length && !shouldStop()) {
      const k = next++;
      const key = `${ra.toFixed(4)},${dec.toFixed(4)},${fovArcmin},${frames[k].mjd.toFixed(4)}`;
      try {
        if (!cache.has(key)) cache.set(key, await fetchSkybot(ra, dec, radius, frames[k].mjd, { fetchFn }));
        perFrame[k] = cache.get(key);
      } catch (err) {
        failures++;
        firstError ||= err.message;
      }
      onProgress(++done, frames.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, frames.length) }, worker));
  if (frames.length && failures === frames.length) throw new Error(firstError);
  return { perFrame, failures, firstError };
}

/**
 * Where every body is on every image, as image fractions (what the player draws). Bodies outside the image
 * (plus a small margin) or with a position less sure than MAX_POSITION_ERROR_ARCSEC are left out.
 * geo = { ra, dec, n, scaleArcsec }. Returns, per frame: [{ name, fx, fy, vmag, cls, rateArcsecPerDay, errArcsec }] (or null).
 */
export function asteroidPoints(perFrame, geo, margin = 0.03) {
  return perFrame.map((objects) => {
    if (!objects) return null;
    const list = [];
    for (const o of objects) {
      if (o.errArcsec !== null && o.errArcsec > MAX_POSITION_ERROR_ARCSEC) continue;
      const { fx, fy } = skyToCanvas(o.ra, o.dec, geo);
      if (fx < -margin || fx > 1 + margin || fy < -margin || fy > 1 + margin) continue;
      list.push({ name: o.name, fx, fy, vmag: o.vmag, cls: o.cls, rateArcsecPerDay: o.rateArcsecPerDay, errArcsec: o.errArcsec });
    }
    return list;
  });
}

/**
 * Does a candidate sit on a known body? track = [{ fx, fy }] per frame (where the candidate is on each image);
 * points = asteroidPoints(...). A body matches on the frames where it lies within radiusArcsec of the candidate.
 * Returns [{ name, vmag, cls, hits, frames: [k...], nearestArcsec }], most hits first. Frames without an answer are skipped.
 */
export function matchAsteroids(track, points, geo, { radiusArcsec = 20 } = {}) {
  const px = radiusArcsec / geo.scaleArcsec;
  const byName = new Map();
  track.forEach((t, k) => {
    for (const a of points[k] ?? []) {
      const dist = Math.hypot((a.fx - t.fx) * geo.n, (a.fy - t.fy) * geo.n);
      if (dist > px) continue;
      const e = byName.get(a.name) ?? { name: a.name, vmag: a.vmag, cls: a.cls, hits: 0, frames: [], nearestArcsec: Infinity };
      e.hits += 1; e.frames.push(k); e.nearestArcsec = Math.min(e.nearestArcsec, dist * geo.scaleArcsec);
      byName.set(a.name, e);
    }
  });
  return [...byName.values()].sort((p, q) => q.hits - p.hits || p.nearestArcsec - q.nearestArcsec);
}
