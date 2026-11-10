// Tests for the Planet X Lab (frontend/js/features/planetLab.js): the comparison of motions, the injection of a synthetic body into images, the completeness map.
// Everything here is synthetic (the lab is tested on ideal images; on real ones it is run by the author: docs/VALIDATION.md section 16).   Run: node scratch/test_planetlab.mjs
import {
  VERSION, K_PARAMS, bicStrength, ownDriftArcsecPerYear, swingArcsec, rangeAtDelta, modelComparison, observationsOf, injectDistantMover, matchesInjection,
  recoveryTrial, wilson, gridCells, runCompleteness, completenessWord, registrationOf, parseNumberList, cellText, completenessCsv,
} from "../frontend/js/features/planetLab.js";
import { readFileSync, existsSync } from "node:fs";
import { parallaxOffsetArcsec, logGrid } from "../frontend/js/features/parallax.js";
import { detectSources, moverPositionAtMjd } from "../frontend/js/features/movers.js";
import { mulberry32, renderStar, gaussianNoise } from "./lib_inject.mjs";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const RA = 136.5, DEC = 16.6;                                                  // the field of the Planet X demo
const DAYS = [0, 0.1, 0.2, 120, 120.1, 120.2, 250, 250.1, 250.2, 397, 397.1, 397.2];
const MJDS = DAYS.map((d) => 60908 + d);
const MID = (MJDS[0] + MJDS.at(-1)) / 2;
const SCALE = 6.14;

// ---------------------------------------------------------------- small pure helpers
check("lab: it has a version, written into its results", VERSION === "planetlab-1");
check("evidence words: DeltaBIC below 2 is no preference, then positive, strong, very strong (Kass & Raftery, from memory)", bicStrength(0) === "no real preference" && bicStrength(1.9) === "no real preference" && bicStrength(2) === "positive evidence"
  && bicStrength(5.9) === "positive evidence" && bicStrength(6) === "strong evidence" && bicStrength(9.9) === "strong evidence" && bicStrength(10) === "very strong evidence" && bicStrength(-3) === "no real preference" && bicStrength(NaN) === "no real preference");
{
  const d = ownDriftArcsecPerYear(500, 0.8);
  check("own drift: a body bound to the Sun at 500 AU on a circular orbit moves about 0.8 x 29.78/sqrt(500) = 1.07 km/s: 93 arcsec per year as seen from the Earth", near(d, 92.7, 0.6), d.toFixed(2));
  check("own drift: slower the farther it is", ownDriftArcsecPerYear(300) > ownDriftArcsecPerYear(600) && ownDriftArcsecPerYear(600) > ownDriftArcsecPerYear(2000) && ownDriftArcsecPerYear(500, 1) > ownDriftArcsecPerYear(500, 0.5));
}
{
  const s500 = swingArcsec(RA, DEC, MJDS, 500), s1000 = swingArcsec(RA, DEC, MJDS, 1000);
  check("swing: at 500 AU the Earth's orbit moves the body by several hundred arcsec between the dates, at 1000 AU about half as much", s500 > 300 && s500 < 900 && near(s500 / s1000, 2, 0.15), `${s500.toFixed(0)}, ${s1000.toFixed(0)}`);
}
{
  const scan = [{ distanceAU: 100, chi2: 9 }, { distanceAU: 200, chi2: 3 }, { distanceAU: 400, chi2: 1 }, { distanceAU: 800, chi2: 2.5 }, { distanceAU: 1600, chi2: 20 }];
  const r = rangeAtDelta(scan, scan[2], 4);
  check("range: the distances whose chi2 is within delta of the best, and whether either end is the edge of what was tried", r.lo === 200 && r.hi === 800 && !r.touchesLow && !r.touchesHigh
    && rangeAtDelta(scan, scan[2], 100).touchesLow && rangeAtDelta(scan, scan[2], 100).touchesHigh && rangeAtDelta(scan, scan[2], 1).lo === 400);
}

