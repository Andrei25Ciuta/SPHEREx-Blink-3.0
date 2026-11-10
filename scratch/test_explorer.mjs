// Tests for the candidate explorer (js/features/candidateExplorer.js): filter, search, sort by a column, page, cell text and the layout of the
// support-against-S/N plot. Run: node scratch/test_explorer.mjs
import { FILTERS, COLUMNS, CLASS_ORDER, sortRows, searchRows, pageOf, exploreRows, cellText, scatterLayout } from "../frontend/js/features/candidateExplorer.js";
import { CLASSES, NEEDS_CHECKING_SCORE } from "../frontend/js/features/discovery.js";
import { FILTERS as PANEL_FILTERS } from "../frontend/js/features/discoverPanel.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}

const row = (id, over = {}) => ({
  id, class: "catalogued", classLabel: CLASSES.catalogued, headline: `Gaia DR3: ${id}`, ra: 269.4 + id.length / 1000, dec: 4.77, motion: null, nDet: 9, nFrames: 9, passes: 3, snr: 20, support: 80,
  fluxMilliJy: 2.5, tags: [], match: `Gaia DR3 ${id}`, ...over,
});
const rows = [
  row("A1", { class: "unknown", classLabel: CLASSES.unknown, headline: "fixed source", support: 71, snr: 12.4, fluxMilliJy: 0.8, match: "", ra: 269.40 }),
  row("A2", { class: "unknown-weak", classLabel: CLASSES["unknown-weak"], headline: "fixed source", support: 41, snr: 6, fluxMilliJy: 0.3, match: "", ra: 269.41 }),
  row("A3", { class: "artefact", classLabel: CLASSES.artefact, headline: "fixed source", support: 52, snr: 9, fluxMilliJy: null, match: "", ra: 269.42 }),
  row("B10", { class: "catalogued-moving", classLabel: CLASSES["catalogued-moving"], tags: ["moving"], motion: 10.3, support: 95, snr: 150, fluxMilliJy: 410, headline: "Gaia DR3: Gaia DR3 4472832130942575872 · moving 10″/yr", ra: 269.45 }),
  row("B2", { class: "solar-system", classLabel: CLASSES["solar-system"], headline: "2015 RW209 (V 22.6) · known MB>Outer", match: "SkyBoT 2015 RW209", support: 60, snr: 8, ra: 269.43 }),
  row("C1", { class: "catalogued", tags: ["red"], support: 88, snr: 40, fluxMilliJy: 12, ra: 269.44 }),
  row("C2", { class: "catalogued", tags: ["very-red", "transient"], support: 88, snr: NaN, fluxMilliJy: 0.05, ra: 269.46 }),
  row("D1", { class: "unchecked", classLabel: CLASSES.unchecked, headline: "fixed source", support: 70, snr: 15, fluxMilliJy: 1.1, match: "", ra: 269.47 }),
];

// ---------------------------------------------------------------- the shared definitions
{
  check("the class order is a permutation of the classes of discovery.js (so nothing is missing or invented)", [...CLASS_ORDER].sort().join() === Object.keys(CLASSES).sort().join() && CLASS_ORDER[0] === "unknown" && CLASS_ORDER.at(-1) === "catalogued");
  check("the panel still exports the same FILTERS (they moved here)", PANEL_FILTERS === FILTERS && Object.keys(FILTERS).join() === "all,check,unknown,known,artefact,moving,transient,red");
  check("every column has a key, a label and a title; the numeric ones are the numbers", COLUMNS.every((c) => c.key && c.label && c.title) && COLUMNS.filter((c) => c.numeric).map((c) => c.key).join() === "ra,dec,motion,nDet,snr,support,fluxMilliJy");
  const count = (k) => rows.filter(FILTERS[k][1]).length;
  check("filters work on rows as they do on candidates", count("all") === 8 && count("check") === 1 && count("unknown") === 2 && count("known") === 4 && count("artefact") === 1 && count("moving") === 1 && count("transient") === 1 && count("red") === 2);
}

