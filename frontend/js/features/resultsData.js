// resultsData.js – the Results page reads ONE file and everything on it (the numbers, the charts, the tables) comes from that file.
//
// Four kinds of file are understood, told apart by what they contain (never by their name):
//   "export"      the JSON the workspace saves ("Save list (JSON)"): { tool, generated, data, field, candidates: [...] }
//   "export-csv"  the CSV the workspace saves next to it (one line per candidate; the columns of export.js COLUMNS)
//   "sources"     the list of Find everything on several fields (data/real_sources.json: { fields: [{ rows }] })
//   "validation"  the numbers of a validation run (data/real_results_generated.json laid over real_results.json: { movers: { runs }, ... })
// readResultsFile() turns any of them into a DATASET: the same shape whatever the file was, so the page has one set of charts and one table.
//
//   dataset = { kind, label, source, provenance (what the data is: real or synthetic, always), date, dateNote?, limitation, rows: [row], fields: [{ label, detector, ra, dec, fov }], raw }
//   row     = { id, label, detector, motion, detections, images, samples, match, pointer, link, facts, kind?, class?, classLabel?, ra, dec, sigma, chance, rms, snr, support, field, ... }
//
// Pure (no DOM, no network): scratch/test_results_file.mjs. A file that is not one of these says so, in words; nothing is guessed or filled in.

import { archiveDataset, importDataset, fieldLink } from "./candidateEvidence.js";
import { dataLabel } from "./export.js";

export const MAX_FILE_BYTES = 16 * 1024 * 1024;

// ---------------------------------------------------------------- CSV

/** CSV text -> array of arrays. Quotes, doubled quotes, "\r\n" and a leading byte-order mark are handled; a cell that began with ' (the formula guard of export.js) loses it. */
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, "");
  const out = [];
  let row = [], cell = "", quoted = false, i = 0;
  const endCell = () => { row.push(/^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell); cell = ""; };
  const endRow = () => { endCell(); if (row.length > 1 || row[0] !== "") out.push(row); row = []; };
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") endCell();
    else if (c === "\n") endRow();
    else if (c !== "\r") cell += c;
    i++;
  }
  if (cell !== "" || row.length) endRow();
  return out;
}

const CSV_NUMBERS = ["ra_deg", "dec_deg", "epoch_mjd", "speed_arcsec_per_yr", "pm_east_arcsec_per_yr", "pm_north_arcsec_per_yr", "position_angle_deg", "detections", "images",
  "significance_sigma", "false_alarm_expected", "path_support_images", "path_images", "rms_px", "distance_au", "distance_range_lo_au", "distance_range_hi_au", "own_velocity_kms",
  "asteroid_dates", "mean_source_snr"];

/** The CSV of the workspace -> the same document as its JSON export (what importDataset reads). Throws an Error that says what is wrong with the file. */
export function csvToExport(text, { lastModified = null } = {}) {
  const table = parseCsv(text);
  if (table.length < 2) throw new Error("This CSV has no rows.");
  const head = table[0].map((h) => h.trim());
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  for (const need of ["candidate", "kind", "detector", "detections", "images", "data", "field_ra_deg", "field_dec_deg", "field_fov_arcmin"]) {
    if (!(need in col)) throw new Error(`This CSV is not a SPHEREx Blink candidate export: the column "${need}" is missing.`);
  }
  const records = table.slice(1).map((cells, n) => {
    const rec = {};
    for (const [name, i] of Object.entries(col)) {
      const v = (cells[i] ?? "").trim();
      if (v === "") continue;
      if (CSV_NUMBERS.includes(name) || name.startsWith("field_")) {
        const x = Number(v);
        if (!Number.isFinite(x)) throw new Error(`Row ${n + 2}: "${v}" in the column ${name} is not a number.`);
        rec[name] = x;
      } else if (name === "bound_to_sun") rec[name] = v === "yes" ? true : v === "no" ? false : v;
      else rec[name] = v;
    }
    return rec;
  });
  const first = records[0];
  const labels = [...new Set(records.map((r) => r.data))];
  if (labels.length !== 1) throw new Error("The rows of this CSV do not all say the same thing about their data (real or synthetic): it was edited, so it is not read.");
  const when = records.map((r) => r.run_utc).find(Boolean) ?? (lastModified ? new Date(lastModified).toISOString() : null);
  if (!when) throw new Error("This CSV has no run time (run_utc) and the browser gave no file date.");
  const candidates = records.map(({ field_ra_deg, field_dec_deg, field_fov_arcmin, permalink, analysis, algorithm_version, run_utc, images_used, passes_used, settings, ...rest }) => rest);
  return {
    tool: "SPHEREx Blink (candidate CSV)", generated: when, data: first.data,
    field: { ra_deg: first.field_ra_deg, dec_deg: first.field_dec_deg, fov_arcmin: first.field_fov_arcmin, detector: first.detector },
    permalink: first.permalink ?? "", candidates,
    _fromCsv: { dateIsFileDate: !records.some((r) => r.run_utc), analysis: first.analysis ?? null, algorithmVersion: first.algorithm_version ?? null },
  };
}