// ---------------------------------------------------------------- model comparison
const REF_DIST = 500;
/** positions (arcsec) of a body at `distanceAU` with a drift, on MJDS, with Gaussian noise of sigma arcsec. */
function observe({ distanceAU = Infinity, driftEast = 0, driftNorth = 0, sigma = 1, seed = 1, east0 = 0, north0 = 0, mjds = MJDS }) {
  const rng = mulberry32(seed);
  return mjds.map((mjd) => {
    const p = parallaxOffsetArcsec(RA, DEC, mjd, MID, distanceAU), dt = (mjd - MID) / 365.25;
    return { mjd, east: east0 + p.east + driftEast * dt + sigma * gaussianNoise(rng), north: north0 + p.north + driftNorth * dt + sigma * gaussianNoise(rng), sigma };
  });
}
{
  // noise alone gives a straight line a chi2 lower by more than the BIC penalty (4 x ln 24 - 2 x ln 24 = 6.4) about 4 % of the time: one seed proves nothing, so many are run
  let stationaryWins = 0, claimed = 0;
  for (let seed = 100; seed < 160; seed++) { const r = modelComparison(observe({ sigma: 1, seed }), { ra: RA, dec: DEC }); if (r.preferred === "stationary") stationaryWins++; if (r.distance.status === "constrained") claimed++; }
  check("models: an object that does not move: the stationary model wins in at least 90 % of 60 noise realisations, and a distance is claimed in none", stationaryWins >= 54 && claimed === 0, `${stationaryWins} of 60, ${claimed} distances`);
  const stationary = modelComparison(observe({ sigma: 1, seed: 101 }), { ra: RA, dec: DEC });
  check("models: one such object: stationary is the model with the smallest BIC when it wins, and its distance verdict is 'not claimed'", stationary.usable && stationary.distance.status === "not-claimed" && stationary.models.length === 3);
  const linear = modelComparison(observe({ driftEast: 60, driftNorth: -25, sigma: 1, seed: 3 }), { ra: RA, dec: DEC });
  check("models: a straight mover: the straight line wins over stationary (by far) and over parallax, no distance is claimed", linear.preferred === "linear" && linear.models.find((m) => m.id === "stationary").deltaBic > 100 && linear.distance.status === "not-claimed", `${linear.preferred}`);
  // found in the browser on real Barnard's Star: the table showed the 5-parameter parallax model fitting WORSE than the 4-parameter line (the scan tries finite distances only)
  let nested = true;
  for (let seed = 300; seed < 330; seed++) for (const o of [{ driftEast: 60 }, { distanceAU: 700, driftEast: 20 }, {}]) {
    const r = modelComparison(observe({ ...o, sigma: 1, seed }), { ra: RA, dec: DEC });
    const lin = r.models.find((x) => x.id === "linear"), par = r.models.find((x) => x.id === "parallax"), sta = r.models.find((x) => x.id === "stationary");
    if (par.chi2 > lin.chi2 + 1e-9 || lin.chi2 > sta.chi2 + 1e-9) nested = false;
  }
  check("models: the models are nested, so a model with more parameters never has a larger chi2 (stationary >= straight line >= parallax), in 90 noise realisations", nested);
  const swing = modelComparison(observe({ distanceAU: 500, driftEast: 60, driftNorth: -25, sigma: 3, seed: 4 }), { ra: RA, dec: DEC });
  const best = swing.models.find((m) => m.id === "parallax");
  check("models: a body at 500 AU with a drift: the parallax model wins, very strongly, over the straight line", swing.preferred === "parallax" && swing.strength === "very strong evidence" && swing.models.find((m) => m.id === "linear").deltaBic >= 10, `${swing.preferred}, ${swing.strength}`);
  check("models: its distance is constrained, within 2 % of the truth, and the 68 % range lies inside the 95 % range", swing.distance.status === "constrained" && near(swing.distance.bestAU, 500, 10)
    && swing.distance.range68AU[0] >= swing.distance.range95AU[0] && swing.distance.range68AU[1] <= swing.distance.range95AU[1] && swing.distance.range95AU[1] > swing.distance.range95AU[0], JSON.stringify(swing.distance));
  let covered68 = 0, covered95 = 0, usable = 0;
  for (let seed = 200; seed < 260; seed++) {
    const r = modelComparison(observe({ distanceAU: 500, driftEast: 60, driftNorth: -25, sigma: 3, seed }), { ra: RA, dec: DEC });
    if (r.distance.status !== "constrained") continue;
    usable++;
    if (r.distance.range68AU[0] <= 500 && 500 <= r.distance.range68AU[1]) covered68++;
    if (r.distance.range95AU[0] <= 500 && 500 <= r.distance.range95AU[1]) covered95++;
  }
  check("models: the ranges say what they claim: over 60 noise realisations the 95 % range holds the true distance at least 85 % of the time and the 68 % range at least 55 % (and more often than not narrower)", usable >= 55 && covered95 / usable >= 0.85 && covered68 / usable >= 0.55 && covered68 <= covered95, `${covered68}/${usable} (68 %), ${covered95}/${usable} (95 %)`);
  check("models: the parallax model is the best of the three by BIC and has dof = 2 x 12 - 5 = 19", best.deltaBic === 0 && best.dof === 19 && swing.N === 24);
  const noisy = modelComparison(observe({ distanceAU: 8000, driftEast: 20, driftNorth: 5, sigma: 15, seed: 5 }), { ra: RA, dec: DEC });
  check("models: a body so far that its swing is lost in the noise gets no distance (not-claimed, a limit or unconstrained), never a made-up number", ["not-claimed", "lower-limit", "unconstrained"].includes(noisy.distance.status) && !("bestAU" in noisy.distance), noisy.distance.status);
  const far = modelComparison(observe({ distanceAU: 3000, driftEast: 30, driftNorth: 5, sigma: 2.5, seed: 6 }), { ra: RA, dec: DEC });
  check("models: at 3000 AU with good positions the answer is either constrained around 3000 or a lower limit above 1000: never a distance far from the truth", (far.distance.status === "constrained" && near(far.distance.bestAU / 3000, 1, 0.5)) || (far.distance.status === "lower-limit" && far.distance.lowerAU > 1000) || far.distance.status === "not-claimed" || far.distance.status === "unconstrained", `${far.distance.status} ${far.distance.bestAU ?? far.distance.lowerAU ?? ""}`);
  check("models: fewer than 3 positions: not usable, and it says why", modelComparison(observe({}).slice(0, 2), { ra: RA, dec: DEC }).usable === false && /at least 3/.test(modelComparison([], { ra: RA, dec: DEC }).reason));
  const s = modelComparison(observe({ driftEast: 60, sigma: 1, seed: 7 }), { ra: RA, dec: DEC });
  const mod = s.models.find((m) => m.id === "linear");
  check("models: BIC is chi2 + k ln N with k = 2, 4, 5 and N = 24", Object.entries(K_PARAMS).every(([id, k]) => { const m = s.models.find((x) => x.id === id); return near(m.bic, m.chi2 + k * Math.log(24), 1e-9) && m.params === k; }) && near(mod.reducedChi2, mod.chi2 / mod.dof, 1e-12));
  const tooSure = modelComparison(observe({ driftEast: 60, sigma: 6, seed: 8 }).map((o) => ({ ...o, sigma: 0.5 })), { ra: RA, dec: DEC });
  check("models: when the errors given are far too small, even the best model fits badly and the note says so", tooSure.notes.some((t) => /fits badly/.test(t)), tooSure.notes.join(" | "));
  const few = modelComparison(observe({ driftEast: 60, sigma: 1, seed: 9, mjds: MJDS.slice(0, 4) }), { ra: RA, dec: DEC });
  check("models: with 4 positions the parallax model has 3 degrees of freedom or fewer and a note warns that the comparison is weak", few.notes.some((t) => /Only 4 positions/.test(t)) && few.models.find((m) => m.id === "parallax").dof === 3);
  const tiny = modelComparison(observe({ driftEast: 60, sigma: 1, seed: 9, mjds: MJDS.slice(0, 3) }), { ra: RA, dec: DEC });
  check("models: with 3 positions the parallax model (5 parameters, 6 numbers) is usable with 1 degree of freedom and is never called better by a made-up margin", tiny.usable && tiny.models.find((m) => m.id === "parallax").dof === 1 && tiny.models.every((m) => Number.isFinite(m.bic)));
}
{
  const pts = [{ frame: 0, x: 10, y: 20 }, { frame: 2, x: 12, y: 21 }, { frame: 9, x: 1, y: 1 }, { frame: 1, x: NaN, y: 3 }];
  const obs = observationsOf(pts, [60000, 60001, 60002], 6, { sigmaPx: 0.2 });
  check("observations: dots to positions in arcsec (east is left: x grows to the west), on the date of their image, with the error of a dot; unusable dots are dropped",
    obs.length === 2 && obs[0].east === -60 && obs[0].north === -120 && obs[0].mjd === 60000 && obs[1].mjd === 60002 && near(obs[0].sigma, 1.2, 1e-12));
}

