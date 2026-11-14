// Tests for the real-data results page: frontend/js/results.js (pure helpers + chart builders), frontend/data/real_results.json,
// frontend/results.html.  Run: node scratch/test_results.mjs
import { niceTicks, place, assignLanes, fmtChance, fmtPow10, fmtBy, getPath, fixed, esc, buildCharts, barsHtml, dotsHtml, tableHtml, sourceRows, sourcesSummary, sourcesSentence, sourcesVerdict, originHtml, fmtDate, mergeResults } from"../frontend/js/results.js";
import { missingProvenance } from "../frontend/js/features/provenance.js";
import { VERSION as DISCOVERY_VERSION, SETTINGS as DISCOVERY_SETTINGS, CLASSES } from "../frontend/js/features/discovery.js";
import { readFileSync, statSync, existsSync } from "node:fs";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const JSON_PATH = new URL("../frontend/data/real_results.json", import.meta.url);
const HTML = readFileSync(new URL("../frontend/results.html", import.meta.url), "utf8");
const DOC = readFileSync(new URL("../docs/VALIDATION.md", import.meta.url), "utf8");
const GEN_PATH = new URL("../frontend/data/real_results_generated.json", import.meta.url);
const typedData = JSON.parse(readFileSync(JSON_PATH, "utf8")), generatedData = JSON.parse(readFileSync(GEN_PATH, "utf8"));
const data = mergeResults(typedData, generatedData);          // what the page shows: the typed numbers (sections 4-10) with the generated ones (sections 1-3) laid over them

// ---- helpers
check("ticks of 0-1 are 0, .2 ... 1", same(niceTicks(0, 1, 5), [0, 0.2, 0.4, 0.6, 0.8, 1]), JSON.stringify(niceTicks(0, 1, 5)));
check("ticks of -2..10 include 0 and step 2", same(niceTicks(-2, 10, 6), [-2, 0, 2, 4, 6, 8, 10]));
check("ticks of 52.55-52.70 are clean decimals (no 52.550000000001)", same(niceTicks(52.55, 52.7, 3), [52.55, 52.6, 52.65, 52.7]), JSON.stringify(niceTicks(52.55, 52.7, 3)));
check("place: linear middle, ends and off-scale", place(0.5, [0, 1]).pct === 50 && place(0, [0, 1]).pct === 0 && place(1, [0, 1]).pct === 100
  && place(1.5, [0, 1]).off === 1 && place(1.5, [0, 1]).pct === 100 && place(-1, [0, 1]).off === -1 && place(-1, [0, 1]).pct === 0);
check("place: log scale", near(place(1, [1e-32, 1e3], true).pct, 32 / 35 * 100, 1e-9) && near(place(1e-16, [1e-32, 1], true).pct, 50, 1e-9));
{
  const spread = assignLanes([0.03, 0.03, 0.031, 0.5], [-0.5, 1], 2.4);
  check("points on top of each other go to different lanes, a far one reuses lane 0", spread.lanes[0] !== spread.lanes[1] && spread.lanes[3] === 0 && spread.count >= 2, JSON.stringify(spread));
  const far = assignLanes([0, 0.5, 1], [0, 1], 2.4);
  check("points far apart share one lane", far.count === 1 && same(far.lanes, [0, 0, 0]));
  const crowd = assignLanes(Array(40).fill(0.2), [0, 1], 2.4, false, 4);
  check("never more lanes than the cap", crowd.count <= 4 && Math.max(...crowd.lanes) <= 3, JSON.stringify(crowd.count));
}
check("chance numbers in scientific notation", fmtChance(2e-21) === "2×10⁻²¹" && fmtChance(6e-5) === "6×10⁻⁵" && fmtChance(1e-4) === "1×10⁻⁴" && fmtChance(2e-30) === "2×10⁻³⁰");
check("chance numbers from 0.1 up are plain", fmtChance(17) === "17" && fmtChance(0.5) === "0.5");
check("power-of-ten axis labels", fmtPow10(-20) === "10⁻²⁰" && fmtPow10(2) === "10²" && fmtPow10(0) === "1");
check("getPath follows objects and array indexes, undefined when missing", getPath(data, "movers.runs.2.difference") === data.movers.runs[2].difference && getPath(data, "movers.nope.x") === undefined);
check("fmtBy formats", fmtBy("fixed:2", 0.2) === "0.20" && fmtBy("ofn", [6, 6]) === "6 of 6" && fmtBy("chance", 2e-21) === "2×10⁻²¹" && fmtBy("", 563) === "563" && fmtBy("fixed:2", undefined) === "?");
check("text is escaped", esc('<b a="1">&\'') === "&lt;b a=&quot;1&quot;&gt;&amp;&#39;" && fixed(null) === "–");

