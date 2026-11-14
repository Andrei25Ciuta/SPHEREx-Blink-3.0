// Tests for the text analysis (features/textAnalysis.js, textAnalysisView.js): the images, the dots and the candidates as plain tables.   Run: node scratch/test_textanalysis.mjs
import { readFileSync } from "node:fs";
import { frameRows, sourceRows, candidateRows, provenanceLines, analysisSummary, toCsv, FRAME_COLUMNS, SOURCE_COLUMNS, CANDIDATE_COLUMNS, EDGE_MARGIN_PX, SOURCE_LIMIT_PER_FRAME } from "../frontend/js/features/textAnalysis.js";
import { canvasToSky } from "../frontend/js/geometry.js";
import { formatRA } from "../frontend/js/coords.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const fr = (mjd, det = "D2", extra = {}) => ({ mjd, detector: det, dateISO: new Date((mjd - 40587) * 86400000).toISOString().slice(0, 19) + "Z", wavelengthMinUm: 1.1, wavelengthMaxUm: 1.6, flags: { fractionFlagged: 0.002 }, ...extra });

// ---------------------------------------------------------------- the images
{
  const rows = frameRows([fr(61000.5), fr(60900.25, "D6", { flags: { fractionFlagged: 0.034 } }), fr(60900.75, "D2", { flags: null, wavelengthMinUm: undefined })]);
  check("images: in time order whatever the order given, numbered from 1, with date and time", rows.map((r) => r.number).join() === "1,2,3" && rows[0].mjd === 60900.25 && rows[0].date === "2025-08-13" && rows[0].time === "06:00" && rows[2].mjd === 61000.5);
  check("images: survey passes are counted by the rule of Find movers (a gap of 30 days or more starts a new pass)", rows.map((r) => r.pass).join() === "1,1,2");
  check("images: the share of flagged pixels in percent, a warning above 1 %, and 'flags not given' is said", rows[0].flaggedPercent === 3.4 && /more than 1 %/.test(rows[0].note) && rows[2].flaggedPercent === 0.2 && rows[2].note === "" && rows[1].flaggedPercent === null && rows[1].note === "flags not given");
  check("images: an unknown wavelength is said, a known one is a range in micrometres", rows[1].wavelength === "unknown" && rows[0].wavelength === "1.10–1.60");
}

// ---------------------------------------------------------------- the dots
const n = 49, geo = { ra: 269.4462, dec: 4.769, n, scaleArcsec: 6.14 };
{
  const f = fr(60900.5);
  const sources = [{ x: 10.5, y: 10.5, snr: 8.04, sigmaPx: 0.0812 }, { x: 24.5, y: 24.5, snr: 55.55, sigmaPx: 0.0123 }, { x: 1.5, y: 30, snr: 12, sigmaPx: 0.2 }, { x: 47.9, y: 40, snr: 9, sigmaPx: 0.1 }];
  const image = new Float32Array(n * n).fill(1), mask = new Uint8Array(n * n);
  for (let dy = -2; dy <= 0; dy++) for (let dx = -2; dx <= 2; dx++) mask[(10 + dy) * n + 10 + dx] = 1;            // 15 bad pixels around the dot at (10.5, 10.5)
  const before = JSON.stringify(sources);
  const { rows, left } = sourceRows([{ frame: f, sources, image, mask }], n, geo);
  check("dots: brightest first with their rank, the input list is untouched, nothing is left out below the cap", rows.map((r) => r.rank).join() === "1,2,3,4" && rows[0].x === 24.5 && rows[3].x === 10.5 && JSON.stringify(sources) === before && left === 0, rows.map((r) => r.snr).join());
  const mid = rows[0], sky = canvasToSky(24.5 / n, 24.5 / n, geo);
  check("dots: the position of the middle pixel is the centre of the field (RA, Dec in degrees and in sexagesimal text)", near(mid.ra, sky.ra, 1e-9) && near(mid.dec, sky.dec, 1e-9) && near(mid.ra, 269.4462, 0.0002) && near(mid.dec, 4.769, 0.0002) && mid.raText === formatRA(mid.ra), `${mid.raText} ${mid.decText}`);
  check("dots: the error of the position is in arcseconds (pixels times the scale), per axis", rows[0].sigmaArcsec === 0.08 && rows[3].sigmaArcsec === 0.5, `${rows[0].sigmaArcsec} ${rows[3].sigmaArcsec}`);
  check("dots: a dot near the edge is warned, one with a flagged core is warned, a clean one has no warning", /near the edge/.test(rows[1].flags) && /near the edge/.test(rows[2].flags) && /flagged core/.test(rows[3].flags) && rows[0].flags === "", rows.map((r) => r.flags.slice(0, 12)).join(" | "));
  check("dots: the edge margin and the cap are the documented ones", EDGE_MARGIN_PX === 3 && SOURCE_LIMIT_PER_FRAME === 60);
  const many = Array.from({ length: 75 }, (_, i) => ({ x: 5 + (i % 40), y: 5 + (Math.floor(i / 2) % 38), snr: 100 - i, sigmaPx: 0.1 }));
  const capped = sourceRows([{ frame: f, sources: many }, { frame: fr(60901.5), sources: many.slice(0, 3) }], n, geo);
  check("dots: a crowded image is capped at 60 rows (the brightest), the number left out is counted, and every row says which image it is from", capped.rows.filter((r) => r.frame === 1).length === 60 && capped.left === 15 && capped.rows.filter((r) => r.frame === 2).length === 3 && capped.rows[59].snr === 41 && capped.rows[0].id === "D2@60900.5");
}