// ---------------------------------------------------------------- injection
const N = 293;                                                                    // a 30 arcmin field at 6.14 arcsec per pixel
const GEO = { ra: RA, dec: DEC, n: N, scaleArcsec: SCALE };
const ZERO = MJDS.map(() => ({ dx: 0, dy: 0 }));
function blankArrays() { return MJDS.map(() => new Float32Array(N * N)); }
{
  const arrays = blankArrays();
  const spec = { distanceAU: 800, fluxMilliJy: 50, fx: 0.5, fy: 0.5, driftEast: 10, driftNorth: -5 };
  const { arrays: out, truth } = injectDistantMover({ arrays, mjds: MJDS, geo: GEO, spec, shifts: ZERO });
  const omega = (SCALE / 206264.806) ** 2, expectedSum = 50 / (omega * 1e9);
  const sums = out.map((img) => img.reduce((a, b) => a + b, 0));
  check("inject: the real images are copied, never changed", arrays.every((a) => a.every((v) => v === 0)) && out[0] !== arrays[0]);
  check("inject: the light added is the flux asked for, converted with the solid angle of a pixel (mJy -> MJy/sr x pixels), on every image", sums.every((s) => near(s / expectedSum, 1, 0.005)), `${(sums[0] / expectedSum).toFixed(4)}`);
  const mid = MJDS.findIndex((m) => m >= MID);
  const k = MJDS.length - 1, dt = (MJDS[k] - MID) / 365.25, par = parallaxOffsetArcsec(RA, DEC, MJDS[k], MID, 800);
  check("inject: the place on an image is the middle place minus the swing and the drift in pixels (east is left, north is up), plus the pointing shift",
    near(truth[k].x, 0.5 * N - (par.east + 10 * dt) / SCALE, 1e-9) && near(truth[k].y, 0.5 * N - (par.north - 5 * dt) / SCALE, 1e-9));
  const shifted = injectDistantMover({ arrays, mjds: MJDS, geo: GEO, spec, shifts: MJDS.map((_, i) => ({ dx: 0.5 * i, dy: -0.25 * i })) });
  check("inject: the pointing shift of each exposure is added to where the body is (it moves with the field stars)", MJDS.every((_, i) => near(shifted.truth[i].x - truth[i].x, 0.5 * i, 1e-9) && near(shifted.truth[i].y - truth[i].y, -0.25 * i, 1e-9)));
  const peak = (img, p) => img[Math.floor(p.y) * N + Math.floor(p.x)];
  check("inject: the light is where the truth says (the brightest pixel of each image is the pixel of the truth)", out.every((img, i) => {
    let bi = 0; for (let q = 1; q < img.length; q++) if (img[q] > img[bi]) bi = q;
    return Math.abs((bi % N) - Math.floor(truth[i].x)) <= 1 && Math.abs(Math.floor(bi / N) - Math.floor(truth[i].y)) <= 1;
  }) && peak(out[0], truth[0]) > 0);
  const edge = injectDistantMover({ arrays, mjds: MJDS, geo: GEO, spec: { ...spec, fx: 0, fy: 0.5, distanceAU: 1e6, driftEast: 0, driftNorth: 0 }, shifts: ZERO });
  const edgeSum = edge.arrays[0].reduce((a, b) => a + b, 0) / expectedSum;
  check("inject: a body on the very edge of the image keeps about half of its light (the rest falls outside: it is not wrapped round or invented)", edgeSum > 0.4 && edgeSum < 0.6, edgeSum.toFixed(3));
  const withNaN = blankArrays(); withNaN[0][Math.floor(truth[0].y) * N + Math.floor(truth[0].x)] = NaN;
  const holes = injectDistantMover({ arrays: withNaN, mjds: MJDS, geo: GEO, spec, shifts: ZERO });
  check("inject: a pixel without data stays without data", Number.isNaN(holes.arrays[0][Math.floor(truth[0].y) * N + Math.floor(truth[0].x)]));
}
{
  const truth = MJDS.map((m, k) => ({ x: 100 + 5 * k, y: 120 - 2 * k }));
  const cand = { x: 100, y: 120, vx: 0, vy: 0, mjdRef: MJDS[0], distanceAU: 600, shifts: truth.map((t, k) => ({ dx: t.x - 100, dy: t.y - 120 })) };
  const ok = matchesInjection(cand, truth, MJDS, 600), off = matchesInjection({ ...cand, x: 160 }, truth, MJDS, 600);
  check("match: a candidate whose places on the images are the injected ones is the body, with the right distance", ok.found && ok.distanceRight);
  check("match: one 60 pixels away is not", !off.found && !off.distanceRight);
  check("match: found with a distance 2.5 times too large: found, but the distance is not right; 1.4 times is right", matchesInjection({ ...cand, distanceAU: 1500 }, truth, MJDS, 600).found && !matchesInjection({ ...cand, distanceAU: 1500 }, truth, MJDS, 600).distanceRight && matchesInjection({ ...cand, distanceAU: 840 }, truth, MJDS, 600).distanceRight);
  const half = { ...cand, shifts: cand.shifts.map((s, k) => (k % 2 ? { dx: s.dx + 50, dy: s.dy } : s)) };
  check("match: right on half of the images is still found (at least half), wrong on most is not", matchesInjection(half, truth, MJDS, 600).found && !matchesInjection({ ...cand, shifts: cand.shifts.map((s, k) => (k < 9 ? { dx: s.dx + 50, dy: s.dy } : s)) }, truth, MJDS, 600).found);
}

