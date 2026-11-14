// Tests for the Results page reading ONE file: features/resultsData.js (what the file is), resultsCharts.js (the numbers and charts drawn from it), resultsExplorer.js
// (the columns of the table) and the page's own ids.   Run: node scratch/test_results_file.mjs
// The claim under test: whatever file is loaded, every number, chart and table is computed from ITS rows; a number the file lacks is shown as missing, never invented.
import { readFileSync } from "node:fs";
import { parseCsv, csvToExport, readResultsFile, sourcesDataset, datasetStats } from "../frontend/js/features/resultsData.js";
import { dashboardCharts, kpiList, speedBins, shareBins, scatterSpec, skySpec, niceTicks, esc } from "../frontend/js/features/resultsCharts.js";
import { columnsFor, sortsFor } from "../frontend/js/features/resultsExplorer.js";
import { genericValidationHtml, GENERIC_CHARTS, mergeResults } from "../frontend/js/results.js";
import { selectRows } from "../frontend/js/features/candidateEvidence.js";
import { candidatesToCsv, candidatesToJson } from "../frontend/js/features/export.js";

let failed = 0;
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`); if (!ok) failed++; }
const read = (p) => readFileSync(new URL(`../frontend/${p}`, import.meta.url), "utf8");
const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

const ctx = { isReal: true, dataSource: "spherex_header", detector: "all", query: { ra: 269.4462, dec: 4.769, fov: 5 }, permalink: "http://localhost:8765/?ra=269.4462" };
const cands = [
  { label: "#1", nDet: 3, nFrames: 6, ra: 269.44, dec: 4.77, speedArcsecPerYear: 10.3, pmEastArcsecPerYear: -0.8, pmNorthArcsecPerYear: 10.3, significance: 12.1, falseAlarm: 1e-5, rms: 0.4, mjdRef: 61100, known: "Barnard's Star", snr: 20,
    frameIds: ["D2@60908.98", "D2@61114.1", "D2@61273.5"], fitPoints: [{ frame: 0, x: 1, y: 2 }, { frame: 1, x: 2, y: 3 }, { frame: 2, x: 3, y: 4 }] },
  { label: "#2", nDet: 4, nFrames: 6, ra: 269.45, dec: 4.78, speedArcsecPerYear: 2.1, significance: 5.2, falseAlarm: 0.3, rms: 0.9 },
  { label: "#3 =cmd", nDet: 6, nFrames: 6, ra: 269.43, dec: 4.76, speedArcsecPerYear: 0.4, significance: 3.1, falseAlarm: 4, rms: 1.1 },
];
const json = candidatesToJson(cands, ctx), csv = candidatesToCsv(cands, ctx);

// ---------------------------------------------------------------- CSV
{
  check("parseCsv: quotes, doubled quotes, commas and newlines inside a cell, CRLF and a byte-order mark", JSON.stringify(parseCsv('﻿a,b\r\n"x,1","he said ""hi"""\r\n"l1\nl2",3\r\n')) === JSON.stringify([["a", "b"], ["x,1", 'he said "hi"'], ["l1\nl2", "3"]]));
  check("parseCsv: the apostrophe that export.js puts before = + - @ is taken off, an ordinary apostrophe stays", parseCsv("a\n'=SUM(1)\n'plain\n").flat().join("|") === "a|=SUM(1)|'plain");
  const doc = csvToExport(csv, { lastModified: Date.UTC(2026, 10, 14) });
  check("csvToExport gives back the candidates and the field of the JSON export", doc.candidates.length === 3 && doc.field.ra_deg === 269.4462 && doc.field.fov_arcmin === 5 && doc.field.detector === "all" && doc.candidates[0].speed_arcsec_per_yr === 10.3);
  check("csvToExport: the name that began with = is read back without the guard", doc.candidates[2].candidate === "#3 =cmd");
  check("csvToExport refuses a CSV with a missing column, a text where a number must be, and rows that disagree about real or synthetic", /"data" is missing/.test(throws(() => csvToExport(csv.replace(/,data,/, ",datum,"))))
    && /not a number/.test(throws(() => csvToExport(csv.replace("10.3", "fast"), { lastModified: 1 }))) && /do not all say the same thing/.test(throws(() => csvToExport(csv.replace(/SPHEREx-format FITS data[^,]*/, "SYNTHETIC demo data (invented in the browser, NOT SPHEREx observations)").replace(/\r\n/, "\r\n"), { lastModified: 1 })) ?? ""));
}

// ---------------------------------------------------------------- reading each kind of file
const exp = readResultsFile(json, "list.json"), expCsv = readResultsFile(csv, "list.csv", { lastModified: Date.UTC(2026, 10, 14) });
const sourcesText = read("data/real_sources.json"), src = readResultsFile(sourcesText, "sources.json");
const typed = JSON.parse(read("data/real_results.json")), generated = JSON.parse(read("data/real_results_generated.json")), merged = mergeResults(typed, generated);
const val = readResultsFile(JSON.stringify(merged), "validation.json");
{
  check("a candidate JSON export is read as an export, row for row, and says what the data is", exp.format === "export" && exp.dataset.rows.length === 3 && /SPHEREx-format FITS/.test(exp.dataset.provenance) && exp.dataset.isReal === true);
  check("an export of a search over all detectors is accepted (the workspace writes detector \"all\" for it)", exp.dataset.rows.every((r) => r.detector === "all" || /^D[1-6]/.test(r.detector)) && exp.dataset.fields[0].detector === "all");
  check("the same candidates as a CSV give the same rows, and the CSV says it has no run time", expCsv.format === "export-csv" && expCsv.dataset.rows.length === 3 && expCsv.dataset.rows.map((r) => r.motion).join() === exp.dataset.rows.map((r) => r.motion).join() && /no run time/.test(expCsv.dataset.dateNote));
  check("rows carry the numbers the charts use (significance, chance lines, position, fit RMS, S/N)", exp.dataset.rows[0].sigma === 12.1 && exp.dataset.rows[0].chance === 1e-5 && exp.dataset.rows[0].ra === 269.44 && exp.dataset.rows[0].rms === 0.4 && exp.dataset.rows[0].snr === 20 && exp.dataset.rows[1].snr === null);
  check("the list of sources is read as 42 sources in 6 fields, each row with its field, class and numbers", src.format === "sources" && src.dataset.rows.length === 42 && src.dataset.fields.length === 6 && src.dataset.rows.every((r) => r.field && r.classLabel && Number.isFinite(r.ra)));
  check("per field, the rows of the dataset are the rows of the file", JSON.parse(sourcesText).fields.every((f) => src.dataset.rows.filter((r) => r.field === (f.rows[0].field ?? f.label)).length === f.rows.length));
  check("validation numbers are read as 6 runs, with the whole file kept for the validation charts", val.format === "validation" && val.dataset.rows.length === merged.movers.runs.length && Array.isArray(val.dataset.raw.movers.runs) && val.dataset.raw.jansky.length === merged.jansky.length);
  check("a run of a field the page does not know has no link to the workspace (and no crash)", (() => { const odd = JSON.parse(JSON.stringify(merged)); odd.movers.runs[0].id = "other-d2"; const d = readResultsFile(JSON.stringify(odd), "odd.json").dataset; return d.rows[0].link === "" && d.rows[1].link.includes("data=api"); })());
  check("each refusal says what is wrong: empty file, broken JSON, JSON of another kind, text, a list of sources without rows", /empty/.test(throws(() => readResultsFile("  ", "x"))) && /not valid JSON/.test(throws(() => readResultsFile("{oops", "x")))
    && /none of the files this page reads/.test(throws(() => readResultsFile('{"a":1}', "x"))) && /neither JSON nor a candidate CSV/.test(throws(() => readResultsFile("hello", "x"))) && /not a list of sources/.test(throws(() => readResultsFile('{"fields":[{"id":"a"}]}', "x"))));
  check("an export that was edited so a candidate is inconsistent is refused, not repaired (the strict check of the workspace stays)", /Candidate 1 has missing/.test(throws(() => readResultsFile(JSON.stringify({ ...JSON.parse(json), candidates: [{ ...JSON.parse(json).candidates[0], detections: -1 }] }), "x"))));
}

// ---------------------------------------------------------------- the numbers are counted from the rows
{
  const s = datasetStats(src.dataset), rows = src.dataset.rows;
  check("stats: the total, the rows with a motion, the rows with a match are counted from the rows", s.total === 42 && s.withMotion === rows.filter((r) => Number.isFinite(r.motion)).length && s.withMatch === rows.filter((r) => r.match).length);
  check("stats: the kinds add up to the total (every source has a class) and so do the fields", Object.values(s.kinds).reduce((a, b) => a + b, 0) === 42 && Object.values(s.fields).reduce((a, b) => a + b, 0) === 42);
  const none = datasetStats({ rows: [{ id: "1", label: "a", detector: "D2", motion: null, detections: 2, images: 0, samples: [] }] });
  check("a number the file does not have is null, never 0 (no motion, no share of images, no significance, no dates)", none.medianMotion === null && none.fastest === null && none.meanShare === null && none.maxSigma === null && none.firstMjd === null);
  const k = kpiList({ kind: "export", rows: [{ id: "1", label: "a", detector: "D2", motion: null, detections: 2, images: 0, samples: [] }] });
  check("kpiList leaves a missing number out instead of writing 0", k.length === 2 && k[0].value === "1" && k[1].label === "detector");
  check("kpiList: 'D2 + D6' is two detectors, once each; a long name is cut", (() => { const l = kpiList({ kind: "validation", rows: [{ id: "1", label: "x".repeat(80), detector: "D2 + D6", motion: 5, detections: 1, images: 1, samples: [] }, { id: "2", label: "b", detector: "D2", motion: 1, detections: 1, images: 1, samples: [] }] }); return l.find((x) => x.label === "detectors").value === "D2 + D6" && l.find((x) => /^fastest/.test(x.label)).label.length < 60; })());
  check("kpiList for the sources file says sources and sky fields", kpiList(src.dataset)[0].label === "sources in this file" && kpiList(src.dataset).some((x) => x.label === "sky fields" && x.value === "6"));
  const dates = kpiList(exp.dataset).find((x) => /dates of the images/.test(x.label));
  check("the dates of the images come from the fit frames (MJD 60908.98 is 2025-08-21)", dates && dates.value.startsWith("2025-08-21"), dates?.value);
}

// ---------------------------------------------------------------- the charts follow the file
{
  const allRows = (ds) => ds.rows;
  const bins = speedBins(src.dataset.rows);
  check("the speed bins add up to the rows that have a motion, and a value on an edge is counted once", bins.reduce((a, b) => a + b.count, 0) === src.dataset.rows.filter((r) => Number.isFinite(r.motion)).length && speedBins([{ motion: 1 }, { motion: 5 }, { motion: 0 }]).map((b) => b.count).join() === "1,1,1,0,0");
  check("the share bins: fewer than half / half to three quarters / up to all but one / every image", shareBins([{ detections: 1, images: 4 }, { detections: 2, images: 4 }, { detections: 3, images: 4 }, { detections: 4, images: 4 }, { detections: 2, images: 0 }]).map((b) => b.count).join() === "1,1,1,1");
  for (const [name, ds] of [["sources", src.dataset], ["export", exp.dataset], ["validation", val.dataset]]) {
    const charts = dashboardCharts(ds);
    check(`${name}: five charts, in the order speed, seen, scatter, split, sky`, charts.map((c) => c.id).join() === "speed,seen,scatter,split,sky");
    check(`${name}: every chart that has a picture also has its numbers as a real table, and the picture is hidden from screen readers`, charts.filter((c) => c.html).every((c) => c.html.includes("<table>") && c.html.includes("<caption>") && /aria-hidden="true"/.test(c.html)));
    check(`${name}: a chart without its numbers says so in words instead of drawing an empty frame`, charts.filter((c) => !c.html).every((c) => /\S{10}/.test(c.empty ?? "")));
  }
  const kinds = dashboardCharts(src.dataset).find((c) => c.id === "split").html;
  check("sources: the class chart has one bar per class and their numbers are the counts of the file", (kinds.match(/class="dbar-row"/g) || []).length === Object.keys(datasetStats(src.dataset).kinds).length
    && Object.entries(datasetStats(src.dataset).kinds).every(([k, n]) => kinds.includes(`>${esc(k)}</span>`) && new RegExp(`${n}</span></div>`).test(kinds)));
  const sc = scatterSpec(src.dataset.rows);
  check("sources: the scatter is support against S/N (the file has no significance), with every point inside its axes", sc && /S\/N|signal/.test(sc.title) && sc.spec.points.every((p) => p.x >= sc.spec.x.domain[0] && p.x <= sc.spec.x.domain[1] && p.y >= sc.spec.y.domain[0] && p.y <= sc.spec.y.domain[1]));
  const sc2 = scatterSpec(exp.dataset.rows);
  check("export: the scatter is motion against significance, and says nothing about rows that lack either", sc2 && /significance/i.test(sc2.title) && sc2.used === 3);
  check("a file with no significance and no S/N has no scatter, and the chart says what it needs", scatterSpec([{ id: "1", label: "a", motion: 1 }, { id: "2", label: "b", motion: 2 }]) === null && /signal-to-noise/.test(dashboardCharts({ kind: "export", rows: [{ id: "1", label: "a", detector: "D2", motion: 1, detections: 1, images: 1 }] }).find((c) => c.id === "scatter").empty));
  const sky = skySpec(src.dataset.rows);
  check("the sky map: right ascension runs east to the left, and the six fields give separate groups of points", sky && sky.spec.x.flip === true && sky.used === 42 && new Set(sky.spec.points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)).size >= 3);
  check("the sky map: a point further east (bigger RA) is drawn to the LEFT of one further west", (() => { const s = skySpec([{ id: "a", label: "a", ra: 10.2, dec: 5 }, { id: "b", label: "b", ra: 10.0, dec: 5 }]); const pos = (id) => { const html = dashboardCharts({ kind: "export", rows: [{ id: "a", label: "a", ra: 10.2, dec: 5, detector: "D2", detections: 1, images: 1 }, { id: "b", label: "b", ra: 10.0, dec: 5, detector: "D2", detections: 1, images: 1 }] }).find((c) => c.id === "sky").html; return Number(new RegExp(`data-id="${id}" style="--x:([0-9.]+)%`).exec(html)[1]); }; return s && pos("a") < pos("b"); })());
  check("the sky map: no position, no map (and it says so)", skySpec([{ id: "1", label: "a" }]) === null);
  check("a record's name with markup is escaped in the charts, the table and the tooltip", (() => { const html = dashboardCharts({ kind: "export", rows: [{ id: "<i>", label: "<b onmouseover=x>", ra: 1, dec: 1, motion: 3, sigma: 4, detector: "D2", detections: 1, images: 2 }, { id: "2", label: "ok", ra: 1.001, dec: 1.001, motion: 5, sigma: 6, detector: "D2", detections: 1, images: 2 }] }).map((c) => c.html ?? "").join(""); return !html.includes("<b onmouseover") && !html.includes('data-id="<i>"') && html.includes("&lt;b onmouseover=x&gt;"); })());
  check("niceTicks gives clean decimals", niceTicks(10, 10.4, 4).every((t) => String(t).length < 8) && niceTicks(0, 100, 4).join() === "0,20,40,60,80,100");
  check("a loaded file changes the charts: the sources file and an export draw different numbers", dashboardCharts(src.dataset)[0].html !== dashboardCharts(exp.dataset)[0].html && kpiList(src.dataset)[0].value !== kpiList(exp.dataset)[0].value);
}