// ---- the numbers are consistent with themselves
{
  const bad = data.movers.runs.filter((r) => !near(Math.hypot(r.measured[0] - r.catalogue[0], r.measured[1] - r.catalogue[1]), r.difference, 0.02));
  check("each stated difference is the distance between its measured and catalogue motion", bad.length === 0, bad.map((r) => r.id).join(", "));
  const diffs = data.movers.runs.map((r) => r.difference);
  check("the headline range is the min and max of the runs, and all runs recovered", data.summary.minDifference === Math.min(...diffs) && data.summary.maxDifference === Math.max(...diffs)
    && same(data.summary.recovered, [data.movers.runs.length, data.movers.runs.length])
    && data.movers.runs.every((r) => r.seen[0] >= Math.ceil(0.6 * r.seen[1]) && r.seen[0] <= r.seen[1]));      // seen in at least the share of images the search asks for (minDetectionFraction 0.6): not "all" any more, a real run saw 15 of 17
  check("kept lines are below 1 chance line, the false lines above it", data.movers.runs.every((r) => r.chanceLines < 1) && data.movers.originalRule.realChanceLines < 1 && data.movers.originalRule.falseChanceLines.every((v) => v > 1));
  check("Jansky: the median lies inside its 16th-84th percentile", data.jansky.every((j) => j.p16 <= j.median && j.median <= j.p84));
  check("Arosa: the speed is the distance over the time", near(data.arosa.movedArcsec / data.arosa.hours, data.arosa.arcsecPerHour, 0.15));
  check("calibration: the 90 % limit is above the 50 % one, shares are percentages, the original rule is never better than the one now used",
    data.calibration.limits.every((l) => l.flux90 === null || l.flux50 < l.flux90) && data.calibration.emptySky.fields.every((f) => f.defaultRule >= 0 && f.originalRule <= 100 && f.defaultRule <= f.originalRule));
  { const t = data.makemake.fairTest, lo = t.loosenedOptions;
    check("fair test: nothing with the default options, the body is 1 candidate among many, as many as an empty field gives, and its distance is inside the ephemeris range plus its error",
      t.defaultOptions.candidates === 0 && lo.foundTheBody === 1 && lo.candidates >= t.emptyFieldCandidates[0] && lo.candidates <= t.emptyFieldCandidates[1]
      && lo.bodyLowAU <= lo.bodyAU && lo.bodyAU <= lo.bodyHighAU && lo.bodyLowAU <= t.truthAU[1] && lo.bodyHighAU >= t.truthAU[0] && t.bodyDetectedIn <= t.imageCount); }
  check("Planet X: a planet is fainter the farther it is, and the one-image limit is a range", data.planetX.planets.every((p) => p.v300 < p.v500 && p.v500 < p.v1000) && data.planetX.oneImageV[0] < data.planetX.oneImageV[1]);
  check("Makemake: the fit range contains the fit, and the ephemeris is inside it",
    data.makemake.fitLowAU <= data.makemake.fitAU && data.makemake.fitAU <= data.makemake.fitHighAU && data.makemake.fitLowAU <= data.makemake.horizonsAU && data.makemake.horizonsAU <= data.makemake.fitHighAU);
  check("the blind search is reported as failed (0 of the candidates is the body)", data.makemake.blind.foundTheBody === 0 && data.makemake.blind.candidates > 0);

  const med = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  for (const det of ["D6", "D2"]) {
    const w = data.wise0855[det], m = med(w.controls), mad = 1.4826 * med(w.controls.map((c) => Math.abs(c - m)));
    check(`WISE 0855 ${det}: 16 controls; median, robust scatter, "times the scatter", "brighter than" and the nominal sigma agree with the control values`,
      w.controls.length === 16 && near(m, w.controlMedian, 0.01) && near(mad, w.controlRobustScatter, 0.01) && near((w.stack - w.controlMedian) / w.controlRobustScatter, w.timesRobust, 0.15)
      && w.controls.filter((c) => c < w.stack).length === w.brighterThan[0] && w.brighterThan[1] === 16 && near(w.stack / w.err, w.nominalSigma, 0.15),
      `median ${m.toFixed(3)} (${w.controlMedian}), robust ${mad.toFixed(3)} (${w.controlRobustScatter})`);
  }
  check("WISE 0855 D6: two of the six images are flagged and left out", data.wise0855.d6Images.length === 6 && data.wise0855.d6Images.filter((r) => r.flagged).length === 2 && same(data.wise0855.D6.unflagged, [4, 6]));
}

