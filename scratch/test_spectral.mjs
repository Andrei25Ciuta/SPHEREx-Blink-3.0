// Tests for the spectral and multi-detector side (frontend/js/features/spectral.js and the "band" style of the spectrum in measure.js): what is there and what is MISSING.
// Run: node scratch/test_spectral.mjs
import { readFileSync } from "node:fs";
import { EXPECTED_DETECTORS, detectorCoverage, coverageText, bandSeries, missingSummary, withAlpha } from "../frontend/js/features/spectral.js";
import { spectrumTraces } from "../frontend/js/features/measure.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------- the instrument
check("the six detectors D1 to D6, each starting where the one before ended, covering 0.75 to 5 µm; D2 is 1.10-1.62 µm (the one the documentation confirms)",
  EXPECTED_DETECTORS.map((d) => d.id).join() === "D1,D2,D3,D4,D5,D6" && EXPECTED_DETECTORS.every((d, i) => d.wlMax > d.wlMin && (i === 0 || (d.wlMin > EXPECTED_DETECTORS[i - 1].wlMax && d.wlMin - EXPECTED_DETECTORS[i - 1].wlMax < 0.05)))
  && EXPECTED_DETECTORS[0].wlMin === 0.75 && EXPECTED_DETECTORS[5].wlMax === 5 && EXPECTED_DETECTORS[1].wlMin === 1.10 && EXPECTED_DETECTORS[1].wlMax === 1.62);

// ---------------------------------------------------------------- coverage
const frame = (detector, wlMin, wlMax, mjd, fractionFlagged) => ({ detector, wavelengthMinUm: wlMin, wavelengthMaxUm: wlMax, mjd, flags: fractionFlagged === undefined ? null : { fractionFlagged, anyFlagged: fractionFlagged > 0 } });
{
  const frames = [frame("D2", 1.088, 1.114, 60909, 0.01), frame("D2", 1.497, 1.535, 61114, 0.03), frame("D2", 1.639, 1.66, 61271, undefined), frame("D6", 4.5, 4.52, 60909.5, 0.0), frame("D6", 4.6, 4.62, 60909.5)];
  const rows = detectorCoverage(frames), by = Object.fromEntries(rows.map((r) => [r.id, r]));
  check("coverage: one row for every detector of the instrument, in order, whether it has images or not", rows.map((r) => r.id).join() === "D1,D2,D3,D4,D5,D6");
  check("coverage: a detector with images says how many, from which to which wavelength (read from the images, not from the table), the dates", by.D2.status === "images" && by.D2.count === 3 && by.D2.wlMin === 1.088 && by.D2.wlMax === 1.66 && by.D2.firstDate === "2025-08-22" && by.D2.lastDate === "2026-08-19", JSON.stringify(by.D2));
  check("coverage: the flagged share is the mean over the images whose flags are known; unknown flags are not counted as clean", near(by.D2.flaggedMean, 0.02) && near(by.D6.flaggedMean, 0) && detectorCoverage([frame("D2", 1, 1.1, 60000)])[1].flaggedMean === null);
  check("coverage: a detector with no images is MISSING, with the band it would have, and no invented numbers", ["D1", "D3", "D4", "D5"].every((id) => by[id].status === "none" && by[id].count === 0 && by[id].wlMin === null && by[id].firstDate === null && by[id].flaggedMean === null && by[id].expected.wlMax > by[id].expected.wlMin));
  check("coverage: the same day is one date, not a range", detectorCoverage([frame("D2", 1, 1.1, 60000), frame("D2", 1.2, 1.3, 60000.4)])[1].firstDate === detectorCoverage([frame("D2", 1, 1.1, 60000), frame("D2", 1.2, 1.3, 60000.4)])[1].lastDate);
  const odd = detectorCoverage([frame("D7", 6, 7, 60000, 0.1)]);
  check("coverage: a detector name that is not in the table is kept (last), with no expected band; no frames at all give six missing rows", odd.at(-1).id === "D7" && odd.at(-1).expected === null && odd.at(-1).count === 1 && odd.length === 7
    && detectorCoverage([]).every((r) => r.status === "none") && detectorCoverage(undefined).length === 6);
  const t2 = coverageText(by.D2), t1 = coverageText(by.D1), t6 = coverageText({ ...by.D6, count: 1 });
  check("coverage text: images: band, count and dates, flagged share; missing: 'no images here' and the expected band; one image is singular",
    /1\.09–1\.66 µm · 3 images/.test(t2.line1) && /2025-08-22 to 2026-08-19 · 2\.0 % flagged/.test(t2.line2) && t1.line1 === "no images here" && /expected 0\.75–1\.09 µm/.test(t1.line2) && /1 image$/.test(t6.line1)
    && coverageText(detectorCoverage([frame("D2", 1, 1.1, 60000)])[1]).line2.endsWith("flags not known"));
}

