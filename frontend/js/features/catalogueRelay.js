// catalogueRelay.js – ask every catalogue the cross-match needs, tolerating failures.
//
//   SIMBAD     directly from the browser (catalogue.js; its server allows CORS)
//   Gaia DR3, 2MASS, AllWISE   through our backend (/api/catalogue): IRSA and ESA send no CORS headers
//
// A catalogue that does not answer is reported and left out (the cross-match then says "not checked" for it); one the server had to cut
// short (a very dense field) is marked `truncated`, and crossmatch.js does not take its silence as "not in the catalogue".
// The circles are wider than the field on purpose: a fast star has moved a long way since the catalogue's date.
//   * Gaia (epoch 2016.0) keeps its proper motion, so the fast stars (above 500 mas/yr) are asked for in a wider circle (as SIMBAD is);
//   * 2MASS (about 1999) and AllWISE (about 2010) have none: a moving candidate is carried back to their date, so their circle reaches
//     4 arcmin beyond the field (10 arcsec/yr for 26 years is 4.3 arcmin).
// Network code with an injectable fetch, so it runs in Node tests.

import { fetchCatalogue } from "./catalogue.js";
import { normaliseCatalogue } from "./crossmatch.js";

export const FAST_PM_MAS = 500;
export const MAX_RADIUS_ARCMIN = 25;              // what the backend accepts
const FIELD_MARGIN_ARCMIN = 0.5;
const BACK_IN_TIME_MARGIN_ARCMIN = 4;
const FAST_STAR_MARGIN_ARCMIN = 6;

const clamp = (r) => Math.min(MAX_RADIUS_ARCMIN, r);

/** The circles (arcmin) for a square field of fovArcmin: the field itself, 2MASS/AllWISE (carried back), Gaia's fast stars. */
export function radiiFor(fovArcmin) {
  const half = fovArcmin * 0.75;                   // a bit more than half the diagonal of the square field
  return { field: clamp(half + FIELD_MARGIN_ARCMIN), backInTime: clamp(half + BACK_IN_TIME_MARGIN_ARCMIN), fastStars: clamp(half + FAST_STAR_MARGIN_ARCMIN) };
}

export function relayUrl(apiBase, cat, ra, dec, radiusArcmin, minPmMas = 0) {
  const p = new URLSearchParams({ cat, ra: ra.toFixed(6), dec: dec.toFixed(6), radius: radiusArcmin.toFixed(3) });
  if (minPmMas > 0) p.set("minpm", String(minPmMas));
  return `${apiBase}/api/catalogue?${p}`;
}

/** One answer of the backend: { rows, truncated }. Throws an Error with a readable message. */
export async function fetchRelayRows(apiBase, cat, ra, dec, radiusArcmin, { minPmMas = 0, fetchFn = fetch, timeoutMs = 130000 } = {}) {
  let response;
  try {
    response = await fetchFn(relayUrl(apiBase, cat, ra, dec, radiusArcmin, minPmMas), { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new Error(err?.name === "TimeoutError" ? "too slow" : "the backend did not answer");
  }
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.json()).detail ?? ""; } catch { /* not JSON */ }
    throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  const body = await response.json();
  if (!body || !Array.isArray(body.rows)) throw new Error("unexpected answer");
  return { rows: body.rows, truncated: Boolean(body.truncated) };
}

/**
 * All catalogues for the field. Never throws. Returns { catalogues: { simbad?, gaia?, "2mass"?, allwise? }, notes: [text], failed: [key] }.
 * apiBase: the backend, or null/"" when there is none (then only SIMBAD is asked).
 */
export async function fetchAllCatalogues({ ra, dec, fovArcmin, apiBase, fetchFn = fetch, timeoutMs, onProgress = () => {}, shouldStop = () => false }) {
  const catalogues = {}, notes = [], failed = [];
  const r = radiiFor(fovArcmin);
  const fail = (key, label, err) => { failed.push(key); notes.push(`${label}: ${err.message}`); };

  onProgress("SIMBAD");
  try { catalogues.simbad = normaliseCatalogue("simbad", await fetchCatalogue(ra, dec, fovArcmin, { fetchFn })); } catch (err) { fail("simbad", "SIMBAD", err); }
  if (!apiBase) {
    notes.push("Gaia DR3, 2MASS and AllWISE need the backend, which is not available: SIMBAD alone cannot say that a source is new.");
    return { catalogues, notes, failed };
  }

  const ask = async (key, label, radius, minPmMas = 0) => fetchRelayRows(apiBase, key, ra, dec, radius, { minPmMas, fetchFn, timeoutMs });
  const finish = (key, rows, truncated, label) => {
    const list = normaliseCatalogue(key, rows);
    if (truncated) { list.truncated = true; notes.push(`${label}: the field is so dense that the answer was cut short, so a source missing from the list is not proof that it is new.`); }
    catalogues[key] = list;
  };

  for (const [key, label, radius] of [["2mass", "2MASS", r.backInTime], ["allwise", "AllWISE", r.backInTime]]) {   // one at a time: IRSA drops parallel connections
    if (shouldStop()) break;
    onProgress(label);
    try { const a = await ask(key, label, radius); finish(key, a.rows, a.truncated, label); } catch (err) { fail(key, label, err); }
  }
  if (!shouldStop()) {
    onProgress("Gaia DR3");
    try {
      const all = await ask("gaia", "Gaia DR3", r.field);
      let rows = all.rows, truncated = all.truncated;
      try {                                                     // the fast stars, from a wider circle: where they were in 2016
        const fast = await ask("gaia", "Gaia DR3", r.fastStars, FAST_PM_MAS);
        const have = new Set(rows.map((row) => row.id));
        rows = rows.concat(fast.rows.filter((row) => !have.has(row.id)));
        truncated ||= fast.truncated;
      } catch (err) {
        notes.push(`Gaia DR3 fast stars: ${err.message} (a fast star that has moved out of the field since 2016 may be missed)`);
      }
      finish("gaia", rows, truncated, "Gaia DR3");
    } catch (err) { fail("gaia", "Gaia DR3", err); }
  }
  return { catalogues, notes, failed };
}