// ---- nothing but derived numbers
{
  // keys and string values are walked (the free-text "about" sentence says "no pixels" in words, which is fine)
  const keys = [], strings = [];
  (function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { keys.push(k); walk(v); } else if (typeof o === "string") strings.push(o); })(data);
  check("no image, data URL, base64, file name or pixel field in the data file",
    !keys.some((k) => /^(dataUrl|maskUrl|pixels?|image|images|fits|file|path)$/i.test(k)) && !strings.some((s) => /^data:|base64|\.fits\b|\.png\b|\.jpe?g\b/i.test(s)));
  check("the data files are small", statSync(JSON_PATH).size < 12_000 && statSync(GEN_PATH).size < 9_000, `${statSync(JSON_PATH).size} + ${statSync(GEN_PATH).size} bytes`);
  const longest = (o) => (Array.isArray(o) ? Math.max(o.length, ...o.map(longest)) : o && typeof o === "object" ? Math.max(0, ...Object.values(o).map(longest)) : 0);
  check("no array longer than 20 numbers (no light-curve or pixel dumps)", longest(data) <= 20, String(longest(data)));
  check("the page has no observation imagery", !/<img|<video|data:image/i.test(HTML));
}

// ---- it still says what VALIDATION.md says
{
  const miss = [];
  const need = (s) => { if (!DOC.includes(s)) miss.push(s); };
  for (const r of data.movers.runs) { need(`**${r.difference.toFixed(2)} ″/yr**`); need(r.chanceLines.toExponential(0)); }
  for (const j of data.jansky) need(`**${j.median.toFixed(3)}**`);
  need(data.movers.barnardD2Mask.before.toFixed(2)); need(data.movers.barnardD2Mask.after.toFixed(2));
  for (const w of [data.wise0855.D6, data.wise0855.D2]) need(`${w.stack.toFixed(3)} ± ${w.err.toFixed(3)} mJy`);
  need(`${data.makemake.fitAU}`); need(`${data.makemake.horizonsAU}`); need(`${data.arosa.movedArcsec}″ in ${data.arosa.hours} hours`);
  for (const r of data.arosa.rows) if (r.fluxMilliJy !== null) need(`${r.fluxMilliJy.toFixed(2)} ± ${r.err.toFixed(2)} mJy`);
  need("2 477 413"); need("60 files, 279 MB");
  for (const l of data.calibration.limits) need(`${l.flux50} mJy`);
  need(`${data.makemake.fairTest.loosenedOptions.bodyAU} AU`); need(`${data.makemake.fairTest.emptyFieldCandidates[0]}-${data.makemake.fairTest.emptyFieldCandidates[1]} chance candidates`);
  for (const f of data.calibration.emptySky.fields) { if (f.defaultRule >= 1) need(`${f.defaultRule.toFixed(1)} %`); if (f.originalRule >= 90) need(`${f.originalRule.toFixed(1)} %`.replace("100.0 %", "100 %")); }
  for (const p of data.planetX.planets) need(`| ${p.v300.toFixed(1)} | ${p.v500.toFixed(1)} | ${p.v1000.toFixed(1)} |`);
  check("every headline number of the data file also stands in docs/VALIDATION.md", miss.length === 0, miss.join(" | "));
}

