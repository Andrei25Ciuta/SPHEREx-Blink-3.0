// Tests for the survey coverage (features/surveyCoverage.js): which SPHEREx survey images cover a place, in how many passes, and the request to the backend.
// The footprint and the dates of the "real" image below are a real row of IRSA's spherex.plane (backend/tests/test_survey.py has its raw form).   Run: node scratch/test_survey.mjs
import {
  tangentOffset, planeOffsets, pointInPolygon, covers, mjdToDate, passesOf, coverage, coverageText, planeRow, checkParams, surveyUrl, fetchSurvey,
  PASS_GAP_DAYS, MOVERS_MIN_PASSES, RADIUS_MAX_DEG, LIMIT_MAX,
} from "../frontend/js/features/surveyCoverage.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const BARNARD = [269.4462, 4.769];
const REAL = { id: "b0641d64", detector: "D6", mjdStart: 60902.864715, mjdEnd: 60902.866047, wavelengthMinUm: 4.4115, wavelengthMaxUm: 5.0096, quality: null, product: "image",
  corners: [[266.698156, 5.472441], [270.177406, 5.149538], [269.997359, 1.660061], [266.501191, 1.990364]] };

// ---------------------------------------------------------------- the projection
{
  const c = tangentOffset(10, 5, 10, 5);
  check("projection: the centre is at the origin", near(c[0], 0, 1e-9) && near(c[1], 0, 1e-9));
  const n = tangentOffset(10, 6, 10, 5), e = tangentOffset(1, 0, 0, 0);
  check("projection: one degree north is +60 arcmin up, one degree east is -60 arcmin (east is LEFT)", near(n[1], 60, 0.01) && near(n[0], 0, 1e-9) && near(e[0], -60, 0.01) && near(e[1], 0, 1e-9), `north y=${n[1].toFixed(3)}, east x=${e[0].toFixed(3)}`);
  check("projection: a point 90 degrees away or more cannot be projected", tangentOffset(100, 0, 10, 0) === null && tangentOffset(190, 0, 10, 0) === null);
  // a great circle must be a straight line in the tangent plane: points of an inclined great circle, seen from a centre near it, are collinear
  const inc = 35 * Math.PI / 180, pts = [];
  for (let t = -0.4; t <= 0.4; t += 0.1) {
    const x = Math.cos(t), y = Math.sin(t) * Math.cos(inc), z = Math.sin(t) * Math.sin(inc);
    pts.push(tangentOffset(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360, (Math.asin(z) * 180) / Math.PI, 0, 0));
  }
  const [p0, p1] = [pts[0], pts.at(-1)];
  const off = Math.max(...pts.map((p) => Math.abs((p1[0] - p0[0]) * (p0[1] - p[1]) - (p0[0] - p[0]) * (p1[1] - p0[1])) / Math.hypot(p1[0] - p0[0], p1[1] - p0[1])));
  check("projection: a great circle (the edge of a footprint) is a straight line to 1e-9 arcmin", off < 1e-9, `largest distance from the line ${off.toExponential(1)}`);
  const square = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  check("point in polygon: inside, outside, and a concave shape", pointInPolygon(0, 0, square) && !pointInPolygon(2, 0, square) && !pointInPolygon(0, -1.5, square)
    && !pointInPolygon(1, 1.5, [[0, 0], [2, 0], [2, 2], [1, 0.5], [0, 2]]) && pointInPolygon(1, 0.2, [[0, 0], [2, 0], [2, 2], [1, 0.5], [0, 2]]) && pointInPolygon(0.2, 0.5, [[0, 0], [2, 0], [2, 2], [1, 0.5], [0, 2]]));
}

// ---------------------------------------------------------------- covering a position
{
  check("a real SPHEREx footprint (D6, 3.5 degrees wide) covers Barnard's Star and not a place 20 degrees away", covers(REAL, ...BARNARD) && !covers(REAL, 250, 5) && !covers(REAL, 269.4, 30));
  const poly = planeOffsets(REAL, ...BARNARD);
  const widthArcmin = Math.max(...poly.map((p) => p[0])) - Math.min(...poly.map((p) => p[0]));
  check("its size at true scale: about 3.5 degrees wide", widthArcmin > 190 && widthArcmin < 230, `${(widthArcmin / 60).toFixed(2)} deg`);
  const wrap = { corners: [[359, -1], [1, -1], [1, 1], [359, 1]] };
  check("a footprint across RA 0 covers RA 0 and RA 359.5, and not RA 5", covers(wrap, 0, 0) && covers(wrap, 359.5, 0.5) && !covers(wrap, 5, 0));
  check("a footprint that cannot be projected (a corner on the far side) covers nothing, and does not throw", planeOffsets({ corners: [[0, 0], [100, 0], [100, 10], [0, 10]] }, 190, 0) === null && covers({ corners: [[0, 0], [100, 0], [100, 10], [0, 10]] }, 190, 0) === false);
}