// ---------------------------------------------------------------- the table follows the file
{
  check("columns: a column no row has a number for is not drawn (the export has no support, the sources have no significance)", !columnsFor(exp.dataset.rows).some((c) => c.key === "support") && !columnsFor(src.dataset.rows).some((c) => c.key === "sigma")
    && columnsFor(src.dataset.rows).some((c) => c.key === "support") && columnsFor(exp.dataset.rows).some((c) => c.key === "sigma"));
  check("columns: field and class appear only when the file has more than one", columnsFor(src.dataset.rows).some((c) => c.key === "field") && columnsFor(src.dataset.rows).some((c) => c.key === "kind") && !columnsFor(exp.dataset.rows).some((c) => c.key === "field"));
  check("sort orders: an order that needs a number the file lacks is not offered", !sortsFor(exp.dataset.rows).some((s) => s.value === "support") && sortsFor(src.dataset.rows).some((s) => s.value === "support") && sortsFor(exp.dataset.rows).some((s) => s.value === "sigma"));
  const byKind = selectRows(src.dataset.rows, "", "", "original", "Catalogued, moving");
  check("filter by class gives exactly the rows of that class (5 in the sources file), search finds a catalogue name, the sort puts rows without a number last", byKind.length === src.dataset.rows.filter((r) => r.classLabel === "Catalogued, moving").length
    && selectRows(src.dataset.rows, "gaia", "", "original").length > 0 && selectRows([{ id: "a", label: "a", motion: null }, { id: "b", label: "b", motion: 2 }, { id: "c", label: "c", motion: 9 }], "", "", "speed").map((r) => r.id).join("") === "cba");
  check("a candidate the old selector could find by field name or class is found now (search covers field and class)", selectRows(src.dataset.rows, "barnard", "", "original").length > 0);
}

