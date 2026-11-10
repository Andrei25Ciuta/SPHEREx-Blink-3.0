// Tests for the uncertainty budget (features/uncertainty.js) and the fields movers.js now keeps for it.   Run: node scratch/test_uncertainty.mjs
import { scenarios } from "./benchmark.mjs";
import { lineUncertainty, SYSTEMATIC_SIGMA_PX } from "../frontend/js/features/movers.js";
import { velocityBudget, candidateWarnings, budgetSentence, SCATTER_WARNING } from "../frontend/js/features/uncertainty.js";
import { candidateRows, CANDIDATE_COLUMNS } from "../frontend/js/features/textAnalysis.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- the parts of lineUncertainty
{
  const members = [0, 0.3, 0.6, 1.0].map((t) => ({ t, sigma: 0.05 }));
  const u = lineUncertainty(members, 0.02);                         // scatter below the model: no inflation
  check("lineUncertainty: gives its parts, and they rebuild vErr", Number.isFinite(u.vModel) && u.inflation === 1 && near(Math.hypot(u.vModel * u.inflation, u.systematicPx / Math.sqrt(u.sxx)), u.vErr, 1e-12));
  const w = lineUncertainty(members, 0.15);                         // scatter three times the model
  check("lineUncertainty: scatter above the model inflates, scatter below never shrinks", w.inflation > 2.5 && u.inflation === 1 && w.vErr > 2 * u.vErr * 0.9);
}

// ---------------------------------------------------------------- the budget of real search output
const { candidates } = scenarios()[1].run();
check("search: the injected mover is found, with the parts kept on the candidate", candidates.length >= 1 && candidates.every((c) => Number.isFinite(c.vModelPx) && Number.isFinite(c.inflation) && c.sxx > 0));
for (const c of candidates) {
  const b = velocityBudget(c, 6.14);
  check("budget: the parts add in quadrature to the reported error", b && b.consistent && near(b.calibratedPx, c.vErrPx, 1e-9 * Math.max(1, c.vErrPx)), b ? `${b.calibratedPx.toExponential(3)} vs ${c.vErrPx.toExponential(3)}` : "no budget");
  check("budget: shares sum to 1; calibrated is never below nominal", near(b.parts.reduce((s, p) => s + p.share, 0), 1, 1e-9) && b.calibratedPx >= b.nominalPx - 1e-12 && b.ratio >= 1);
  check("budget: arcsec = px x scale", near(b.calibratedArcsec, b.calibratedPx * 6.14, 1e-9));
}
{
  const c = { vModelPx: 0.2, vErrPx: 0.2, inflation: 1, sxx: 0.5, systematicPx: 0 };
  const b = velocityBudget(c);
  check("budget: no excess scatter and no floor = nominal; no scale = no arcsec", b.parts[1].px === 0 && b.parts[2].px === 0 && b.nominalArcsec === null);
  check("budget: an old result without the fields gives null, and the sentence says so", velocityBudget({ vErrPx: 1 }) === null && /before the budget existed/.test(budgetSentence(null)));
  const big = velocityBudget({ vModelPx: 0.1, vErrPx: Math.hypot(0.1 * 3, 0.04 / Math.sqrt(2)), inflation: 3, sxx: 2, systematicPx: 0.04 });
  check("budget: inflation 3 puts most of the error in the excess-scatter part", big.parts[1].share > 0.8 && big.consistent, big.parts.map((p) => p.share.toFixed(2)).join("/"));
  const s = budgetSentence(velocityBudget({ ...c, systematicPx: SYSTEMATIC_SIGMA_PX, vErrPx: Math.hypot(0.2, SYSTEMATIC_SIGMA_PX / Math.sqrt(0.5)) }, 6.14), "″/yr");
  check("budget: the sentence names all three parts and the unit", ["statistical", "excess scatter", "systematic", "″/yr"].every((x) => s.includes(x)), s);
}

// ---------------------------------------------------------------- warnings
{
  const ok = { nDet: 12, nFrames: 12, inflation: 1.1, significance: 40, falseAlarm: 1e-9, points: [{ frame: 0, x: 20, y: 20 }, { frame: 4, x: 21, y: 20 }, { frame: 8, x: 22, y: 20 }] };
  check("warnings: a clean candidate has none (that is not proof that it is real)", candidateWarnings(ok, { n: 49, passOf: [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2] }).length === 0);
  const w = candidateWarnings({ ...ok, nDet: 3, nFrames: 12, inflation: SCATTER_WARNING + 0.5, significance: 7, falseAlarm: 0.2, points: [{ frame: 0, x: 1, y: 20 }, { frame: 1, x: 47, y: 20 }, { frame: 2, x: 20, y: 20 }] }, { n: 49, passOf: [0, 0, 0] });
  const t = w.join(" | ");
  check("warnings: few dots, missing images, scatter, near threshold, chance lines, one pass, edge all fire", /only 3 detections/.test(t) && /3 of 12/.test(t) && /scatter/.test(t) && /close to the threshold/.test(t) && /chance lines/.test(t) && /1 survey pass:/.test(t) && /2 detections are within/.test(t), t);
  check("warnings: a null candidate gives an empty list", candidateWarnings(null).length === 0);
}

// ---------------------------------------------------------------- the table
{
  const rows = candidateRows(candidates.map((c, k) => ({ ...c, label: `#${k + 1}`, speedArcsecPerYear: 5, compass: "N" })), { scaleArcsec: 6.14, n: 49 });
  check("table: the candidate row carries the error, its parts and the warnings", rows.length >= 1 && /″\/yr per axis \(nominal/.test(rows[0].velocityError) && /statistical .*scatter .*systematic/.test(rows[0].errorParts) && typeof rows[0].warnings === "string");
  check("table: the CSV columns name them", ["velocityError", "errorParts", "warnings"].every((k) => CANDIDATE_COLUMNS.some(([c]) => c === k)));
  const old = candidateRows([{ label: "#1", nDet: 5, nFrames: 5, speedArcsecPerYear: 3 }]);
  check("table: a candidate from an older result says 'not available', not a number", old[0].velocityError === "not available");
}

console.log(failed ? `\n${failed} FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
