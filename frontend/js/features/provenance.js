// provenance.js – where a result came from: its INPUT (which field, which images), its SETTINGS (every threshold the search used), the
// ALGORITHM and its version, and WHEN it ran. Built when a search finishes (not when a file is saved, which can be much later) and carried by every
// export, so a CSV or JSON that is passed around says how it was made and can be reproduced or doubted. Pure functions (no DOM): scratch/test_provenance.mjs.
//
// The version labels (movers-1, discovery-2, ...) are names the code gives itself; they are changed whenever a change may alter what a search finds.
// They were first written on 8 Nov 2026: a file made before that has none.

import { passIndices } from "./movers.js";

export const TOOL = "SPHEREx Blink (NASA Space Apps 2026)";

/** What the data behind a file is: the sentence that must travel with it (export.js and dossier.js re-export it). `source` is true/false (real or synthetic demo) or the tag of the FITS served by the backend ("synthetic", "unverified", "mixed", "spherex_header"). */
export const dataLabel = (source) => (source === "synthetic"
  ? "SYNTHETIC FITS data (served by the backend, NOT SPHEREx observations)"
  : source === "unverified" || source === "mixed"
    ? "FITS data with unverified or mixed provenance (served by the backend)"
    : source === "spherex_header" || source === true
      ? "SPHEREx-format FITS data (served by the backend; verify archive provenance)"
      : "SYNTHETIC demo data (invented in the browser, NOT SPHEREx observations)");

/** What each kind of search is called. `versions` is filled in by the caller from the modules (see algorithmFor) so this file imports no heavy module. */
export const ANALYSES = {
  "find-movers": "Find movers (dots linked along straight lines across survey passes)",
  "find-distant": "Look for a distant body (dots linked by the Earth's parallax)",
  "find-everything": "Find everything (every source: vetted, cross-matched, ranked)",
};

const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
const iso = (mjd) => new Date((mjd - 40587) * 86400000).toISOString().replace(/\.\d+Z$/, "Z");

/** The identifier of an image the way the searches use it (js/main.js frameId): detector, time and band. */
export const imageIdOf = (f) => `${f.detector}@${Number(f.mjd).toFixed(4)}`;

/**
 * Describe the images a search used.
 * frames: [{ mjd, dateISO?, detector, wavelengthUm? | wavelengthMinUm + wavelengthMaxUm }]
 */
export function describeImages(frames) {
  const list = [...frames].sort((a, b) => a.mjd - b.mjd);
  if (!list.length) return { count: 0, detectors: [], passes: 0, first: null, last: null, wavelengthUm: null, ids: [] };
  const wl = list.map((f) => (Number.isFinite(f.wavelengthUm) ? f.wavelengthUm : (f.wavelengthMinUm + f.wavelengthMaxUm) / 2)).filter(Number.isFinite);
  return {
    count: list.length,
    detectors: [...new Set(list.map((f) => f.detector))].sort(),
    passes: passIndices(list.map((f) => f.mjd)).at(-1) + 1,
    first: list[0].dateISO ?? iso(list[0].mjd),
    last: list.at(-1).dateISO ?? iso(list.at(-1).mjd),
    wavelengthUm: wl.length ? [round(Math.min(...wl), 3), round(Math.max(...wl), 3)] : null,
    ids: list.map(imageIdOf),
  };
}

/**
 * The provenance record of one search.
 *   analysis   "find-movers" | "find-distant" | "find-everything"
 *   algorithm  { version } (the module's VERSION constant), name comes from ANALYSES
 *   ctx        { isReal, detector, query: { ra, dec, fov }, permalink }
 *   frames     the images used (see describeImages)
 *   settings   a flat object: every number the search was run with (thresholds, options)
 *   ranAt      Date or ISO text: the moment the search FINISHED (default: now)
 *   durationMs how long it took (optional)
 *   catalogues { used: [...], problems: [...] } for Find everything (optional)
 *   pixels     "float32 (the file's own unit)" or "8-bit pictures"
 */
export function buildProvenance({ analysis, algorithm, ctx, frames, settings = {}, ranAt = new Date(), durationMs = null, catalogues = null, pixels = null }) {
  if (!ANALYSES[analysis]) throw new Error(`Unknown analysis "${analysis}"`);
  const images = describeImages(frames);
  const when = ranAt instanceof Date ? ranAt.toISOString() : String(ranAt);
  return {
    tool: TOOL,
    analysis,
    algorithm: { name: ANALYSES[analysis], version: algorithm?.version ?? null },
    data: dataLabel(ctx.isReal),
    isReal: Boolean(ctx.isReal),
    ranAt: when,
    durationSeconds: Number.isFinite(durationMs) ? round(durationMs / 1000, 1) : null,
    input: {
      field: { raDeg: round(ctx.query.ra, 5), decDeg: round(ctx.query.dec, 5), fovArcmin: ctx.query.fov },
      detector: ctx.detector, images, pixels,
    },
    settings: { ...settings },
    catalogues: catalogues ? { used: [...(catalogues.used ?? [])], problems: [...(catalogues.problems ?? [])] } : null,
    permalink: ctx.permalink ?? "",
    note: "Candidates are leads with their evidence, not discoveries. These settings and this input reproduce the search; they do not make it correct.",
  };
}

