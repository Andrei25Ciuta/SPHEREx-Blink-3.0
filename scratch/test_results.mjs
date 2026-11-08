// Tests for the real-data results page: frontend/js/results.js (pure helpers + chart builders), frontend/data/real_results.json,
// frontend/results.html.  Run: node scratch/test_results.mjs
import { niceTicks, place, assignLanes, fmtChance, fmtPow10, fmtBy, getPath, fixed, esc, buildCharts, barsHtml, dotsHtml, tableHtml } from "../frontend/js/results.js";
import { readFileSync, statSync } from "node:fs";

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
const data = JSON.parse(readFileSync(JSON_PATH, "utf8"));

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
check("getPath follows objects and array indexes, undefined when missing", getPath(data, "movers.runs.2.difference") === 0.2 && getPath(data, "movers.nope.x") === undefined);
check("fmtBy formats", fmtBy("fixed:2", 0.2) === "0.20" && fmtBy("ofn", [6, 6]) === "6 of 6" && fmtBy("chance", 2e-21) === "2×10⁻²¹" && fmtBy("", 563) === "563" && fmtBy("fixed:2", undefined) === "?");
check("text is escaped", esc('<b a="1">&\'') === "&lt;b a=&quot;1&quot;&gt;&amp;&#39;" && fixed(null) === "–");

// ---- the numbers are consistent with themselves
{
  const bad = data.movers.runs.filter((r) => !near(Math.hypot(r.measured[0] - r.catalogue[0], r.measured[1] - r.catalogue[1]), r.difference, 0.02));
  check("each stated difference is the distance between its measured and catalogue motion", bad.length === 0, bad.map((r) => r.id).join(", "));
  const diffs = data.movers.runs.map((r) => r.difference);
  check("the headline range is the min and max of the runs, and all runs recovered", data.summary.minDifference === Math.min(...diffs) && data.summary.maxDifference === Math.max(...diffs)
    && same(data.summary.recovered, [data.movers.runs.length, data.movers.runs.length]) && data.movers.runs.every((r) => r.seen[0] === r.seen[1]));
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
  check("the data file is small", statSync(JSON_PATH).size < 12_000, `${statSync(JSON_PATH).size} bytes`);
  const longest = (o) => (Array.isArray(o) ? Math.max(o.length, ...o.map(longest)) : o && typeof o === "object" ? Math.max(0, ...Object.values(o).map(longest)) : 0);
  check("no array longer than 20 numbers (no light-curve or pixel dumps)", longest(data) <= 20, String(longest(data)));
  check("the page has no <img>, <canvas> or inline image", !/<img|<canvas|<video|data:image/i.test(HTML));
}

// ---- it still says what VALIDATION.md says
{
  const miss = [];
  const need = (s) => { if (!DOC.includes(s)) miss.push(s); };
  for (const r of data.movers.runs) { need(`**${r.difference.toFixed(2)} ″/yr**`); need(r.chanceLines.toExponential(0)); }
  for (const j of data.jansky) need(`**${j.median.toFixed(3)}**`);
  need("3.72"); need("0.31");
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
check("the movers chart has one bar per run, with its value", (charts.moversDifference.match(/class="rbar /g) || []).length === 6 && charts.moversDifference.includes("0.20″/yr") && charts.moversDifference.includes("0.80″/yr"));
check("the chance-line chart marks the three false lines apart (bad diamonds) and writes 2×10⁻²¹", (charts.chanceLines.match(/rpt diamond bad/g) || []).length === 3 && charts.chanceLines.includes("2×10⁻²¹") && charts.chanceLines.includes('class="rref"'));
check("the Barnard chart shows both bars", charts.barnardMask.includes("3.72″/yr") && charts.barnardMask.includes("0.31″/yr"));
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
  const known = ["fixed", "int", "chance", "pct", "signed", "thousands", "ofn"];
  check("every data-fmt is one fmtBy understands", paths.every((p) => !p.fmt || known.includes(p.fmt.split(":")[0])));
  const ids = [...HTML.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  check("ids are unique", new Set(ids).size === ids.length);
  const missingAnchors = [...HTML.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]).filter((id) => !ids.includes(id));
  const missingLabels = [...HTML.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]).filter((id) => !ids.includes(id));
  check("every #anchor and aria-labelledby points at an id", missingAnchors.length === 0 && missingLabels.length === 0, [...missingAnchors, ...missingLabels].join(", "));
  check("one h1, a lang, a viewport, a skip link and a way back to the app", (HTML.match(/<h1[ >]/g) || []).length === 1 && /<html lang="en"[ >]/.test(HTML) && /name="viewport"/.test(HTML) && HTML.includes('class="skip-link"') && HTML.includes('href="index.html"'));
  check("the page says the images are not published, shows the failure of the first blind Planet X search and the limits of the fair one",
    /No SPHEREx image or pixel is published/.test(HTML) && /blind search failed/i.test(HTML) && /A fair test/.test(HTML) && /default options the search found nothing/.test(HTML) && /not yet a result/.test(HTML));
  check("the status line and the module are there", HTML.includes('id="results-status"') && HTML.includes('src="js/results.js"') && HTML.includes("data-limits"));
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
