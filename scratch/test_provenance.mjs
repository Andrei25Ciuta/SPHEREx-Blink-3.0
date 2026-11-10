// Tests for provenance.js: the record of how a search was run (input, settings, algorithm version, time) that every export carries.
// Run: node scratch/test_provenance.mjs
import {
  TOOL, ANALYSES, dataLabel, imageIdOf, describeImages, buildProvenance, missingProvenance, settingsText, provenanceColumns, PROVENANCE_CSV_COLUMNS, provenanceText,
} from "../frontend/js/features/provenance.js";
import { VERSION as MOVERS_VERSION, DEFAULTS } from "../frontend/js/features/movers.js";
import { VERSION as PARALLAX_VERSION, DISTANT_DEFAULTS } from "../frontend/js/features/parallax.js";
import { VERSION as DISCOVERY_VERSION, SETTINGS, NEEDS_CHECKING_SCORE, MIN_PERSISTENCE } from "../frontend/js/features/discovery.js";
import { candidatesToCsv, candidatesToJson, COLUMNS } from "../frontend/js/features/export.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}

// six synthetic images of two detectors in three survey passes
const frames = [
  { mjd: 61000.5, dateISO: "2026-02-02T12:00:00Z", detector: "D2", wavelengthMinUm: 1.10, wavelengthMaxUm: 1.14 },
  { mjd: 61000.6, dateISO: "2026-02-02T14:24:00Z", detector: "D2", wavelengthMinUm: 1.40, wavelengthMaxUm: 1.44 },
  { mjd: 61180.5, dateISO: "2026-08-01T12:00:00Z", detector: "D2", wavelengthMinUm: 1.20, wavelengthMaxUm: 1.24 },
  { mjd: 61180.6, dateISO: "2026-08-01T14:24:00Z", detector: "D6", wavelengthUm: 4.60 },
  { mjd: 61360.5, dateISO: "2027-01-28T12:00:00Z", detector: "D2", wavelengthMinUm: 1.50, wavelengthMaxUm: 1.54 },
  { mjd: 61360.6, dateISO: "2027-01-28T14:24:00Z", detector: "D6", wavelengthUm: 4.90 },
];
const ctx = { isReal: true, detector: "all", query: { ra: 269.4462, dec: 4.769, fov: 5 }, permalink: "https://example.test/?ra=269.4462" };

// ---------------------------------------------------------------- the images
{
  check("imageIdOf: detector and time", imageIdOf(frames[0]) === "D2@61000.5000");
  const d = describeImages(frames);
  check("describeImages: count, detectors, survey passes, first and last date", d.count === 6 && d.detectors.join() === "D2,D6" && d.passes === 3 && d.first === "2026-02-02T12:00:00Z" && d.last === "2027-01-28T14:24:00Z");
  check("describeImages: the wavelength range (a band gives its middle, a single value itself)", d.wavelengthUm[0] === 1.12 && d.wavelengthUm[1] === 4.9, d.wavelengthUm.join("–"));
  check("describeImages: ids in time order, even when the frames come in another order", describeImages([...frames].reverse()).ids.join() === d.ids.join() && d.ids.length === 6);
  const none = describeImages([]);
  check("describeImages: no images is described as such", none.count === 0 && none.passes === 0 && none.first === null && none.wavelengthUm === null);
  check("describeImages: without dateISO the date comes from the MJD", describeImages([{ mjd: 51544.5, detector: "D1", wavelengthUm: 1 }]).first === "2000-01-01T12:00:00Z");
}

// ---------------------------------------------------------------- the record
const base = { analysis: "find-everything", algorithm: { version: DISCOVERY_VERSION }, ctx, frames, settings: { ...SETTINGS }, ranAt: new Date("2026-11-08T10:00:00Z"), durationMs: 4249, catalogues: { used: ["simbad", "gaia"], problems: ["2MASS: HTTP 503"] }, pixels: "float32 (MJy / sr)" };
{
  const p = buildProvenance(base);
  check("buildProvenance: tool, analysis, the algorithm's name and version, and what the data is", p.tool === TOOL && p.analysis === "find-everything" && p.algorithm.name === ANALYSES["find-everything"] && p.algorithm.version === DISCOVERY_VERSION && p.data === dataLabel(true) && p.isReal === true);
  check("buildProvenance: the time of the RUN as ISO text, and how long it took", p.ranAt === "2026-11-08T10:00:00.000Z" && p.durationSeconds === 4.2);
  check("buildProvenance: the input is the field, the detector choice, and the images (count, passes, ids)", p.input.field.raDeg === 269.4462 && p.input.field.fovArcmin === 5 && p.input.detector === "all" && p.input.images.count === 6 && p.input.images.passes === 3 && p.input.pixels === "float32 (MJy / sr)");
  check("buildProvenance: the settings are a copy (changing the original later changes nothing)", (() => { const s = { a: 1 }; const q = buildProvenance({ ...base, settings: s }); s.a = 2; return q.settings.a === 1; })());
  check("buildProvenance: catalogues used and their problems are recorded", p.catalogues.used.join() === "simbad,gaia" && p.catalogues.problems[0].includes("503") && buildProvenance({ ...base, catalogues: null }).catalogues === null);
  check("buildProvenance: ranAt can be text; a missing duration is null, not 0", buildProvenance({ ...base, ranAt: "2026-01-01T00:00:00Z", durationMs: null }).ranAt === "2026-01-01T00:00:00Z" && buildProvenance({ ...base, durationMs: undefined }).durationSeconds === null);
  check("buildProvenance: the data label follows the context (synthetic data is labelled synthetic)", /SYNTHETIC/.test(buildProvenance({ ...base, ctx: { ...ctx, isReal: false } }).data));
  let threw = false; try { buildProvenance({ ...base, analysis: "magic" }); } catch { threw = true; }
  check("buildProvenance: an unknown kind of search is refused", threw);
  check("the record survives JSON", JSON.stringify(JSON.parse(JSON.stringify(p))) === JSON.stringify(p));
}