// ---------------------------------------------------------------- bands
{
  const pts = [{ wavelengthUm: 1.5, y: 10, err: 1 }, { wavelengthUm: 1.1, y: 8, err: 2 }, { wavelengthUm: 1.2, y: 9, err: -0.5 }, { wavelengthUm: 4.5, y: 3, err: 0.5 }, { wavelengthUm: 4.6, y: 4, err: 0.5 }, { wavelengthUm: NaN, y: 1, err: 1 }, { wavelengthUm: 2, y: null, err: 1 }, { wavelengthUm: 3, y: 1, err: undefined }];
  const s = bandSeries(pts);
  check("band: sorted by wavelength, upper = y + |err|, lower = y - |err|; points without a number are left out", s.x.filter((v) => v !== null).join() === "1.1,1.2,1.5,4.5,4.6" && s.upper[0] === 10 && s.lower[0] === 6 && s.upper[1] === 9.5 && s.lower[1] === 8.5);
  check("band: where no image covers a stretch of wavelength (more than 0.3 µm) a null is put in, so that the line and the band break there, and the gap is reported",
    s.x.includes(null) && s.x.indexOf(null) === 3 && s.y[3] === null && s.upper[3] === null && s.lower[3] === null && s.gaps.length === 1 && s.gaps[0][0] === 1.5 && s.gaps[0][1] === 4.5 && s.x.length === 6);
  check("band: no gap, no null; no usable point, no series", bandSeries([{ wavelengthUm: 1, y: 1, err: 1 }, { wavelengthUm: 1.1, y: 2, err: 1 }]).x.includes(null) === false && bandSeries([]).x.length === 0 && bandSeries(null).gaps.length === 0);
  check("band: the width of a gap is a parameter", bandSeries(pts, { maxGapUm: 5 }).gaps.length === 0 && bandSeries([{ wavelengthUm: 1, y: 1, err: 1 }, { wavelengthUm: 1.1, y: 2, err: 1 }], { maxGapUm: 0.05 }).gaps.length === 1);
}
{
  const m = missingSummary([{ flux: 5, flagged: false, wavelengthUm: 1.1 }, { flux: 6, flagged: true, wavelengthUm: 1.2 }, { flux: null, flagged: false, wavelengthUm: 1.3 }, { flux: 2, flagged: false, wavelengthUm: 4.5 }]);
  check("missing: counts of images, measured, without data and flagged", m.total === 4 && m.measured === 3 && m.noData === 1 && m.flagged === 1);
  check("missing: the sentence says what is missing and that it is never filled in, names the flagged one and the stretch nobody covers", /^3 of 4 images were measured here; 1 had no data at this position .* never filled in.*; 1 of the measurements is flagged .*; no image covers 1\.20–4\.50 µm: the spectrum is not drawn across it\.$/.test(m.text), m.text);
  const all = missingSummary([{ flux: null, flagged: false, wavelengthUm: 1 }, { flux: null, flagged: false, wavelengthUm: 2 }]);
  check("missing: nothing measured is said as such, and nothing is invented (no gaps from no points)", all.measured === 0 && all.noData === 2 && all.gaps.length === 0 && /^0 of 2 images were measured here; 2 had no data/.test(all.text) && missingSummary([]).text === "0 of 0 images were measured here." && missingSummary(undefined).total === 0);
  check("missing: two flagged is plural", /2 of the measurements are flagged/.test(missingSummary([{ flux: 1, flagged: true, wavelengthUm: 1 }, { flux: 1, flagged: true, wavelengthUm: 1.1 }]).text));
}
check("alpha: a hex colour with an opacity is an rgba colour; anything else is a grey", withAlpha("#3987e5", 0.28) === "rgba(57, 135, 229, 0.28)" && withAlpha("3987E5", 1) === "rgba(57, 135, 229, 1)" && withAlpha("blue", 0.5) === "rgba(128, 128, 128, 0.5)");