// ---------------------------------------------------------------- the sources list (Find everything, several fields)

const CLASS_LABELS = { unknown: "Needs checking", unchecked: "Not checked", "unknown-weak": "Weakly supported", artefact: "Possible artefact", "catalogued-moving": "Catalogued, moving", "solar-system": "Known Solar System body", catalogued: "Catalogued" };

function sourceFact(label, value, key, unit = "") {
  return value == null || value === "" ? null : { label, value: String(value) + (unit ? " " + unit : ""), key };
}

/** data/real_sources.json -> dataset. */
export function sourcesDataset(file, name = "real_sources.json") {
  if (!Array.isArray(file?.fields) || !file.fields.length || !file.fields.every((f) => Array.isArray(f.rows))) throw new Error("This is not a list of sources: it needs a list of fields, each with its rows.");
  const rows = [];
  file.fields.forEach((f, fi) => {
    f.rows.forEach((r, ri) => {
      const detector = f.detector ?? "";
      const field = { ra_deg: f.raDeg, dec_deg: f.decDeg, fov_arcmin: f.fovArcmin, detector };
      rows.push({
        id: `${f.id ?? fi}:${r.id ?? ri}`, label: r.headline || String(r.id ?? ri + 1), detector, motion: Number.isFinite(r.motion) ? r.motion : null,
        detections: Number.isFinite(r.nDet) ? r.nDet : 0, images: Number.isFinite(r.nFrames) ? r.nFrames : 0, samples: [], match: r.match ?? "",
        pointer: `/fields/${fi}/rows/${ri}`, link: /^D[1-6]$/.test(detector) ? fieldLink(field, true) : "",
        class: r.class ?? null, classLabel: r.classLabel ?? CLASS_LABELS[r.class] ?? r.class ?? null, kind: r.classLabel ?? CLASS_LABELS[r.class] ?? "source",
        ra: Number.isFinite(r.ra) ? r.ra : null, dec: Number.isFinite(r.dec) ? r.dec : null, snr: Number.isFinite(r.snr) ? r.snr : null, support: Number.isFinite(r.support) ? r.support : null,
        flux: Number.isFinite(r.fluxMilliJy) ? r.fluxMilliJy : null, passes: Number.isFinite(r.passes) ? r.passes : null, sigma: null, chance: null, rms: null,
        field: r.field ?? f.label ?? "",
        facts: [
          sourceFact("Class", r.classLabel ?? CLASS_LABELS[r.class] ?? r.class, "class"), sourceFact("Field", r.field ?? f.label, "field"),
          sourceFact("Right ascension", r.ra, "ra", "deg"), sourceFact("Declination", r.dec, "dec", "deg"),
          sourceFact("Measured motion", r.motion, "motion", "arcsec/yr"), sourceFact("Detections / images", Number.isFinite(r.nDet) ? `${r.nDet} / ${r.nFrames}` : null, "seen"),
          sourceFact("Survey passes", r.passes, "passes"), sourceFact("Median S/N", r.snr, "snr"), sourceFact("Support score (0-100)", r.support, "support"),
          sourceFact("Median flux", r.fluxMilliJy, "fluxMilliJy", "mJy"), sourceFact("Best catalogue match", r.match, "match"), sourceFact("Tags", (r.tags ?? []).join(", "), "tags"),
        ].filter(Boolean),
      });
    });
  });
  const prov = file.fields[0]?.provenance;
  return {
    kind: "sources", label: name, source: name, provenance: prov?.data ?? "data of unknown kind (the file does not say)", date: file.measuredOn ?? prov?.ranAt ?? "date not in the file",
    isReal: typeof prov?.isReal === "boolean" ? prov.isReal : null, rows,
    fields: file.fields.map((f) => ({ label: f.label ?? f.id, detector: f.detector ?? "", ra: f.raDeg, dec: f.decDeg, fov: f.fovArcmin })),
    limitation: "A source nothing explains is a lead to check, not a discovery. How faint a source must be to be missed is in docs/VALIDATION.md.",
    command: file.command ?? null, raw: file,
  };
}