// ---------------------------------------------------------------- sorting
{
  const ids = (list) => list.map((r) => r.id).join();
  check("sort by support, highest first and lowest first", ids(sortRows(rows, "support", "desc")).startsWith("B10,C1,C2,A1,D1") && ids(sortRows(rows, "support", "asc")).startsWith("A2,A3,B2"));
  check("sort is stable: rows with equal support keep their order (C1 before C2, A1 before D1 only by value)", ids(sortRows(rows, "support", "desc")).indexOf("C1") < ids(sortRows(rows, "support", "desc")).indexOf("C2"));
  check("a row with no value (no S/N, no flux) goes last whichever way you sort", ids(sortRows(rows, "snr", "asc")).endsWith("C2") && ids(sortRows(rows, "snr", "desc")).endsWith("C2") && ids(sortRows(rows, "fluxMilliJy", "desc")).endsWith("A3") && ids(sortRows(rows, "fluxMilliJy", "asc")).endsWith("A3"));
  check("sort by class follows CLASS_ORDER (unknown first, catalogued last) and asc/desc reverse it", sortRows(rows, "class", "asc")[0].class === "unknown" && sortRows(rows, "class", "asc").at(-1).class === "catalogued" && sortRows(rows, "class", "desc")[0].class === "catalogued");
  check("text sorts ignore case and compare numbers as numbers (B2 before B10)", ids(sortRows(rows, "id", "asc")) === "A1,A2,A3,B2,B10,C1,C2,D1" && ids(sortRows([row("b2"), row("B10"), row("a1")], "id", "asc")) === "a1,b2,B10");
  const before = ids(rows); sortRows(rows, "support", "desc");
  check("sorting never changes the list it is given", ids(rows) === before);
  check("sort by position (RA) puts the smallest RA first", sortRows(rows, "ra", "asc")[0].id === "A1" && sortRows(rows, "ra", "desc")[0].id === "D1");
  check("an unknown key keeps the order, without an error", ids(sortRows(rows, "nothing", "asc")) === ids(rows));
}

// ---------------------------------------------------------------- search
{
  check("search: every word must be there, in any order, any case", searchRows(rows, "gaia moving").length === 1 && searchRows(rows, "MOVING gaia")[0].id === "B10");
  check("search finds the id, the match, the class label and the tags", searchRows(rows, "rw209").length === 1 && searchRows(rows, "a2").some((r) => r.id === "A2") && searchRows(rows, "artefact")[0].id === "A3" && searchRows(rows, "very-red")[0].id === "C2");
  check("search: an empty or blank text keeps everything; a word nothing has gives nothing", searchRows(rows, "").length === 8 && searchRows(rows, "   ").length === 8 && searchRows(rows, undefined).length === 8 && searchRows(rows, "zzzz").length === 0);
  check("search looks at the field of a row too (the results page has several)", searchRows([row("X", { field: "Barnard D2" })], "barnard").length === 1);
}

// ---------------------------------------------------------------- paging
{
  const list = Array.from({ length: 23 }, (_, i) => i);
  const p = pageOf(list, 1, 10);
  check("page 1 of 23 in tens: 10 rows, 3 pages, from 1 to 10", p.rows.length === 10 && p.pages === 3 && p.page === 1 && p.from === 1 && p.to === 10 && p.total === 23);
  const last = pageOf(list, 3, 10);
  check("the last page has the rest (3 rows, 21 to 23)", last.rows.join() === "20,21,22" && last.from === 21 && last.to === 23);
  check("a page past the end or before the start is brought back; nonsense becomes page 1", pageOf(list, 99, 10).page === 3 && pageOf(list, -4, 10).page === 1 && pageOf(list, "x", 10).page === 1 && pageOf(list, 2, 0).pages === 3);
  const none = pageOf([], 5, 10);
  check("no rows: one empty page, from 0 to 0", none.rows.length === 0 && none.pages === 1 && none.page === 1 && none.from === 0 && none.to === 0 && none.total === 0);
  check("every row is on exactly one page", [1, 2, 3].flatMap((k) => pageOf(list, k, 10).rows).join() === list.join());
}

// ---------------------------------------------------------------- all together
{
  const e = exploreRows(rows, { filter: "known", sortKey: "support", sortDir: "desc", page: 1, pageSize: 3 });
  check("explore: filter, then sort, then page; it says how many rows there are and how many matched", e.all === 8 && e.matched === 4 && e.total === 4 && e.rows.map((r) => r.id).join() === "B10,C1,C2" && e.pages === 2);
  check("explore: the second page has the rest", exploreRows(rows, { filter: "known", sortKey: "support", sortDir: "desc", page: 2, pageSize: 3 }).rows.map((r) => r.id).join() === "B2");
  check("explore: with the search text the filter still applies", exploreRows(rows, { filter: "known", text: "gaia", sortKey: "id", sortDir: "asc" }).rows.map((r) => r.id).join() === "B10,C1,C2" && exploreRows(rows, { filter: "check", text: "gaia" }).matched === 0);
  check("explore: no state at all lists everything in its order; an unknown filter is 'everything'", exploreRows(rows).matched === 8 && exploreRows(rows).rows.map((r) => r.id).join() === rows.slice(0, 8).map((r) => r.id).join() && exploreRows(rows, { filter: "nope" }).matched === 8);
}