// ---------------------------------------------------------------- the candidates
{
  const base = { nDet: 15, nFrames: 17, significance: 20.4, falseAlarm: 5e-19, speedArcsecPerYear: 10.123, compass: "N", support: { supported: 17, measurable: 17 } };
  const rows = candidateRows([{ ...base, label: "#1", known: "Barnard's star" }, { ...base, label: "#2" }, { ...base, label: "#3", distant: { rangeText: "595–607 AU" }, distanceAU: 601.2 }, { ...base, label: "#4", support: null, falseAlarm: NaN, asteroids: [{ name: "2005 LF3" }] }]);
  check("candidates: a known object says it is known and not a discovery; an unidentified one says it is a lead, never a discovery", /known object, not a discovery/.test(rows[0].status) && /Barnard's star/.test(rows[0].status) && /a lead, never a discovery/.test(rows[1].status));
  check("candidates: a Planet X candidate must be compared with the chance candidates of an empty field; an asteroid near the path is said", /compare it with the chance candidates of an empty field/.test(rows[2].status) && rows[2].distance === "about 601 AU (595–607 AU)" && /asteroid \(2005 LF3\)/.test(rows[3].status));
  check("candidates: the motion, the images, the significance, the chance lines and the path support are plain values; a missing one is not invented", rows[0].motion === "10.1″/yr toward N" && rows[0].images === "15 of 17" && rows[0].significance === 20 && rows[0].chance === "5.0e-19" && rows[0].support === "17 of 17" && rows[3].support === "not measured" && rows[3].chance === null);
  check("candidates: no candidates is an empty list, not an error", candidateRows([]).length === 0 && candidateRows(undefined).length === 0);
}

// ---------------------------------------------------------------- what the data are, the summary, the file
{
  const frames = [fr(60900.5), fr(61000.5)], query = { ra: 269.4462, dec: 4.769, fov: 5 }, when = new Date("2026-11-10T01:30:00Z");
  const real = provenanceLines({ isReal: true, query, detector: "D2", frames, scaleArcsec: 6.1387, unit: "MJy/sr", when }), synth = provenanceLines({ isReal: false, query, detector: "D5", frames, scaleArcsec: 6, when });
  check("what the data are: real data say they come from the backend, with the dates, the pixel scale and the unit", /^Data: real SPHEREx images/.test(real[0]) && real[2].includes("2025-08-13 to 2025-11-21") && real[2].includes("6.14″") && real[2].includes("MJy/sr") && /world coordinate system the backend read/.test(real[3]) && /2026-11-10 01:30 UTC/.test(real[4]), real[2]);
  check("what the data are: synthetic data say in capitals that they are NOT observations, in the first line", /^Data: SYNTHETIC demo images/.test(synth[0]) && /NOT observations/.test(synth[0]) && /simulated sky/.test(synth[3]));
  check("the summary: counts with the right plural, what was left out, and what to do when there are no candidates", analysisSummary({ frames: 1, sources: 1, left: 0, candidates: 1 }) === "Text analysis ready: 1 image, 1 dot listed, 1 candidate."
    && /2 images, 130 dots listed \(15 fainter dots left out of the table\), 0 candidates \(run Find movers/.test(analysisSummary({ frames: 2, sources: 130, left: 15, candidates: 0 })));
  const csv = toCsv([{ number: 1, date: "2025-08-13", time: "06:00", detector: "D2", pass: 1, wavelength: "1.10–1.60", flaggedPercent: null, note: 'a "quoted", note\nsecond line' }], FRAME_COLUMNS, ["line one", "line two"]);
  const lines = csv.split("\n");
  check("CSV: the provenance first as # comment lines, then the header, then the row; commas, quotes and new lines are escaped; an empty value is empty", lines[0] === "# line one" && lines[1] === "# line two" && lines[2].startsWith("Image,Date (UTC),Time (UTC),Detector,Survey pass,Wavelength (µm)") && csv.includes(',,"a ""quoted"", note\nsecond line"') && csv.endsWith("\n"));
  check("CSV: every column of every table has a key and a header", [FRAME_COLUMNS, SOURCE_COLUMNS, CANDIDATE_COLUMNS].every((c) => c.length >= 8 && c.every(([k, h]) => k && h)));
}

// ---------------------------------------------------------------- the page
{
  const HTML = read("../frontend/index.html"), MAIN = read("../frontend/js/main.js"), VIEW = read("../frontend/js/features/textAnalysisView.js").replace(/\/\/.*$/gm, "");
  const ids = ["ta-build-btn", "ta-error", "ta-status", "ta-out", "ta-prov", "ta-prov-title", "ta-frames", "ta-frame-filter", "ta-sources", "ta-sources-note", "ta-cands", "ta-cands-note", "ta-frames-csv", "ta-sources-csv", "ta-cands-csv"];
  const section = HTML.slice(HTML.indexOf('id="text-analysis"'), HTML.indexOf("</section>", HTML.indexOf('id="text-analysis"')));
  check("page: every element the text analysis needs is in index.html exactly once, in its own section with a heading", ids.every((id) => (HTML.match(new RegExp(`id="${id}"`, "g")) || []).length === 1) && /<h2 id="ta-title">Text analysis/.test(HTML) && /aria-labelledby="ta-title"/.test(HTML));
  check("page: the status is a polite live region, the error an alert, the result heading can take focus; the section has no canvas, image or SVG (nothing that needs sight)",
    /id="ta-status" role="status" aria-live="polite"/.test(HTML) && /id="ta-error" role="alert"/.test(HTML) && /id="ta-prov-title" tabindex="-1"/.test(HTML) && !/<canvas|<img|<svg|<video/i.test(section));
  check("page: the tables have a caption, column headers with scope=col and a row header; the focus goes to the result heading; a failure says so and shows nothing in its place",
    /el\("caption"/.test(VIEW) && /scope: "col"/.test(VIEW) && /scope: "row"/.test(VIEW) && /provTitle\.focus\(\)/.test(VIEW) && /Nothing is shown in its place/.test(VIEW) && /els\.error\.textContent/.test(VIEW));
  check("page: main.js wires it with the images on screen, the pixels the searches use (detectionPixels), the candidates on screen and the CSV download, and refreshes its candidates when the list changes",
    /textAnalysis = setupTextAnalysis\(\{/.test(MAIN) && /getPixels: \(frames\) => detectionPixels\(frames\)/.test(MAIN) && /getCandidates: \(\) => movers/.test(MAIN) && /download: downloadText/.test(MAIN) && /textAnalysis\?\.refreshCandidates\(\)/.test(MAIN));
  check("page: the CSV files are saved with the BOM Excel needs and the provenance of the data", /download\(BOM \+ toCsv\(rows\(\), columns, built\.provenance\)/.test(VIEW) && /const BOM = String\.fromCharCode\(0xfeff\)/.test(VIEW));
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failed ? 1 : 0;