// ---- the charts
const charts = buildCharts(data);
const wanted = [...HTML.matchAll(/data-chart="([^"]+)"/g)].map((m) => m[1]);
check("every chart the page asks for is built, and is not empty", wanted.length >= 8 && wanted.every((id) => typeof charts[id] === "string" && charts[id].length > 200), wanted.join(", "));
check("the movers chart has one bar per run, with its value", (charts.moversDifference.match(/class="rbar /g) || []).length === 6 && charts.moversDifference.includes(`${data.summary.minDifference.toFixed(2)}″/yr`) && charts.moversDifference.includes(`${data.summary.maxDifference.toFixed(2)}″/yr`));
check("the chance-line chart marks the three false lines apart (bad diamonds) and writes the chance number of the first run", (charts.chanceLines.match(/rpt diamond bad/g) || []).length === 3 && charts.chanceLines.includes(fmtChance(data.movers.runs[0].chanceLines)) && charts.chanceLines.includes('class="rref"'));
check("the Barnard chart shows both bars", charts.barnardMask.includes(`${data.movers.barnardD2Mask.before.toFixed(2)}″/yr`) && charts.barnardMask.includes(`${data.movers.barnardD2Mask.after.toFixed(2)}″/yr`));
check("the Jansky chart has a range and a reference line per row", (charts.jansky.match(/class="rrange"/g) || []).length === 4 && (charts.jansky.match(/class="rref"/g) || []).length === 4);
check("the Arosa chart has whiskers, and says the fourth position is not in the cutout", (charts.arosa.match(/class="rwhisker"/g) || []).length === 3 && charts.arosa.includes("not in this cutout"));
check("the WISE D6 chart puts the +4.81 outlier at the edge with its label, D2 has no outlier", (charts.wiseD6.match(/off offR/g) || []).length === 1 && charts.wiseD6.includes("+4.81") && !charts.wiseD2.includes("off offR"));
check("every chart is followed by a real table", wanted.every((id) => charts[id].includes("<table>") && charts[id].includes("<caption>")));
check("charts that draw bars or dots are hidden from screen readers (the table says it)", ["moversDifference", "chanceLines", "jansky", "arosa", "makemake"].every((id) => charts[id].includes('class="rplot" aria-hidden="true"')));
{
  const html = barsHtml([{ label: "<x>", value: 2, text: "2" }], { domain: [0, 2], ticks: [{ v: 0, text: "0" }, { v: 2, text: "2" }] }) + dotsHtml([{ label: "a&b", points: [{ v: 5, shape: "circle", text: "<5>" }] }], { domain: [0, 1], ticks: [] }) + tableHtml("c<", ["h<"], [["r<", "d<"]]);
  check("labels and values are escaped in every builder", !html.includes("<x>") && !html.includes("<5>") && !html.includes("c<") && html.includes("&lt;x&gt;") && html.includes("&lt;5&gt;"));
  check("a long bar puts its value inside it", html.includes('class="rval inside"'));
}

// ---- the page
{
  const paths = [...HTML.matchAll(/data-n="([^"]+)"(?:\s+data-fmt="([^"]+)")?/g)].map((m) => ({ path: m[1], fmt: m[2] }));
  const unresolved = paths.filter((p) => getPath(data, p.path) === undefined).map((p) => p.path);
  check(`all ${paths.length} numbers the page fills in exist in the data file`, paths.length > 25 && unresolved.length === 0, unresolved.join(", "));
  const known = ["fixed", "int", "chance", "pct", "signed", "thousands", "ofn", "date"];
  check("every data-fmt is one fmtBy understands", paths.every((p) => !p.fmt || known.includes(p.fmt.split(":")[0])));
  const ids = [...HTML.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  check("ids are unique", new Set(ids).size === ids.length);
  const missingAnchors = [...HTML.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]).filter((id) => !ids.includes(id));
  const missingLabels = [...HTML.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]).filter((id) => !ids.includes(id));
  check("every #anchor and aria-labelledby points at an id", missingAnchors.length === 0 && missingLabels.length === 0, [...missingAnchors, ...missingLabels].join(", "));
  check("one h1, a lang, a viewport, a skip link and a way back to the app", (HTML.match(/<h1[ >]/g) || []).length === 1 && /<html lang="en"[ >]/.test(HTML) && /name="viewport"/.test(HTML) && HTML.includes('class="skip-link"') && HTML.includes('href="index.html#workspace"'));
  check("the page says the images are not published, shows the failure of the first blind Planet X search and the limits of the fair one",
    /No SPHEREx image or pixel is published/.test(HTML) && /blind search failed/i.test(HTML) && /A fair test/.test(HTML) && /default options the search found nothing/.test(HTML) && /not yet a result/.test(HTML));
  check("the status line and the module are there", HTML.includes('id="results-status"') && HTML.includes('src="js/results.js"') && HTML.includes("data-limits"));
}

// ================================================================= the sources of the six real fields (section 11): data/real_sources.json
{
  const file = JSON.parse(readFileSync(new URL("../frontend/data/real_sources.json", import.meta.url), "utf8"));
  const rows = sourceRows(file);
  check("sources file: six fields, 42 sources, a command to remake it and a date", file.fields.length === 6 && rows.length === 42 && /make_results_sources\.mjs/.test(file.command) && /^\d{4}-\d\d-\d\d$/.test(file.measuredOn));
  check("sources file: each field's total is its number of rows and its counts add up to it, class by class", file.fields.every((f) => f.total === f.rows.length
    && Object.values(f.counts).reduce((a, b) => a + b, 0) === f.total && Object.entries(f.counts).every(([k, v]) => f.rows.filter((r) => r.class === k).length === v)));
  check("sources file: every row has a known class, a headline, a position, a support score and a unique id in its field", file.fields.every((f) => new Set(f.rows.map((r) => r.id)).size === f.rows.length)
    && rows.every((r) => r.class in CLASSES && r.headline && Number.isFinite(r.ra) && Number.isFinite(r.dec) && Number.isFinite(r.support) && Array.isArray(r.tags)));
  const ALLOWED = new Set(["id", "class", "classLabel", "headline", "ra", "dec", "motion", "nDet", "nFrames", "passes", "snr", "support", "fluxMilliJy", "tags", "match", "field"]);
  check("sources file: only derived numbers, no pixel or image (a fixed list of keys, every value a number, text, null or a short list of words)", rows.every((r) => Object.keys(r).every((k) => ALLOWED.has(k))
    && Object.values(r).every((v) => v === null || typeof v === "number" || typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string")))));
  check("sources file: it is small (no data hiding in it) and carries no address of this computer", statSync(new URL("../frontend/data/real_sources.json", import.meta.url)).size < 100_000 && !/localhost|127\.0\.0\.1|C:\\\\Users/i.test(JSON.stringify(file)));
  check("sources file: every field has a COMPLETE provenance (algorithm version, time of the run, images, field, settings, data)", file.fields.every((f) => missingProvenance(f.provenance).length === 0 && f.provenance.analysis === "find-everything" && f.provenance.isReal === true));
  check("sources file: it was made by the algorithm and settings the code has NOW (a stale file fails here: remake it when VERSION or a threshold changes)",
    file.fields.every((f) => f.provenance.algorithm.version === DISCOVERY_VERSION && JSON.stringify(f.provenance.settings) === JSON.stringify(DISCOVERY_SETTINGS)), `file ${file.fields[0].provenance.algorithm.version}, code ${DISCOVERY_VERSION}`);
  check("sources file: all four catalogues answered in every field, with no problem noted", file.fields.every((f) => ["simbad", "gaia", "2mass", "allwise"].every((c) => f.provenance.catalogues.used.includes(c)) && f.provenance.catalogues.problems.length === 0));
  // the same numbers as the table of docs/VALIDATION.md §14 (the doc's table was written by hand from the first run; this file is a second run)
  const table = [...DOC.matchAll(/^\| ([^|]+?) \| (\d+) \| [\d-]+ \| (\d+) \| (\d+) \((\d+)\) \| \*\*(\d+)\*\* \|$/gm)].map((m) => ({ name: m[1], images: +m[2], sources: +m[3], known: +m[4], moving: +m[5], unexplained: +m[6] }));
  const labelOf = (name) => name.replace(/'s Star/, "'s Star field").replace(/^(Epsilon Indi B|WISE 0855) (D\d)$/, "$1 field · $2").replace(/^(Barnard's Star field) (D\d)$/, "$1 · $2");
  check("sources file agrees with the table of VALIDATION.md §14, field by field: images, sources, known ones, moving ones, none unexplained",
    table.length === 6 && table.every((t) => { const f = file.fields.find((x) => x.label === labelOf(t.name)); return f && f.provenance.input.images.count === t.images && f.total === t.sources
      && f.rows.filter((r) => ["catalogued", "catalogued-moving", "solar-system"].includes(r.class)).length === t.known && f.rows.filter((r) => r.class === "catalogued-moving").length === t.moving && t.unexplained === 0 && f.total - t.known === 0; }),
    `${table.length} table rows: ${table.map((t) => t.name).join("; ")}`);

  const s = sourcesSummary(file);
  check("summary: counted from the rows, and the sentence and verdict follow from it", s.total === 42 && s.fields === 6 && s.known === 42 && s.needChecking === 0 && /^42 sources in 6 fields: 42 in a catalogue or a known Solar System body; none is left unexplained\.$/.test(sourcesSentence(s))
    && /found nothing new, and this test cannot say whether it would/.test(sourcesVerdict(s)));
  const fake = sourcesSummary({ fields: [{ label: "F", rows: [{ id: "a", class: "unknown" }, { id: "b", class: "unknown-weak" }, { id: "c", class: "catalogued" }] }] });
  check("summary: sources left over are said to be leads, never claimed as found", /^3 sources in 1 field: 1 in a catalogue/.test(sourcesSentence(fake)) && /2 not explained \(1 need checking, 1 weakly supported/.test(sourcesSentence(fake)) && /leads to check, not discoveries/.test(sourcesVerdict(fake)) && !/found nothing new/.test(sourcesVerdict(fake)));
  check("one field's rows, or all of them; each row says which field", sourceRows(file, file.fields[0].id).length === file.fields[0].total && sourceRows(file, "all").length === 42 && sourceRows(file).every((r) => r.field && r.field.includes("field")) && sourceRows(file, "nope").length === 0);

  check("page: the section for the sources, its controls and its status line are in results.html; the sections are numbered 11 and 12", ["sources-section", "sources-summary", "sources-verdict", "sources-field", "sources-explorer", "sources-detail", "sources-provenance", "sources-command", "sources-date", "sources-status"].every((id) => HTML.includes(`id="${id}"`))
    && /<h2 id="r11">11\./.test(HTML) && /<h2 id="r12">12\./.test(HTML) && /id="sources-section"[^>]*hidden/.test(HTML));
  check("page: every section heading is the one its section points to (aria-labelledby)", [...HTML.matchAll(/aria-labelledby="(r\d+)"/g)].every((m) => HTML.includes(`id="${m[1]}"`)));
}

// ---- where the numbers of sections 1-10 come from (the origins of the data file)
{
  const origins = data.origins ?? [];
  check("origins: exactly one for each of the sections 1 to 10, in order", same(origins.map((o) => o.section), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  const scripts = origins.flatMap((o) => o.commands.map((c) => ({ section: o.section, path: /(scratch\/[\w]+\.(?:mjs|py))/.exec(c)?.[1] })));
  check("origins: every command names a script of scratch/ that exists in the repository", scripts.length >= 10 && scripts.every((s) => s.path && existsSync(new URL(`../${s.path}`, import.meta.url))),
    scripts.filter((s) => !s.path || !existsSync(new URL(`../${s.path}`, import.meta.url))).map((s) => `${s.section}:${s.path}`).join(", "));
  const headings = new Set([...DOC.matchAll(/^## (\d+)\./gm)].map((m) => m[1]));
  const cited = origins.flatMap((o) => o.validation.split(",").map((s) => s.trim()));
  check("origins: every VALIDATION.md section they cite exists as a heading", cited.length >= 10 && cited.every((n) => headings.has(n)), cited.filter((n) => !headings.has(n)).join(", "));
  check("origins: no web address or local address in a command", origins.every((o) => o.commands.every((c) => !/https?:|localhost|127\.0\.0\.1/i.test(c))));
  check("origins: every command starts with the program that runs it (node or py)", origins.every((o) => o.commands.every((c) => /^(node|py) scratch\//.test(c))));
  const sectionOf = (n) => HTML.slice(HTML.indexOf(`<h2 id="r${n}">`), HTML.indexOf(`<h2 id="r${n + 1}">`));
  check("page: each section 1-10 has its own origin line, right under its heading, and sections 11-12 have none",
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].every((n) => (sectionOf(n).match(new RegExp(`data-origin="${n}"`, "g")) || []).length === 1 && new RegExp(`<h2 id="r${n}">[^\\n]*</h2>\\s*<p class="rorigin" data-origin="${n}">`).test(HTML))
    && !/data-origin="1[12]"/.test(HTML));
  check("origins: the date is written for people (7 Nov 2026) and anything else is left alone", fmtDate("2026-11-07") === "7 Nov 2026" && fmtDate("2026-12-31") === "31 Dec 2026" && fmtDate("soon") === "soon");
  const h = originHtml({ section: 1, validation: "2, 10", commands: ["node scratch/a.mjs --x <y>"] }, "2026-11-07");
  check("origins: the line shows the command (escaped), links VALIDATION.md with its sections, gives the date and says the numbers were typed in",
    h.includes("<code>node scratch/a.mjs --x &lt;y&gt;</code>") && h.includes("VALIDATION.md &sect;2, 10") && h.includes("7 Nov 2026") && /typed into this page's data file/.test(h) && !h.includes("<y>"));
  check("origins: the data file is still small (the origins added to it)", statSync(JSON_PATH).size < 12_000, `${statSync(JSON_PATH).size} bytes`);
}

// ---- sections 1-3 are made by a command (scratch/make_results.mjs), laid over the typed file
{
  const g = generatedData;
  check("merge: the generated keys replace the typed ones, the typed sections stay, the origins of sections 1-3 come from the generated file and the list stays in order",
    mergeResults({ a: 1, jansky: [1], origins: [{ section: 1, v: "typed" }, { section: 4, v: "typed" }] }, { summary: 9, origins: [{ section: 1, v: "gen" }] }).summary === 9
    && same(mergeResults({ origins: [{ section: 4 }, { section: 1, v: "t" }] }, { origins: [{ section: 1, v: "g" }] }).origins.map((o) => `${o.section}${o.v ?? ""}`), ["1g", "4"]) && mergeResults({ jansky: [1] }, { origins: [] }).jansky[0] === 1);
  check("the typed file no longer holds the numbers of sections 1-3 (nothing typed can contradict the generated ones)", typedData.movers === undefined && typedData.summary === undefined && typedData.jansky === undefined && typedData.arosa === undefined && typedData.wise0855 === undefined && !typedData.origins.some((o) => g.origins.some((x) => x.section === o.section)));
  check("the generated file: sections 1-6, with the date, the command and the images each run had; no key the pixel guard forbids",
    same(g.generated.sections, [1, 2, 3, 4, 5, 6]) && /^\d{4}-\d{2}-\d{2}$/.test(g.generated.on) && /make_results\.mjs/.test(g.generated.command) && Object.keys(g.generated.runs).length === 6
    && Object.values(g.generated.runs).every((r) => r.imageCount > 0 && r.passes >= 3) && g.origins.length === 6 && g.origins.every((o) => o.generated === g.generated.on));
  check("the merged page data have an origin for each of sections 1-10, and exactly sections 1-6 are generated", data.origins.length === 10 && data.origins.filter((o) => o.generated).map((o) => o.section).join() === "1,2,3,4,5,6");
  const gen = originHtml(data.origins[0], data.measuredOn), typedLine = originHtml(data.origins[6], data.measuredOn);
  check("the origin line of a generated section says 'made by a command, not typed', the date it ran and the file; a typed section still says it was typed",
    /Made by a command, not typed/.test(gen) && gen.includes(fmtDate(g.generated.on)) && gen.includes("real_results_generated.json") && !/typed into this page's data file/.test(gen) && /typed into this page's data file/.test(typedLine));
  check("fmtBy 'date' writes the date in words", fmtBy("date", "2026-11-10") === "10 November 2026" || fmtBy("date", "2026-11-10") === "10 Nov 2026", fmtBy("date", "2026-11-10"));
  // what the prose of results.html says about sections 1-3 must be true of the numbers (make_results.mjs refuses to write otherwise; this checks the file that is there)
  const runs = data.movers.runs, d = (id) => runs.find((r) => r.id === id).difference;
  check("prose: every run recovered its mover with no other candidate; both detectors give the smallest difference for each star; every real line is supported in every measurable image; the mask helps",
    data.summary.recovered[0] === data.summary.recovered[1] && runs.length === 6 && d("barnard-all") <= Math.min(d("barnard-d2"), d("barnard-d6")) && d("eps-all") <= Math.min(d("eps-d2"), d("eps-d6"))
    && data.movers.realSupport.every(([s, m]) => s === m) && data.movers.barnardD2Mask.before > data.movers.barnardD2Mask.after && data.movers.maxChanceLines === Math.max(...runs.map((r) => r.chanceLines)));
  check("prose: the pixel range of the differences is the range divided by the pixel scale; the 'original rule' record keeps the failure of 7 Nov and says what it gives now",
    near(data.movers.differencePixels[0], data.summary.minDifference / data.pixelArcsec, 0.006) && near(data.movers.differencePixels[1], data.summary.maxDifference / data.pixelArcsec, 0.006)
    && data.movers.originalRule.falseChanceLines.length === 3 && data.movers.originalRule.reproducedNow.candidates === 1 && data.movers.originalRule.reproducedNow.falseLines === 0);
  check("the page says that sections 1-3 were remade and 4-10 are typed", /Sections 1&ndash;6 were remade by a command/.test(HTML) && /sections 7&ndash;10 are still the numbers of 7 November/.test(HTML) && /no longer something this page can remake/.test(HTML));
  const results = readFileSync(new URL("../frontend/js/results.js", import.meta.url), "utf8");
  check("the page loads both data files, and fails as a whole (the status line) if one cannot be loaded", /real_results_generated\.json/.test(results) && /Promise\.all\(\["data\/real_results\.json", "data\/real_results_generated\.json"\]/.test(results) && /throw new Error\(`\$\{url\}: HTTP/.test(results));
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