/** What is missing from a provenance record (an empty list = complete). Exports refuse nothing, but the tests and the page say so. */
export function missingProvenance(p) {
  const miss = [];
  if (!p?.algorithm?.version) miss.push("algorithm version");
  if (!p?.ranAt || Number.isNaN(Date.parse(p.ranAt))) miss.push("time of the run");
  if (!p?.input?.images?.count) miss.push("images used");
  if (!p?.input?.field || !Number.isFinite(p.input.field.raDeg)) miss.push("field");
  if (!p?.settings || !Object.keys(p.settings).length) miss.push("settings");
  if (typeof p?.data !== "string" || !p.data) miss.push("what the data is");
  return miss;
}

/** "a=1; b=2": settings in one cell, keys sorted so that two runs compare as text. */
export function settingsText(settings) {
  return Object.keys(settings).sort().map((k) => {
    const v = settings[k];
    return `${k}=${Array.isArray(v) ? v.join("/") : v}`;
  }).join("; ");
}

/** The same record as columns for a CSV (every row says how the file was made). */
export function provenanceColumns(p) {
  return {
    analysis: p.analysis, algorithm_version: p.algorithm.version, run_utc: p.ranAt,
    images_used: p.input.images.count, passes_used: p.input.images.passes, settings: settingsText(p.settings),
  };
}
export const PROVENANCE_CSV_COLUMNS = ["analysis", "algorithm_version", "run_utc", "images_used", "passes_used", "settings"];

/** A paragraph for people (Markdown or the page). */
export function provenanceText(p) {
  const im = p.input.images, f = p.input.field;
  const where = `field RA ${f.raDeg}°, Dec ${f.decDeg}°, ${f.fovArcmin}′, ${p.input.detector === "all" ? "all detectors" : `detector ${p.input.detector}`}`;
  const used = im.count ? `${im.count} image${im.count === 1 ? "" : "s"} (${im.detectors.join(", ")}; ${im.passes} survey pass${im.passes === 1 ? "" : "es"}; ${String(im.first).slice(0, 10)} to ${String(im.last).slice(0, 10)}${im.wavelengthUm ? `; ${im.wavelengthUm[0]}–${im.wavelengthUm[1]} µm` : ""})` : "no images";
  return `${p.tool}: ${p.algorithm.name}, ${p.algorithm.version}. Run at ${p.ranAt}${p.durationSeconds !== null ? ` (took ${p.durationSeconds} s)` : ""} on ${used}, ${where}. ` +
    `${p.data}. Settings: ${settingsText(p.settings)}.${p.catalogues ? ` Catalogues used: ${p.catalogues.used.join(", ") || "none"}${p.catalogues.problems.length ? `; problems: ${p.catalogues.problems.join("; ")}` : ""}.` : ""}${p.permalink ? ` Reopen: ${p.permalink}.` : ""}`;
}

/**
 * The lines printed INTO a saved picture or video (a picture travels without its file name, a screenshot without its page): what the data are, where, which image, how it was drawn.
 * -> [line1, line2]; line 1 is the one that must never be missing (real or SYNTHETIC).
 */
export function pictureCaption({ isReal, query, frame, mode, when = new Date() }) {
  const date = frame?.dateISO ? String(frame.dateISO).slice(0, 10) : "date unknown";
  const wl = Number.isFinite(frame?.wavelengthMinUm) && Number.isFinite(frame?.wavelengthMaxUm) ? ` ${frame.wavelengthMinUm.toFixed(2)}–${frame.wavelengthMaxUm.toFixed(2)} µm` : "";
  const where = query && Number.isFinite(query.ra) && Number.isFinite(query.dec) ? `RA ${query.ra.toFixed(4)}° Dec ${query.dec.toFixed(4)}°${Number.isFinite(query.fov) ? `, ${query.fov}′` : ""}` : "field unknown";
  return [
    isReal ? "SPHEREx-format FITS data (derived pixels; verify archive provenance)" : "SYNTHETIC DEMO IMAGE: invented in the browser, NOT a SPHEREx observation",
    `${TOOL} · ${where} · ${frame?.detector ?? "?"} · ${date}${wl} · ${mode ?? "?"} · saved ${when.toISOString().slice(0, 10)}`,
  ];
}