// ---------------------------------------------------------------- statistics and the map
{
  const [lo0, hi0] = wilson(0, 10), [lo1, hi1] = wilson(10, 10), [lo5, hi5] = wilson(5, 10);
  check("wilson: 0 of 10 does not claim certainty (the upper end is about 0.28), 10 of 10 the same from above, 5 of 10 is centred", lo0 === 0 && near(hi0, 0.278, 0.005) && hi1 === 1 && near(lo1, 0.722, 0.005) && near((lo5 + hi5) / 2, 0.5, 0.01) && lo5 > 0.2 && hi5 < 0.8);
  check("wilson: no tries is the whole range; more tries give a narrower interval", wilson(0, 0)[0] === 0 && wilson(0, 0)[1] === 1 && (wilson(50, 100)[1] - wilson(50, 100)[0]) < (wilson(5, 10)[1] - wilson(5, 10)[0]));
  const cells = gridCells([300, 600, 1200], [1, 10, 100]);
  check("grid: one cell per distance and brightness, the brightest row first, columns by distance, all counters at 0", cells.length === 9 && cells[0].fluxMilliJy === 100 && cells[0].distanceAU === 300 && cells[8].fluxMilliJy === 1 && cells[8].distanceAU === 1200
    && cells.every((c) => c.tries === 0 && c.found === 0 && c.distanceRight === 0) && cells[4].row === 1 && cells[4].col === 1);
  check("completeness words: none, some, most, all or nearly all, not run", completenessWord(0) === "none" && completenessWord(0.2) === "some" && completenessWord(0.5) === "most" && completenessWord(0.95) === "all or nearly all" && completenessWord(null) === "not run");
}
{
  const specs = []; const progress = [];
  const run = (spec) => { specs.push(spec); return { found: spec.fluxMilliJy >= 10 && spec.distanceAU <= 1000, distanceRight: spec.fluxMilliJy >= 100 && spec.distanceAU <= 1000 }; };
  const res = await runCompleteness({ distancesAU: [300, 600, 2000], fluxesMilliJy: [1, 10, 100], trials: 4, rng: mulberry32(5), run, onProgress: (d, t, c) => progress.push([d, t, c.row, c.col]) });
  const at = (row, col) => res.cells.find((c) => c.row === row && c.col === col);
  check("completeness run: 9 cells x 4 tries are run and reported one by one, to the end", res.finished && res.done === 36 && res.total === 36 && specs.length === 36 && progress.length === 36 && progress.at(-1)[0] === 36 && progress[0][0] === 1);
  check("completeness run: the counts follow what the stand-in found: faint cells 0, bright and near cells all, bright and far cells 0", at(0, 0).found === 4 && at(0, 1).found === 4 && at(0, 2).found === 0 && at(1, 0).found === 4 && at(2, 0).found === 0 && at(2, 2).found === 0 && at(0, 0).distanceRight === 4 && at(1, 0).distanceRight === 0);
  check("completeness run: the fractions and their Wilson intervals are filled in (4 of 4 is not 'certain': the interval stops at 1, its lower end is below 1)", at(0, 0).fraction === 1 && at(0, 0).interval[1] === 1 && at(0, 0).interval[0] < 0.6 && at(2, 2).fraction === 0 && at(2, 2).interval[0] === 0 && at(2, 2).interval[1] > 0.3);
  check("completeness run: every try gets a fresh place inside the middle half of the field and a drift between 0.5 and 1 times that of a circular orbit, in some direction",
    specs.every((s) => s.fx >= 0.25 && s.fx <= 0.75 && s.fy >= 0.25 && s.fy <= 0.75) && new Set(specs.map((s) => s.fx.toFixed(4))).size > 30
    && specs.every((s) => { const d = Math.hypot(s.driftEast, s.driftNorth); return d >= 0.5 * ownDriftArcsecPerYear(s.distanceAU, 1) - 1e-9 && d <= ownDriftArcsecPerYear(s.distanceAU, 1) + 1e-9; }));
  const withRms = await runCompleteness({ distancesAU: [300], fluxesMilliJy: [10, 1], trials: 4, rng: mulberry32(2), run: (s) => ({ found: s.fluxMilliJy >= 10, distanceRight: true, rms: s.fluxMilliJy >= 10 ? [0.04, 0.06, 0.08, 0.10][0] + 0 : null }) });
  const strong = withRms.cells.find((c) => c.fluxMilliJy === 10), weak = withRms.cells.find((c) => c.fluxMilliJy === 1);
  check("completeness run: the model rms of every found body is kept per cell, and its median is given (null where nothing was found)", strong.rms.length === 4 && strong.rmsMedian === 0.04 && weak.rms.length === 0 && weak.rmsMedian === null);
  let seq = 0; const odd = await runCompleteness({ distancesAU: [300], fluxesMilliJy: [10], trials: 4, rng: mulberry32(2), run: () => ({ found: true, distanceRight: true, rms: [0.10, 0.04, 0.08, 0.06][seq++] }) });
  check("completeness run: the median of four values is the mean of the middle two", near(odd.cells[0].rmsMedian, 0.07, 1e-12), String(odd.cells[0].rmsMedian));
  let count = 0;
  const cut = await runCompleteness({ distancesAU: [300, 600], fluxesMilliJy: [1, 10], trials: 5, rng: mulberry32(6), run: () => ({ found: true, distanceRight: true }), stop: () => count++ >= 7 });
  check("completeness run: stopping part-way returns what was done, says it did not finish, and only the cells reached have tries", !cut.finished && cut.done === 7 && cut.cells.filter((c) => c.tries > 0).length === 2 && cut.cells.filter((c) => c.tries === 0).every((c) => c.fraction === null));
  const again = await runCompleteness({ distancesAU: [300, 600], fluxesMilliJy: [1, 10], trials: 3, rng: mulberry32(5), run });
  const again2 = await runCompleteness({ distancesAU: [300, 600], fluxesMilliJy: [1, 10], trials: 3, rng: mulberry32(5), run });
  check("completeness run: the same seed gives the same cells (a run can be repeated)", JSON.stringify(again.cells) === JSON.stringify(again2.cells));
}