// ---------------------------------------------------------------- validation numbers

/** A validation file -> dataset (its rows are the mover runs); the whole object stays in `raw` for the charts of the validation sections. */
export function validationDataset(data, name = "validation file") {
  if (!Array.isArray(data?.movers?.runs)) throw new Error("This validation file has no movers.runs list.");
  const a = archiveDataset(data);
  return { ...a, kind: "validation", label: name, source: name, isReal: true, fields: [], raw: data };
}

// ---------------------------------------------------------------- read any file

/**
 * Text of a file -> { format, dataset }. Throws an Error whose message says what was wrong, for the page to show.
 *   options: { lastModified }  (the date of a CSV that carries no run time)
 */
export function readResultsFile(text, name = "file", options = {}) {
  const body = String(text).replace(/^﻿/, "");
  const trimmed = body.trimStart();
  if (!trimmed) throw new Error("The file is empty.");
  if (trimmed[0] === "{" || trimmed[0] === "[") {
    let doc;
    try { doc = JSON.parse(body); } catch (e) { throw new Error(`The file is not valid JSON (${e.message}).`); }
    if (Array.isArray(doc?.candidates)) return { format: "export", dataset: { ...importDataset(doc, name), kind: "export", isReal: doc.data !== dataLabel(false), fields: [fieldOf(doc.field)], raw: doc } };
    if (Array.isArray(doc?.fields)) return { format: "sources", dataset: sourcesDataset(doc, name) };
    if (doc?.movers) return { format: "validation", dataset: validationDataset(doc, name) };
    throw new Error("The file is JSON, but it is none of the files this page reads: a candidate export of the workspace (a list \"candidates\"), a list of sources (\"fields\") or validation numbers (\"movers\").");
  }
  const first = trimmed.split(/\r?\n/, 1)[0];
  if (first.includes(",") && /(^|,)candidate(,|$)/.test(first)) {
    const doc = csvToExport(body, options);
    const d = importDataset(doc, name);
    d.kind = "export"; d.isReal = doc.data !== dataLabel(false); d.fields = [fieldOf(doc.field)]; d.raw = doc;
    if (doc._fromCsv.dateIsFileDate) d.dateNote = "The CSV carries no run time; this is the date of the file.";
    return { format: "export-csv", dataset: d };
  }
  throw new Error("The file is neither JSON nor a candidate CSV of the workspace (its first line has no \"candidate\" column).");
}

const fieldOf = (f) => ({ label: `RA ${Number(f.ra_deg).toFixed(4)}°, Dec ${Number(f.dec_deg).toFixed(4)}°, ${f.fov_arcmin}′`, detector: f.detector, ra: f.ra_deg, dec: f.dec_deg, fov: f.fov_arcmin });

// ---------------------------------------------------------------- what is in a dataset

const num = (v) => typeof v === "number" && Number.isFinite(v);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Counts and ranges of the rows, all computed from the rows (nothing typed in). A number that no row has is null, never 0. */
export function datasetStats(ds) {
  const rows = ds.rows;
  const motions = rows.map((r) => r.motion).filter((v) => num(v) && v >= 0);
  const share = rows.filter((r) => r.images > 0).map((r) => r.detections / r.images);
  const count = (key) => { const by = {}; for (const r of rows) { const k = typeof key === "function" ? key(r) : r[key]; if (k !== null && k !== undefined && k !== "") by[k] = (by[k] ?? 0) + 1; } return by; };
  const fastest = rows.filter((r) => num(r.motion)).sort((a, b) => b.motion - a.motion)[0] ?? null;
  const sigmas = rows.map((r) => r.sigma).filter(num), mjds = rows.flatMap((r) => (r.samples ?? []).map((s) => s.mjd)).filter(num);
  return {
    total: rows.length,
    withMotion: motions.length, medianMotion: median(motions), fastest: fastest ? { label: fastest.label, motion: fastest.motion } : null,
    meanShare: share.length ? share.reduce((a, b) => a + b, 0) / share.length : null,
    withMatch: rows.filter((r) => r.match).length,
    withPosition: rows.filter((r) => num(r.ra) && num(r.dec)).length,
    withSigma: sigmas.length, maxSigma: sigmas.length ? Math.max(...sigmas) : null,
    detectors: count("detector"), kinds: count((r) => r.classLabel ?? r.kind), fields: count("field"),
    firstMjd: mjds.length ? Math.min(...mjds) : null, lastMjd: mjds.length ? Math.max(...mjds) : null,
  };
}
