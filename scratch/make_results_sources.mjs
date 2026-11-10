// Writes frontend/data/real_sources.json: every source "Find everything" lists on the six real fields of docs/VALIDATION.md §14, as DERIVED numbers
// (position, motion, signal-to-noise, support score, flux, best catalogue match), each field with the provenance of its run (input, settings, algorithm
// version, time). No pixel and no image goes in. The results page (results.html, section 11) reads this file.
//
// Needs the real-only backend (SPHEREX_DATA_DIR=backend/data/real on port 8003: "backend-real" in .claude/launch.json) and internet for the catalogues
// (SIMBAD, Gaia DR3, 2MASS, AllWISE, SkyBoT). It downloads no new FITS file.
//
//   node scratch/make_results_sources.mjs                   (all six fields; takes a few minutes)
//   node scratch/make_results_sources.mjs --field "Barnard D2" --out scratch/_out/one.json   (one field, another file)
//   (--api http://localhost:8003  --skybot 0 to skip the asteroid lookup)

import { discover, SETTINGS, VERSION } from "../frontend/js/features/discovery.js";
import { fetchAllCatalogues } from "../frontend/js/features/catalogueRelay.js";
import { fetchSkybotForFrames } from "../frontend/js/features/skybot.js";
import { explorerRow } from "../frontend/js/features/discoverPanel.js";
import { buildProvenance } from "../frontend/js/features/provenance.js";
import { loadField, parseArgs } from "./lib_real.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const FIELDS = [
  { id: "barnard-d2", label: "Barnard's Star field · D2", name: "Barnard D2", ra: 269.4462, dec: 4.769, det: "D2" },
  { id: "barnard-d6", label: "Barnard's Star field · D6", name: "Barnard D6", ra: 269.4462, dec: 4.769, det: "D6" },
  { id: "epsilon-indi-b-d2", label: "Epsilon Indi B field · D2", name: "Epsilon Indi B D2", ra: 331.0965, dec: -56.8006, det: "D2" },
  { id: "epsilon-indi-b-d6", label: "Epsilon Indi B field · D6", name: "Epsilon Indi B D6", ra: 331.0965, dec: -56.8006, det: "D6" },
  { id: "wise-0855-d2", label: "WISE 0855 field · D2", name: "WISE 0855 D2", ra: 133.7598, dec: -7.2422, det: "D2" },
  { id: "wise-0855-d6", label: "WISE 0855 field · D6", name: "WISE 0855 D6", ra: 133.7598, dec: -7.2422, det: "D6" },
];
const FOV = 5;                                                           // arcmin, as in VALIDATION §14

const args = parseArgs();
const api = args.api ?? "http://localhost:8003";
const out = args.out ?? "frontend/data/real_sources.json";
const wanted = args.field ? FIELDS.filter((f) => f.name === args.field) : FIELDS;
if (!wanted.length) { console.error(`--field must be one of: ${FIELDS.map((f) => f.name).join(", ")}`); process.exit(2); }

const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
const fields = [];
for (const fld of wanted) {
  const t0 = Date.now();
  const f = await loadField(api, fld.ra, fld.dec, FOV, fld.det);
  const { cats, notes } = await (async () => { const got = await fetchAllCatalogues({ ra: fld.ra, dec: fld.dec, fovArcmin: FOV, apiBase: api }); return { cats: got.catalogues, notes: got.notes }; })();
  let skybot = null;
  if (args.skybot !== "0") {
    try { skybot = (await fetchSkybotForFrames(f.frames, { ra: fld.ra, dec: fld.dec, fovArcmin: FOV })).perFrame; } catch (e) { notes.push(`SkyBoT: ${e.message}`); }
  }
  const frames = f.frames.map((fr, k) => ({ id: `${fld.det}-${k}`, mjd: fr.mjd, dateISO: fr.dateISO, detector: fld.det, wavelengthUm: (fr.wavelengthMinUm + fr.wavelengthMaxUm) / 2, grey: f.arrays[k], mask: f.masks[k] }));
  const result = discover({ frames, n: f.n, geo: f.geo, isFloat: true, catalogues: cats, skybot });
  const provenance = buildProvenance({
    analysis: "find-everything", algorithm: { version: VERSION }, frames: f.frames.map((fr) => ({ mjd: fr.mjd, dateISO: fr.dateISO, detector: fld.det, wavelengthMinUm: fr.wavelengthMinUm, wavelengthMaxUm: fr.wavelengthMaxUm })),
    ctx: { isReal: true, detector: fld.det, query: { ra: fld.ra, dec: fld.dec, fov: FOV }, permalink: "" }, settings: { ...SETTINGS },
    ranAt: new Date(), durationMs: Date.now() - t0, catalogues: { used: result.summary?.catalogues ?? [], problems: notes }, pixels: "float32 pixels in the file's own unit (backend)",
  });
  const rows = result.candidates.map((c) => {
    const r = explorerRow(c);
    return { ...r, field: fld.label, ra: round(r.ra, 5), dec: round(r.dec, 5), motion: round(r.motion, 3), snr: round(r.snr, 1), fluxMilliJy: round(r.fluxMilliJy, 4) };
  });
  fields.push({ id: fld.id, label: fld.label, detector: fld.det, raDeg: fld.ra, decDeg: fld.dec, fovArcmin: FOV, counts: result.summary?.counts ?? {}, total: rows.length, provenance, rows });
  console.log(`${fld.name}: ${rows.length} sources, ${Object.entries(result.summary?.counts ?? {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ")}; catalogues ${provenance.catalogues.used.join("+") || "none"}${notes.length ? `; PROBLEMS: ${notes.join("; ")}` : ""}; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

const file = {
  about: "Every source that 'Find everything' lists on six real SPHEREx fields (docs/VALIDATION.md §14), as derived numbers only: no pixel, no image, no FITS data. Each field carries how it was made (provenance: input, settings, algorithm version, time).",
  command: `node scratch/make_results_sources.mjs${args.field ? ` --field "${args.field}"` : ""}`,
  measuredOn: new Date().toISOString().slice(0, 10),
  fields,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(file, null, 1) + "\n");
console.log(`wrote ${out}: ${fields.length} field(s), ${fields.reduce((s, x) => s + x.total, 0)} sources`);