// ---------------------------------------------------------------- dates and passes
{
  check("MJD to date: MJD 60902.86 is 2025-08-15, MJD 51544 is 2000-01-01, MJD 40587 is 1970-01-01", mjdToDate(60902.864715) === "2025-08-15" && mjdToDate(51544) === "2000-01-01" && mjdToDate(40587) === "1970-01-01");
  const p = passesOf([300, 1, 100.5, 2, 3, NaN, 101]);
  check("passes: dates are sorted, NaN ignored, and a gap above 30 days starts a new pass", p.length === 3 && p.map((x) => x.count).join() === "3,2,1" && p[0].start === 1 && p[0].end === 3 && p[1].start === 100.5);
  check("passes: a gap of exactly 30 days starts a new pass, 29.99 does not (the rule of Find movers); no dates, no passes", passesOf([0, PASS_GAP_DAYS]).length === 2 && passesOf([0, PASS_GAP_DAYS - 0.01]).length === 1 && passesOf([]).length === 0);
  const mv = await import("../frontend/js/features/movers.js");
  const dates = [0, 1, 2, 100, 101, 200, 229.5, 259.5];
  check("passes: the same cuts as passIndices of movers.js, the function Find movers and the timeline use (PASS_GAP_DAYS is its constant)", PASS_GAP_DAYS === mv.DEFAULTS.minPassGapDays
    && passesOf(dates).map((x) => x.count).join() === mv.passIndices(dates).reduce((acc, p) => { acc[p] = (acc[p] ?? 0) + 1; return acc; }, []).join(), passesOf(dates).map((x) => x.count).join());
}

// ---------------------------------------------------------------- the coverage
const mk = (detector, mjd, over = {}) => ({ ...REAL, id: `${detector}@${mjd}`, detector, mjdStart: mjd, mjdEnd: mjd + 0.001, ...over });
{
  const planes = [mk("D6", 60902.8), mk("D3", 60902.8), mk("D2", 60905), mk("D2", 61085), mk("D5", 61267), mk("D1", 61267.1),
    mk("D2", 61000, { corners: [[200, 5], [203, 5], [203, 8], [200, 8]] })];
  const c = coverage(planes, ...BARNARD);
  check("coverage: counts the images that cover the centre (6 of 7), by detector, in 3 passes", c.found === 7 && c.covering.length === 6 && c.byDetector.D2 === 2 && c.byDetector.D6 === 1 && c.passes.length === 3
    && c.passes.map((p) => p.count).join() === "3,1,2", JSON.stringify(c.byDetector));
  check("coverage: first and last date, the span in days, and 3 passes are enough for Find movers", c.first === "2025-08-15" && c.last === "2026-08-15" && near(c.spanDays, 61267.1 - 60902.8, 1e-9) && c.enoughForMovers === true && MOVERS_MIN_PASSES === 3);
  const two = coverage(planes.slice(0, 4), ...BARNARD);
  check("coverage: two passes are not enough, and the words say so", two.passes.length === 2 && two.enoughForMovers === false && /fewer than the 3 passes/.test(coverageText(two)));
  const text = coverageText(c);
  check("coverage in words: the number, the detectors, the passes, the dates, the verdict, and the one that does not cover", /^6 images cover the centre \(D1 ×1, D2 ×2, D3 ×1, D5 ×1, D6 ×1\), in 3 survey passes from 2025-08-15 to 2026-08-15 \(364 days\): enough for Find movers/.test(text) && /1 more touch the circle without covering its centre/.test(text), text);
  const cut = coverageText(coverage(planes, ...BARNARD, { truncated: true }));
  check("coverage in words: a cut-off list does not claim a verdict on the number of passes", /cut off, so the real number of passes may be higher/.test(cut) && !/enough for Find movers/.test(cut));
  check("coverage in words: nothing found, and found-but-not-at-the-centre, are said differently", /lists no survey image/.test(coverageText(coverage([], ...BARNARD))) && /none covers its centre/.test(coverageText(coverage([planes.at(-1)], ...BARNARD))));
  const row = planeRow(planes[0], ...BARNARD);
  check("a table row: the date, the detector, the wavelength range in micrometres, and whether it covers the centre", row.date === "2025-08-15" && row.detector === "D6" && row.wavelength === "4.41–5.01" && row.coversCentre === true && planeRow(planes.at(-1), ...BARNARD).coversCentre === false
    && planeRow({ ...REAL, wavelengthMinUm: null }, ...BARNARD).wavelength === "–");
}

