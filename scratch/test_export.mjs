// Tests for frontend/js/features/export.js (candidates as CSV / JSON).  Run: node scratch/test_export.mjs
import { COLUMNS, candidateRecords, candidatesToCsv, candidatesToJson, exportFileName, dataLabel } from "../frontend/js/features/export.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}

const linear = { label: "#1", ra: 269.4462, dec: 4.769, mjdRef: 60985.12345, speedArcsecPerYear: 10.4321, pmEastArcsecPerYear: -0.8, pmNorthArcsecPerYear: 10.35,
  positionAngleDeg: 355.5, nDet: 15, nFrames: 15, significance: 13.04, rms: 0.2345, known: "Barnard's Star", distant: null, asteroids: [] };
const distant = { label: "#1", ra: 136.5, dec: 16.6, mjdRef: 60985.5, speedArcsecPerYear: 65.1, pmEastArcsecPerYear: 60, pmNorthArcsecPerYear: -25, positionAngleDeg: 112.6,
  nDet: 9, nFrames: 9, significance: 629, rms: 0.12, known: null, distanceAU: 601.234, distanceRangeAU: [595.4, 607.7],
  distant: { ownVelocityKms: 0.9, bound: true }, asteroids: [{ name: "=cmd|' /C calc'!A0", hits: 2, vmag: 19 }] };
const ctx = { isReal: false, detector: "D5", query: { ra: 136.5, dec: 16.6, fov: 30 }, permalink: "https://mateibut.github.io/SPHEREx/?ra=136.5&dec=16.6&fov=30&det=D5" };

const csv = candidatesToCsv([distant, linear], ctx);
const lines = csv.trimEnd().split("\r\n");
check("CSV: a header and one line per candidate", lines.length === 3 && lines[0] === COLUMNS.join(","), `${lines.length} lines`);
check("CSV: ends with a line break (spreadsheets expect it)", csv.endsWith("\r\n"));
// Splits one CSV line into its cells (commas inside quotes do not count). The earlier check counted cells with a regular expression that miscounts a line ending in an
// empty cell, which the provenance columns now produce when a file is made without a recorded search; the counting was wrong, not the files.
const splitCsv = (line) => { const cells = []; let cur = "", quoted = false; for (let i = 0; i < line.length; i++) { const ch = line[i];
  if (quoted) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch; }
  else if (ch === '"') quoted = true; else if (ch === ",") { cells.push(cur); cur = ""; } else cur += ch; } cells.push(cur); return cells; };
check("CSV: every data line has as many cells as the header (commas inside quotes do not count)", lines.slice(1).every((l) => splitCsv(l).length === COLUMNS.length), lines.slice(1).map((l) => splitCsv(l).length).join("/") + ` of ${COLUMNS.length}`);
check("CSV: each row says the data is SYNTHETIC and carries the permalink", lines.slice(1).every((l) => l.includes("SYNTHETIC demo data") && l.includes("https://mateibut.github.io/SPHEREx/?ra=136.5")));
check("CSV: a real-data export says so instead", candidatesToCsv([linear], { ...ctx, isReal: true }).includes("SPHEREx-format FITS data") && !candidatesToCsv([linear], { ...ctx, isReal: true }).includes("SYNTHETIC"));
check("CSV: text that a spreadsheet would run as a formula gets an apostrophe", lines[1].includes("'=cmd") && !/,=cmd/.test(lines[1]));
check("CSV: text with a comma is quoted as ONE cell (the data label has a comma), and a quote inside would be doubled",
  lines[1].includes('"SYNTHETIC demo data (invented in the browser, NOT SPHEREx observations)"')
  && candidatesToCsv([{ ...linear, known: 'say "hi"' }], ctx).includes('"say ""hi"""'));
const rec = candidateRecords([distant, linear], ctx);
check("records: a parallax candidate has distance, range, own velocity", rec[0].kind.startsWith("distant") && rec[0].distance_au === 601 && rec[0].distance_range_lo_au === 595 && rec[0].distance_range_hi_au === 608 && rec[0].own_velocity_kms === 0.9 && rec[0].bound_to_sun === true);
check("records: an ordinary mover has none of those (empty, not 0)", rec[1].kind.startsWith("mover") && rec[1].distance_au === null && rec[1].bound_to_sun === null);
check("records: the asteroid check says what it found, or that it was not run, or that nothing matched", rec[0].asteroid_match.includes("cmd") && rec[0].asteroid_dates === 2
  && rec[1].asteroid_match === "none within 20 arcsec" && candidateRecords([{ ...linear, asteroids: undefined }], ctx)[0].asteroid_match === "not checked");
check("records: numbers are rounded to a sensible precision", rec[1].speed_arcsec_per_yr === 10.432 && rec[1].epoch_mjd === 60985.123 && rec[1].significance_sigma === 13);
check("records: the known object is carried through", rec[1].known_object === "Barnard's Star");
check("records: path support (images with real flux at the predicted spot) is exported, empty when not measured",
  candidateRecords([{ ...linear, support: { supported: 5, measurable: 6 } }], ctx)[0].path_support_images === 5 && candidateRecords([{ ...linear, support: { supported: 5, measurable: 6 } }], ctx)[0].path_images === 6
  && rec[1].path_support_images === null && COLUMNS.includes("path_support_images"));
check("records: the false-alarm number (expected chance lines) is exported, empty when unknown",
  candidateRecords([{ ...linear, falseAlarm: 4.2e-15 }], ctx)[0].false_alarm_expected === 4.2e-15 && rec[1].false_alarm_expected === null && COLUMNS.includes("false_alarm_expected"));
check("CSV: an empty list gives only the header", candidatesToCsv([], ctx).trimEnd() === COLUMNS.join(","));
check("CSV: NaN is an empty cell, never the word NaN", !candidatesToCsv([{ ...linear, speedArcsecPerYear: NaN, rms: Infinity }], ctx).includes("NaN") && !candidatesToCsv([{ ...linear, rms: Infinity }], ctx).includes("Infinity"));

const json = JSON.parse(candidatesToJson([distant], ctx, { generated: "2026-11-07T12:00:00Z" }));
check("JSON: parses, names the tool, the field, the data and the permalink", json.tool.includes("SPHEREx Blink") && json.field.detector === "D5" && json.field.fov_arcmin === 30 && json.data.includes("SYNTHETIC") && json.permalink === ctx.permalink && json.generated === "2026-11-07T12:00:00Z");
check("JSON: warns that candidates are not discoveries", /not discoveries/.test(json.note));
check("JSON: the records equal the CSV's records", JSON.stringify(json.candidates) === JSON.stringify(candidateRecords([distant], ctx)));

check("file name says where and what: coordinates, detector, and _synthetic for invented data", exportFileName(ctx, "csv") === "spherex-blink_candidates_136.5000_16.6000_D5_synthetic.csv"
  && exportFileName({ ...ctx, isReal: true }, "json") === "spherex-blink_candidates_136.5000_16.6000_D5.json");
check("the data label is one of two fixed sentences", dataLabel(true) !== dataLabel(false) && /NOT SPHEREx/.test(dataLabel(false)));

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failed ? 1 : 0;
