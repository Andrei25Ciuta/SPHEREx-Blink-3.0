// catalogue.js – catalogue objects (SIMBAD) around the field, moved to the date of each image.
//
// Why not just query a circle? SIMBAD positions are for the YEAR 2000. A fast star has travelled
// since (Barnard's Star: 4.5 arcmin), so we also ask for the FAST objects in a wider circle and move
// every object to the date of each image with its proper motion before drawing it.
// SIMBAD is queried through its Harvard mirror (CORS open; the Strasbourg server is blocked on some
// networks). Pure functions + one fetch that takes an injectable fetch function, so it runs in Node tests.

import { positionAtEpoch } from "../targets.js";
import { skyToCanvas, mjdToYear } from "../geometry.js";

const SIMBAD_TAP = "https://simbad.harvard.edu/simbad/sim-tap/sync";
const FAST_MAS_PER_YEAR = 500;        // faster than 0.5 arcsec/yr counts as "fast" (searched in the wide circle)
const WIDE_MARGIN_DEG = 0.1;          // 6 arcmin: what a ~14 arcsec/yr star has moved since the year 2000
export const MOVING_ARCSEC_PER_YEAR = 1;   // objects moving more than this get a label and a path in the overlay
const MAX_ROWS = 800;

/** ADQL: everything inside the field, plus the fast movers from a wider circle (their year-2000 position). */
export function catalogueQuery(ra, dec, fovArcmin) {
  const near = (fovArcmin * 0.75) / 60;                 // a bit more than the half-diagonal (0.707 x field) of the square field
  const wide = near + WIDE_MARGIN_DEG;
  const circle = (r) => `CIRCLE('ICRS', ${ra.toFixed(6)}, ${dec.toFixed(6)}, ${r.toFixed(5)})`;
  return `SELECT TOP ${MAX_ROWS} main_id, ra, dec, pmra, pmdec, otype, sp_type FROM basic ` +
    `WHERE 1=CONTAINS(POINT('ICRS', ra, dec), ${circle(near)}) ` +
    `OR (1=CONTAINS(POINT('ICRS', ra, dec), ${circle(wide)}) AND pmra*pmra + pmdec*pmdec > ${FAST_MAS_PER_YEAR ** 2})`;
}

export function catalogueUrl(ra, dec, fovArcmin) {
  const params = new URLSearchParams({ REQUEST: "doQuery", LANG: "ADQL", FORMAT: "csv", QUERY: catalogueQuery(ra, dec, fovArcmin) });
  return `${SIMBAD_TAP}?${params}`;
}

/** One CSV line -> fields. Handles "quoted, fields" and doubled quotes. */
function splitCsvLine(line) {
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const num = (s) => (s === undefined || s === "" || !Number.isFinite(Number(s)) ? null : Number(s));

/**
 * SIMBAD CSV -> [{ id, label, ra, dec, pmra, pmdec, otype, spType }].
 * pmra already includes cos(dec) (mas/yr), like targets.js. Planets ("Pl") share their star's
 * position and are dropped; objects at the same position are listed once.
 */
export function parseCatalogueCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0].replace(/^\uFEFF/, "")).map((name) => name.trim());
  const col = (name) => header.indexOf(name);
  const [iId, iRa, iDec, iPmra, iPmdec, iType, iSp] = ["main_id", "ra", "dec", "pmra", "pmdec", "otype", "sp_type"].map(col);
  const seen = new Set(), objects = [];
  for (const line of lines.slice(1)) {
    const f = splitCsvLine(line);
    const ra = num(f[iRa]), dec = num(f[iDec]);
    if (ra === null || dec === null || f[iType] === "Pl") continue;
    const key = `${ra.toFixed(5)},${dec.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const id = (f[iId] ?? "").replace(/\s+/g, " ").trim();
    objects.push({
      id, label: id.replace(/^NAME /, ""), ra, dec,
      pmra: num(f[iPmra]), pmdec: num(f[iPmdec]), otype: f[iType] || "", spType: f[iSp] || "",
    });
  }
  return objects;
}

/** Ask SIMBAD. Throws an Error with a readable message if it cannot answer. */
export async function fetchCatalogue(ra, dec, fovArcmin, { fetchFn = fetch, timeoutMs = 15000 } = {}) {
  let response;
  try {
    response = await fetchFn(catalogueUrl(ra, dec, fovArcmin), { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new Error(`SIMBAD did not answer (${err?.name === "TimeoutError" ? "too slow" : "network"}).`);
  }
  if (!response.ok) throw new Error(`SIMBAD answered HTTP ${response.status}.`);
  const text = await response.text();
  if (text.trimStart().startsWith("<")) {                // an XML (VOTable) error instead of CSV
    const message = /value="ERROR"[^>]*>([^<]*)/.exec(text);
    throw new Error("SIMBAD reported an error: " + (message ? message[1].trim() : text.slice(0, 120)));
  }
  const columns = splitCsvLine(text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0]).map((name) => name.trim());
  if (!["main_id", "ra", "dec", "pmra", "pmdec", "otype", "sp_type"].every((name) => columns.includes(name)))
    throw new Error("SIMBAD returned an unrecognised CSV table.");
  return parseCatalogueCsv(text);
}

/** An object as targets.js expects it (positionAtEpoch needs numbers). */
const asTarget = (o) => ({ ra: o.ra, dec: o.dec, pmra: o.pmra ?? 0, pmdec: o.pmdec ?? 0 });

/** Total proper motion in arcsec/yr (0 if unknown). */
export const totalMotion = (o) => Math.hypot(o.pmra ?? 0, o.pmdec ?? 0) / 1000;

/**
 * Overlay data: where every object is on each frame's date, as image fractions (what the player draws).
 * Objects that never come near the image are left out.
 * geo = { ra, dec, n, scaleArcsec } of the cutout.
 */
export function catalogueTracks(objects, frames, geo, margin = 0.03) {
  const tracks = [];
  for (const o of objects) {
    const target = asTarget(o);
    const points = frames.map((f) => {
      const p = positionAtEpoch(target, mjdToYear(f.mjd));
      return skyToCanvas(p.ra, p.dec, geo);
    });
    const near = points.some((p) => p.fx > -margin && p.fx < 1 + margin && p.fy > -margin && p.fy < 1 + margin);
    const pm = totalMotion(o);
    if (near) tracks.push({ label: o.label, pm, moving: pm >= MOVING_ARCSEC_PER_YEAR, otype: o.otype, points });
  }
  return tracks;
}