// ---------------------------------------------------------------- the request
{
  const ok = { ra: 269.4462, dec: 4.769, radiusDeg: 0.5, det: "D2", limit: 200 };
  check("params: a good search passes, and the defaults are 'all' and 200", checkParams(ok).ok && checkParams({ ra: 1, dec: 1, radiusDeg: 1 }).params.det === "all" && checkParams({ ra: 1, dec: 1, radiusDeg: 1 }).params.limit === 200);
  const bad = [{ ...ok, ra: 360 }, { ...ok, ra: -1 }, { ...ok, ra: NaN }, { ...ok, dec: 91 }, { ...ok, radiusDeg: 0 }, { ...ok, radiusDeg: RADIUS_MAX_DEG + 0.1 }, { ...ok, det: "D7" }, { ...ok, det: "D2' OR 1=1" },
    { ...ok, limit: 0 }, { ...ok, limit: LIMIT_MAX + 1 }, { ...ok, limit: 2.5 }];
  check("params: every value the backend would refuse is refused here first, with a sentence", bad.every((p) => { const r = checkParams(p); return !r.ok && r.error.length > 20; }));
  const url = surveyUrl("http://localhost:8003", ok);
  check("the address: /api/survey with ra, dec, radius (degrees), det and limit", url === "http://localhost:8003/api/survey?ra=269.446200&dec=4.769000&radius=0.5&det=D2&limit=200", url);

  const answerOf = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw new Error("not json"); return body; } });
  const good = await fetchSurvey("http://x", ok, { fetchFn: answerOf(200, { planes: [REAL], truncated: false, retrievedAt: "2026-11-10 00:00:00 UTC" }) });
  check("fetch: a good answer is returned as it came", good.planes.length === 1 && good.retrievedAt.endsWith("UTC"));
  const fails = async (fetchFn, params = ok) => { try { await fetchSurvey("http://x", params, { fetchFn }); return null; } catch (e) { return e.message; } };
  let called = 0;
  const invalid = await fails(async () => { called++; }, { ...ok, ra: 400 });
  check("fetch: invalid input is an error and nothing is sent", /Right ascension/.test(invalid) && called === 0);
  check("fetch: IRSA down (HTTP 502) says IRSA did not answer, with the reason", /IRSA did not answer: IRSA unreachable/.test(await fails(answerOf(502, { detail: "IRSA unreachable or it refused the query" }))));
  check("fetch: a refusal (HTTP 400) says what the backend said; HTTP 404 without a body still says something", /refused the search \(HTTP 400\): radius must be/.test(await fails(answerOf(400, { detail: "radius must be above 0" }))) && /HTTP 404/.test(await fails(answerOf(404, undefined))));
  check("fetch: no backend at all is said as such, and a timeout as a timeout", /Cannot reach the backend at http:\/\/x \(Failed to fetch\)/.test(await fails(async () => { throw new TypeError("Failed to fetch"); }))
    && /did not answer in time/.test(await fails(async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; })));
  check("fetch: an answer that is not a list of images is an error, not an empty list", /not a list of survey images/.test(await fails(answerOf(200, { rows: [] }))));
}