// ---------------------------------------------------------------- validation file: charts only for what it has
{
  const html = genericValidationHtml(merged);
  check("a whole validation file gives all twelve charts, without the commentary of the archived page", GENERIC_CHARTS.every(([, title]) => html.includes(esc(title))) && !/not in this file/.test(html) && !/blind search failed/i.test(html));
  const partial = genericValidationHtml(generated);
  check("a file with only part of the numbers draws what it has and names what it lacks (no crash, nothing invented)", /Makemake[^<]*not in this file/.test(partial) && /Planet|planet/.test(partial) && partial.includes("Distance of the measured motion") && /Faintest fake star[^<]*not in this file/.test(partial));
  check("a single section missing in the middle does not stop the sections after it (each is tried on its own)", (() => { const d = JSON.parse(JSON.stringify(merged)); delete d.arosa; const h = genericValidationHtml(d); return /Flux at the positions[^<]*not in this file/.test(h) && h.includes("Distance of Makemake") && h.includes("Brightness of a distant planet"); })());
}

// ---------------------------------------------------------------- the page has every element the scripts look for
{
  const html = read("results.html"), ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const wanted = (file) => [...new Set([...read(`js/${file}`).matchAll(/(?:\$|el|getElementById)\("([A-Za-z0-9_-]+)"\)/g)].map((m) => m[1]))];
  for (const file of ["results.js", "features/resultsExplorer.js"]) {
    const missing = wanted(file).filter((id) => !ids.has(id));
    check(`${file}: every element id it looks up is in results.html`, missing.length === 0, missing.join(", "));
  }
  check("the page offers the file field for JSON and CSV, a drop zone, and both samples", /id="candidate-file"[^>]*accept="[^"]*\.json[^"]*\.csv/.test(html) && html.includes('id="drop-zone"') && html.includes('id="ex-archive"') && html.includes('id="ex-sources"'));
  check("the archived commentary is inside #validation-archive (hidden when another file is loaded) and nothing of it is outside", html.indexOf('id="validation-archive"') < html.indexOf('id="r1"') && html.indexOf('id="r12"') < html.indexOf("</main>") && html.indexOf('id="validation-archive"') > html.indexOf('id="candidate-explorer"'));
  check("the page always says what the data is (a badge that the script fills) and that nothing leaves the browser", html.includes('id="data-badge"') && /stays in this browser tab/.test(html));
}

console.log(failed ? `\n${failed} FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
