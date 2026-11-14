// Tests for features/predict.js (the "Predicting objects" panel).   Run: node scratch/test_predict.mjs
import { predictAt, predictPath, daysUntilOutside, mjdToDate, reliabilityNote, motionOf, HORIZONS } from "../frontend/js/features/predict.js";

let failed = 0;
const check = (name, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  – " + d : ""}`); if (!ok) failed++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const SCALE = 6.2;                                                         // arcsec per pixel
const star = { ra: 269.4462, dec: 4.769, mjdRef: 61000, pmEastArcsecPerYear: -0.8, pmNorthArcsecPerYear: 10.3, vErrPx: 0.01, posErrPx: 0.1 };

const p0 = predictAt(star, 0, SCALE);
check("at the reference date the prediction is the measured position, with the position error only", near(p0.ra, star.ra, 1e-12) && near(p0.dec, star.dec, 1e-12) && near(p0.sigma, 0.62, 1e-9));
const p1 = predictAt(star, 365.25, SCALE);
check("after one year it has moved by the measured motion", near(p1.north, 10.3, 1e-9) && near(p1.east, -0.8, 1e-9) && near((p1.dec - star.dec) * 3600, 10.3, 1e-6));
check("east motion turns into RA with cos(Dec)", near((p1.ra - star.ra) * 3600 * Math.cos(((star.dec + p1.dec) / 2) * Math.PI / 180), -0.8, 1e-6));
const p10 = predictAt(star, 3652.5, SCALE);
check("the uncertainty grows with time: sqrt(pos^2 + (vErr*t)^2)", near(p10.sigma, Math.hypot(0.62, 0.062 * 10), 1e-9) && p10.sigma > p1.sigma && p1.sigma > p0.sigma);
check("a path is a list of points from start to end", predictPath(star, SCALE, 0, 365.25, 10).length === 11);
check("no motion or no position means no prediction", predictAt({ ra: 1, dec: 1, mjdRef: 1 }, 10, SCALE) === null && motionOf(null) === null);
check("velocity in pixels is used when the arcsecond motion is missing (east is -x, north is -y)", near(predictAt({ ra: 10, dec: 0, mjdRef: 0, vx: -1, vy: -2 }, 365.25, 2).north, 4, 1e-9));
check("no velocity error means the uncertainty is reported as unknown", predictAt({ ...star, vErrPx: undefined }, 365, SCALE).sigma === null);
const leave = daysUntilOutside(star, SCALE, star.ra, star.dec, 5);
check("a star at the centre of a 5′ field moving 10.3″/yr leaves it after about 150″/10.3 years", near(leave / 365.25, 150 / 10.3, 0.05));
check("RA wraps around 0h", predictAt({ ra: 359.9999, dec: 0, mjdRef: 0, pmEastArcsecPerYear: 3600, pmNorthArcsecPerYear: 0 }, 365.25, 1).ra < 1);
check("MJD to calendar date", mjdToDate(51544) === "2000-01-01" && mjdToDate(61000) === "2025-11-21");
check("horizons from one month to ten years", HORIZONS.length === 5 && HORIZONS[0].days === 30 && HORIZONS.at(-1).days === 3652.5);
check("the caveat changes with the kind of object", /steady/.test(reliabilityNote(star, SCALE)) && /swings/.test(reliabilityNote({ ...star, distant: {} }, SCALE)) && /curves/.test(reliabilityNote({ ...star, pmNorthArcsecPerYear: 9000 }, SCALE)));

console.log(failed ? `FAIL  ${failed} check(s) failed` : "PASS  all prediction checks");
process.exit(failed ? 1 : 0);