// ---------------------------------------------------------------- the button (a fake page: only the parts that do not draw)
{
  const { setupSurveySearch, NO_BACKEND_TEXT } = await import("../frontend/js/features/surveyView.js");
  const node = (extra = {}) => ({ value: "", textContent: "", disabled: false, hidden: false, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, replaceChildren() {}, ...extra });
  const page = () => ({ form: node(), ra: node({ value: "269.4462" }), dec: node({ value: "4.769" }), radius: node({ value: "0.5" }), det: node({ value: "all" }), limit: node({ value: "1000" }), button: node(), fieldBtn: node(),
    error: node(), status: node(), result: node({ hidden: true }), summary: node(), plot: node(), table: node(), openBtn: node() });
  const calls = [];
  const els0 = page();
  setupSurveySearch({ els: els0, fetchSurvey: async (p) => { calls.push(p); return { planes: [] }; }, openField() {}, hasBackend: false, currentField: () => null });
  check("button: without a backend it is disabled and the page says why, in the place where the user looks (status), not a silent dead button", els0.button.disabled === true && els0.status.textContent === NO_BACKEND_TEXT && /CORS/.test(NO_BACKEND_TEXT) && /Nothing is invented/.test(NO_BACKEND_TEXT));

  const els1 = page();
  const view = setupSurveySearch({ els: els1, fetchSurvey: async (p) => { calls.push(p); throw new Error("IRSA did not answer: slow."); }, openField() {}, hasBackend: true, currentField: () => ({ ra: 10.5, dec: -3.25 }) });
  check("button: with a backend it is enabled", els1.button.disabled === false);
  els1.ra.value = "400";
  await view.search();
  check("button: a position that is not valid is said in words (alert) and nothing is asked", /RA in degrees must be between 0 and 360/.test(els1.error.textContent) && calls.length === 0);
  els1.ra.value = "17h57m47s"; els1.dec.value = "+04 46 08";
  await view.search();
  check("button: a position typed as hours and degrees is understood, the request carries degrees, and a failing search says so and draws nothing", calls.length === 1 && near(calls[0].ra, 269.4458, 0.001) && near(calls[0].dec, 4.7689, 0.001) && calls[0].radiusDeg === 0.5 && calls[0].limit === 1000
    && /^The search failed: IRSA did not answer: slow\. Nothing is drawn in its place\.$/.test(els1.status.textContent) && els1.result.hidden === true && els1.button.disabled === false, els1.status.textContent);
  els1.fieldBtn.listeners.click();
  check("button: 'Use the field on screen' copies the position of the data on screen", els1.ra.value === "10.5000" && els1.dec.value === "-3.2500");
  const els2 = page();
  setupSurveySearch({ els: els2, fetchSurvey: async () => ({ planes: [] }), openField() {}, hasBackend: true, currentField: () => null });
  els2.fieldBtn.listeners.click();
  check("button: 'Use the field on screen' with no data loaded says so", /No data is loaded/.test(els2.error.textContent));
}

// ---------------------------------------------------------------- the page
{
  const { readFileSync } = await import("node:fs");
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const HTML = read("../frontend/index.html"), MAIN = read("../frontend/js/main.js"), CSS = read("../frontend/css/styles.css");
  const ids = ["survey-form", "survey-ra", "survey-dec", "survey-radius", "survey-det", "survey-limit", "survey-btn", "survey-field-btn", "survey-error", "survey-status", "survey-result", "survey-summary", "survey-plot", "survey-table", "survey-open-btn"];
  const skySection = HTML.match(/<section\b[^>]*\bid="sky-explorer"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? "";
  check("page: every element the survey search needs is in index.html exactly once, inside the sky-explorer section, with a live status and an alert for errors",
    ids.every((id) => (HTML.match(new RegExp(`id="${id}"`, "g")) || []).length === 1 && skySection.includes(`id="${id}"`))
    && /id="survey-status" role="status" aria-live="polite"/.test(HTML) && /id="survey-error" role="alert"/.test(HTML) && /<button type="submit" class="btn btn-small btn-primary" id="survey-btn">Search IRSA<\/button>/.test(HTML));
  check("page: main.js wires it with the backend address only when the data come from the backend, and through askSurvey (the request of surveyCoverage.js)",
    /setupSurveySearch\(\{/.test(MAIN) && /hasBackend: DATA_SOURCE === "api"/.test(MAIN) && /fetchSurvey: \(params\) => askSurvey\(API_BASE, params\)/.test(MAIN));
  const code = (f) => read(f).replace(/\/\/.*$/gm, "");
  check("page: the browser never calls IRSA itself (it sends no CORS headers): no IRSA address in the two modules, only the backend's /api/survey",
    !/irsa\.ipac/i.test(code("../frontend/js/features/surveyCoverage.js")) && !/irsa\.ipac/i.test(code("../frontend/js/features/surveyView.js")) && /\/api\/survey\?/.test(code("../frontend/js/features/surveyCoverage.js")));
  check("page: the colours of the plot come from tokens only", /\.survey-poly-far \{[^}]*var\(--text-muted\)/.test(CSS) && /\.survey-circle \{[^}]*var\(--warn\)/.test(CSS) && !/\.survey-[a-z-]+ \{[^}]*#[0-9a-fA-F]{3,8}\b/.test(CSS));
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failed ? 1 : 0;