// ---------------------------------------------------------------- what a person types, the CSV, and the page
{
  const ok = parseNumberList("300, 600 1200;2400", { min: 50, max: 20000 });
  check("numbers typed: commas, spaces and semicolons separate, the list is sorted and has no repeats", same(ok.values, [300, 600, 1200, 2400]) && ok.error === "" && same(parseNumberList("900 300 300 600").values, [300, 600, 900]));
  check("numbers typed: nothing, a word, a number out of range and too many each give a sentence and no numbers",
    parseNumberList("").error.length > 5 && parseNumberList("  ,, ").values.length === 0 && /not a number/.test(parseNumberList("12, abc").error) && /outside 50–20000/.test(parseNumberList("10, 100", { min: 50, max: 20000 }).error)
    && /At most 3/.test(parseNumberList("1 2 3 4", { maxCount: 3 }).error) && parseNumberList("1e3 2.5e2").values.join() === "250,1000" && parseNumberList("Infinity").values.length === 0);
  check("cell text: found / tries, a dash when not run", cellText({ tries: 10, found: 7 }) === "7 / 10" && cellText({ tries: 0, found: 0 }) === "–");
  const cells = [{ distanceAU: 800, fluxMilliJy: 10, tries: 4, found: 3, distanceRight: 2, fraction: 0.75, interval: wilson(3, 4) }, { distanceAU: 1600, fluxMilliJy: 10, tries: 0, found: 0, distanceRight: 0, fraction: null, interval: null }];
  const csv = completenessCsv(cells, { lab: "planetlab-1", note: "a  b\nc" });
  const lines = csv.trim().split("\n");
  check("CSV: the provenance first as # comments (one line each, newlines inside a value folded), then the header and one row per cell, a cell not run has empty numbers",
    lines[0] === "# lab: planetlab-1" && lines[1] === "# note: a b c" && lines[2].startsWith("distance_au,flux_mjy,tries,found") && lines.length === 5 && lines[3].startsWith("800,10,4,3,2,0.7500,") && lines[4] === "1600,10,0,0,0,,,");
}
{
  const HTML = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
  const MAIN = readFileSync(new URL("../frontend/js/main.js", import.meta.url), "utf8");
  const CSS = readFileSync(new URL("../frontend/css/styles.css", import.meta.url), "utf8");
  const wired = [...(/setupPlanetLab\(\{\s*els: \{([\s\S]*?)\},\s*canRun/.exec(MAIN)?.[1] ?? "").matchAll(/\$\("([\w-]+)"\)/g)].map((m) => m[1]);
  check("page: main.js wires the lab to ids that exist in index.html, and the lab section sits after section 4 and before the end of the workspace", wired.length >= 17 && wired.every((id) => HTML.includes(`id="${id}"`)) && HTML.indexOf('id="planet-lab"') > HTML.indexOf('id="context-title"') && HTML.indexOf('id="planet-lab"') < HTML.indexOf("</main>"), wired.filter((id) => !HTML.includes(`id="${id}"`)).join(", "));
  check("page: the worker the view starts exists, is a module worker, and has no DOM or network code", existsSync(new URL("../frontend/js/planetLabWorker.js", import.meta.url)) && /new Worker\(new URL\("\.\.\/planetLabWorker\.js", import\.meta\.url\), \{ type: "module" \}\)/.test(readFileSync(new URL("../frontend/js/features/planetLabView.js", import.meta.url), "utf8"))
    && !/document\.|window\.|fetch\(/.test(readFileSync(new URL("../frontend/js/planetLabWorker.js", import.meta.url), "utf8")));
  check("page: the lab says in words that the injected bodies are synthetic and that it finds nothing", /synthetic/i.test(HTML.slice(HTML.indexOf('id="planet-lab"'))) && /it does not find anything/.test(HTML));
  check("page: the CSS lays the lab out full width and styles the map cells with the share (--f) and tokens only", CSS.includes(".lab { grid-column: 1 / -1; }") && CSS.includes("var(--f, 0)") && !/\.lab[^{]*\{[^}]*#[0-9a-f]{3,6}/i.test(CSS));
  check("main.js: the dots of a candidate and their dates are kept for the lab (dots, dotDates, attachDotDates in both searches)", /dots: c\.points/.test(MAIN) && (MAIN.match(/attachDotDates\(result\.candidates, frames\)/g) || []).length === 2);
}

// ---------------------------------------------------------------- the whole chain on synthetic images: inject, detect, search, count
{
  const rng = mulberry32(21);
  const stars = Array.from({ length: 40 }, () => ({ x: 15 + rng() * (N - 30), y: 15 + rng() * (N - 30), flux: 60 + rng() * 240 }));
  const arrays = MJDS.map((_, k) => renderStar(N, 0, 0, 0, 0.4, rng, { noise: 1, extra: stars.map((s) => ({ x: s.x + 0.7 * Math.sin(k), y: s.y - 0.5 * Math.cos(k), flux: s.flux })) }));
  const frames0 = arrays.map((a, k) => ({ mjd: MJDS[k], sources: detectSources(a, N, { sigmaFloor: 1e-9 }) }));
  const shifts = registrationOf(frames0);
  check("registration: the pointing shifts of the synthetic exposures are found (a shift of about 0.7 px in x between the extremes)", shifts.length === 12 && shifts.some((s) => Math.abs(s.dx) > 0.2), JSON.stringify(shifts.slice(0, 3)));
  const context = { arrays, masks: null, mjds: MJDS, geo: GEO, shifts, detectOptions: { sigmaFloor: 1e-9 } };
  const bright = recoveryTrial(context, { distanceAU: 800, fluxMilliJy: 40, fx: 0.5, fy: 0.5, driftEast: 20, driftNorth: -8 });
  const none = recoveryTrial(context, { distanceAU: 800, fluxMilliJy: 0.3, fx: 0.5, fy: 0.5, driftEast: 20, driftNorth: -8 });
  check("recovery trial: a bright body at 800 AU injected into the images is found by the app's own search, with the right distance", bright.found && bright.distanceRight, JSON.stringify(bright));
  check("recovery trial: a body far below the noise is not found (and the search does not invent one)", !none.found && !none.distanceRight, JSON.stringify(none));
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failed ? 1 : 0;