// ---------------------------------------------------------------- the text of the cells
{
  check("cellText: class label, position as hours and degrees, a dash for what is missing", cellText(rows[0], "class") === CLASSES.unknown && /^17h5\dm/.test(cellText(rows[0], "ra")) && cellText(rows[0], "dec") === "+04°46′12.0″" && cellText(rows[0], "motion") === "–" && cellText(rows[2], "fluxMilliJy") === "–" && cellText(rows[6], "snr") === "–");
  check("cellText: numbers with sensible digits ('9 of 9', S/N 6.0 below ten and whole above it, flux 0.800 and 410.00, motion 10.3)", cellText(rows[0], "nDet") === "9 of 9" && cellText(rows[1], "snr") === "6.0" && cellText(rows[0], "snr") === "12" && cellText(rows[3], "snr") === "150" && cellText(rows[0], "fluxMilliJy") === "0.800" && cellText(rows[3], "fluxMilliJy") === "410.00" && cellText(rows[3], "motion") === "10.3" && cellText({ motion: 2.345 }, "motion") === "2.35");
  check("cellText: the text columns show the text", cellText(rows[3], "headline").includes("moving 10") && cellText(rows[0], "id") === "A1" && cellText({ id: "" }, "id") === "–");
}

// ---------------------------------------------------------------- the diagnostic plot
{
  const L = scatterLayout(rows, { width: 560, height: 260, threshold: NEEDS_CHECKING_SCORE });
  const { x0, x1, y0, y1 } = L.plot;
  check("scatter: one point per row that has an S/N and a support (7 of 8), the other is counted, not hidden", L.points.length === 7 && L.skipped === 1 && !L.points.some((p) => p.id === "C2"));
  check("scatter: every point is inside the plot", L.points.every((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1));
  const at = (id) => L.points.find((p) => p.id === id);
  check("scatter: more support is higher up (smaller y), more S/N is further right", at("B10").y < at("A1").y && at("A1").y < at("A2").y && at("B10").x > at("C1").x && at("C1").x > at("A1").x && at("A1").x > at("A2").x);
  check("scatter: the S/N axis is logarithmic (equal ratios, equal distances: S/N 6 -> 12 -> 24 is the same step)", (() => { const L2 = scatterLayout([row("p", { snr: 6 }), row("q", { snr: 12 }), row("r", { snr: 24 })]); const d1 = L2.points[1].x - L2.points[0].x, d2 = L2.points[2].x - L2.points[1].x; return Math.abs(d1 - d2) < 1e-9; })());
  check("scatter: support 100 is the top of the plot, 0 the bottom; the threshold line is at 65", Math.abs(scatterLayout([row("t", { support: 100 })]).points[0].y - y0) < 1e-9 && Math.abs(scatterLayout([row("u", { support: 0 })]).points[0].y - y1) < 1e-9
    && Math.abs(L.thresholdY - (y1 - (NEEDS_CHECKING_SCORE / 100) * (y1 - y0))) < 1e-9 && scatterLayout(rows).thresholdY === null);
  check("scatter: ticks are inside the plot and in order", L.xTicks.length >= 3 && L.xTicks.every((t, i, a) => t.x >= x0 && t.x <= x1 && (i === 0 || t.x > a[i - 1].x)) && L.yTicks.map((t) => t.value).join() === "0,25,50,75,100");
  check("scatter: points keep their class (the plot colours them)", at("A1").class === "unknown" && at("B2").class === "solar-system");
  const none = scatterLayout([]);
  check("scatter: nothing to draw is not an error", none.points.length === 0 && none.skipped === 0 && none.xTicks.length > 0);
  check("scatter: an S/N of zero or less cannot go on a logarithmic axis, so it is skipped", scatterLayout([row("z", { snr: 0 }), row("y", { snr: -3 })]).points.length === 0);
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