// ---------------------------------------------------------------- completeness
{
  const p = buildProvenance(base);
  check("missingProvenance: a full record misses nothing", missingProvenance(p).length === 0);
  const without = (mut) => { const q = JSON.parse(JSON.stringify(p)); mut(q); return missingProvenance(q); };
  check("missingProvenance names what is missing: version, time, images, field, settings, data", without((q) => { q.algorithm.version = null; }).join() === "algorithm version"
    && without((q) => { q.ranAt = "not a date"; }).join() === "time of the run" && without((q) => { q.input.images.count = 0; }).join() === "images used"
    && without((q) => { q.input.field = null; }).join() === "field" && without((q) => { q.settings = {}; }).join() === "settings" && without((q) => { q.data = ""; }).join() === "what the data is");
  check("missingProvenance: nothing at all misses everything", missingProvenance(null).length === 6 && missingProvenance(undefined).length === 6);
}

// ---------------------------------------------------------------- the versions and settings come from the code, not from this file
{
  check("every search has a version label (name-number); a change that may alter results raises the number (movers-2 and discovery-3 since Phase 4)", /^movers-\d+$/.test(MOVERS_VERSION) && /^parallax-\d+$/.test(PARALLAX_VERSION) && /^discovery-\d+$/.test(DISCOVERY_VERSION)
    && Number(MOVERS_VERSION.split("-")[1]) >= 2 && Number(DISCOVERY_VERSION.split("-")[1]) >= 3);
  check("Find everything's settings are the constants of discovery.js", SETTINGS.needsCheckingScore === NEEDS_CHECKING_SCORE && SETTINGS.minPersistence === MIN_PERSISTENCE && Object.values(SETTINGS).every(Number.isFinite));
  check("Find movers' settings are DEFAULTS and the parallax search's are DISTANT_DEFAULTS (every value a number)", Object.keys(DEFAULTS).length >= 12 && Object.values(DEFAULTS).every(Number.isFinite) && Object.values(DISTANT_DEFAULTS).every((v) => typeof v === "number") && DISTANT_DEFAULTS.minDistanceAU === 50 && DISTANT_DEFAULTS.maxParallaxRmsPx === 0.6);
}

// ---------------------------------------------------------------- text and columns
{
  check("settingsText: sorted keys, arrays joined", settingsText({ b: 2, a: 1, c: [3, 4] }) === "a=1; b=2; c=3/4" && settingsText({}) === "");
  const p = buildProvenance(base), cols = provenanceColumns(p);
  check("provenanceColumns has exactly the CSV columns, filled", Object.keys(cols).join() === PROVENANCE_CSV_COLUMNS.join() && cols.algorithm_version === DISCOVERY_VERSION && cols.run_utc === p.ranAt && cols.images_used === 6 && cols.passes_used === 3 && cols.settings.includes("needsCheckingScore=65"));
  const text = provenanceText(p);
  check("provenanceText: what ran, which version, when, on what, with which settings, which catalogues, what the data is", text.includes(DISCOVERY_VERSION) && text.includes("2026-11-08T10:00:00.000Z") && text.includes("6 images (D2, D6; 3 survey passes; 2026-02-02 to 2027-01-28; 1.12–4.9 µm)")
    && text.includes("needsCheckingScore=65") && text.includes("Catalogues used: simbad, gaia; problems: 2MASS: HTTP 503") && text.includes("SPHEREx-format FITS data") && text.includes("all detectors"), text);
  check("provenanceText: one image is 'image', one pass 'pass', one detector named", provenanceText(buildProvenance({ ...base, ctx: { ...ctx, detector: "D2" }, frames: [frames[0]] })).includes("1 image (D2; 1 survey pass;") && provenanceText(buildProvenance({ ...base, ctx: { ...ctx, detector: "D2" } })).includes("detector D2"));
}

// ---------------------------------------------------------------- the movers export carries it
{
  const cand = { label: "#1", ra: 269.4, dec: 4.77, mjdRef: 61000.5, speedArcsecPerYear: 10, pmEastArcsecPerYear: -1, pmNorthArcsecPerYear: 10, positionAngleDeg: 355, nDet: 6, nFrames: 6, significance: 12, rms: 0.2, known: "", distant: null, asteroids: [] };
  const p = buildProvenance({ analysis: "find-movers", algorithm: { version: MOVERS_VERSION }, ctx: { ...ctx, isReal: false }, frames, settings: { ...DEFAULTS }, ranAt: "2026-11-08T11:00:00Z" });
  const pctx = { ...ctx, isReal: false, provenance: p };
  const lines = candidatesToCsv([cand], pctx).trim().split("\r\n");
  check("movers CSV: the header has the provenance columns last, and the row has the run", PROVENANCE_CSV_COLUMNS.every((k, i) => COLUMNS.at(-PROVENANCE_CSV_COLUMNS.length + i) === k) && lines[1].includes(`,${MOVERS_VERSION},2026-11-08T11:00:00Z,6,3,`) && lines[1].includes("detectSigma=5"));
  const json = JSON.parse(candidatesToJson([cand], pctx));
  check("movers JSON: the whole record at the top", json.provenance.algorithm.version === MOVERS_VERSION && json.provenance.settings.minPassGapDays === 30 && json.provenance.input.images.count === 6);
  check("movers export without a run: empty cells, null provenance", candidatesToCsv([cand], { ...ctx, isReal: false }).includes(",,,,,,") && JSON.parse(candidatesToJson([cand], { ...ctx, isReal: false })).provenance === null);
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