// ---------------------------------------------------------------- the traces of the spectrum
{
  const mk = (det, mjd, wl, flux, flagged = false) => ({ detector: det, mjd, dateISO: new Date((mjd - 40587) * 864e5).toISOString(), wavelengthUm: wl, wavelengthMinUm: wl - 0.01, wavelengthMaxUm: wl + 0.01, flux, fluxErr: 1, flagged });
  const points = [mk("D2", 60909, 1.1, 10), mk("D2", 60909.1, 1.2, 12), mk("D2", 60909.2, 1.3, 11), mk("D6", 60909.3, 4.5, 3), mk("D6", 60909.4, 4.6, 4), mk("D2", 61114, 1.15, 9), mk("D2", 61114.1, 1.25, null)];
  const bars = spectrumTraces(points, "flux", "bars"), band = spectrumTraces(points, "flux", "band"), none = spectrumTraces(points, "flux");
  check("spectrum: error bars are the default, one trace per pass, with the error bar on the points", bars.length === 2 && none.length === 2 && bars.every((t) => t.mode === "markers" && t.error_y && t.error_y.array.length === t.x.length));
  check("spectrum: the band style makes, for every pass, an upper edge, a lower edge that fills up to it, and the points without error bars", band.length === 6 && band[0].mode === "lines" && band[1].fill === "tonexty" && band[1].connectgaps === false && band[2].mode === "markers" && !("error_y" in band[2]) && band.filter((t) => t.showlegend === false).length === 4);
  check("spectrum: in the band style a gap in wavelength (1.3 to 4.5 µm: no image) is a break in the band, not a bridge; a point without data is left out", band[0].x.includes(null) && band[1].x.includes(null) && band[0].x.filter((v) => v !== null).join() === "1.1,1.2,1.3,4.5,4.6" && band[3].x.join() === "1.15" && bars.flatMap((t) => t.x).includes(1.25) === false);
  check("spectrum: a band is the flux plus and minus its error; its fill is the colour of the series, see-through", band[0].y[0] === 11 && band[1].y[0] === 9 && /^rgba\(\d+, \d+, \d+, 0\.28\)$/.test(band[1].fillcolor) && band[1].fillcolor !== band[4].fillcolor);
}

// ---------------------------------------------------------------- the page
{
  const HTML = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
  const MAIN = readFileSync(new URL("../frontend/js/main.js", import.meta.url), "utf8");
  const CSS = readFileSync(new URL("../frontend/css/styles.css", import.meta.url), "utf8");
  check("page: the choice of error bars or band is a pair of radio buttons in a fieldset with a legend, next to a line that says what is missing", /<fieldset class="chart-style" id="measure-style">\s*<legend>[^<]+<\/legend>[\s\S]*?value="bars" checked[\s\S]*?value="band"/.test(HTML) && HTML.includes('id="measure-missing"') && HTML.includes('id="measure-tools"'));
  check("page: main.js passes them to measure.js and switches the style", MAIN.includes('tools: $("measure-tools"), missing: $("measure-missing")') && MAIN.includes("setSpectrumStyle(r.value)"));
  check("page: the detector overview shows every detector: a missing one is a tile (not a button) saying 'no images here', with its band", MAIN.includes('tile.className = "overview-item is-missing"') && MAIN.includes("detectorCoverage(frames)") && !/detectors\.length < 2/.test(MAIN.slice(MAIN.indexOf("async function renderOverview"), MAIN.indexOf("function markOverview")))
    && CSS.includes(".overview-item.is-missing") && CSS.includes(".ov-blank"));
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failed ? 1 : 0;
