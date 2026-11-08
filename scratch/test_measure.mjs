// Tests for measure.js pure helpers + mock photometry. Run: node scratch/test_measure.mjs
import { groupIntoPasses, errOf } from "../frontend/js/features/measure.js";
import { canvasToSky, skyToCanvas, mjdToYear } from "../frontend/js/geometry.js";
import { TARGETS, positionAtEpoch, targetsInField } from "../frontend/js/targets.js";
import { aperturePhotometry } from "../frontend/js/data/mockSource.js";

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

// Centre click -> exactly the query position.
let s = canvasToSky(0.5, 0.5, { ra: 133.7951, dec: -7.2451, n: 48, scaleArcsec: 6.25 });
ok(Math.abs(s.ra - 133.7951) < 1e-9 && Math.abs(s.dec + 7.2451) < 1e-9, "centre click = query position");
// One pixel to the RIGHT = 6.25" WEST = RA smaller; one pixel UP = NORTH = Dec larger.
s = canvasToSky(0.5 + 1 / 48, 0.5 - 1 / 48, { ra: 133.7951, dec: -7.2451, n: 48, scaleArcsec: 6.25 });
ok(Math.abs(s.eastArcsec + 6.25) < 1e-6 && Math.abs(s.northArcsec - 6.25) < 1e-6, "right = west, up = north (6.25\")");
ok(s.ra < 133.7951 && s.dec > -7.2451, "RA decreases to the right, Dec increases upward");
// RA wrap-around near 0.
s = canvasToSky(0, 0.5, { ra: 0.001, dec: 0, n: 100, scaleArcsec: 6 });
ok(s.ra > 0 && s.ra < 360, `RA stays in [0,360): ${s.ra.toFixed(4)}`);

// Survey passes: gaps > 30 days split.
const pts = [60800, 60801, 60805, 60983, 60985, 61166].map((mjd) => ({ mjd, dateISO: "2025-05-05T00:00:00Z" }));
ok(groupIntoPasses(pts).map((p) => p.points.length).join(",") === "3,2,1", "passes split at > 30 day gaps");

// Aperture photometry: a flat background + one bright pixel block.
const size = 30, img = new Float32Array(size * size).fill(10);
img[15 * size + 15] += 100; img[15 * size + 14] += 50;
const m = aperturePhotometry(img, size, 15.5, 15.5, 2);
ok(Math.abs(m.flux - 150) < 1e-6, `aperture recovers injected flux 150 (got ${m.flux})`);
ok(aperturePhotometry(img, size, 0.5, 0.5, 2) !== null, "works near (not over) the edge");
ok(aperturePhotometry(img, size, -20, -20, 2) === null, "returns null fully outside");
// ---- geometry.js + targets.js (predicted track)
const geo = { ra: 133.75976, dec: -7.24219, n: 49, scaleArcsec: 6.2 };
for (const [fx, fy] of [[0.5, 0.5], [0.1, 0.9], [0.83, 0.27]]) {
  const sky = canvasToSky(fx, fy, geo);
  const back = skyToCanvas(sky.ra, sky.dec, geo);
  ok(Math.abs(back.fx - fx) < 1e-9 && Math.abs(back.fy - fy) < 1e-9, `skyToCanvas inverts canvasToSky at (${fx}, ${fy})`);
}
const wrap = skyToCanvas(359.999, 0, { ra: 0.001, dec: 0, n: 100, scaleArcsec: 6 });
ok(wrap.fx > 0.5 && wrap.fx < 0.52, `RA wrap: 359.999° is just WEST (right) of 0.001° (fx=${wrap.fx.toFixed(4)})`);
ok(Math.abs(mjdToYear(51544.5) - 2000) < 1e-12 && Math.abs(mjdToYear(51544.5 + 365.25) - 2001) < 1e-12, "mjdToYear: J2000 = MJD 51544.5, Julian years");

const wise = TARGETS.find((t) => t.id === "wise0855");
const c26 = positionAtEpoch(wise, 2026.0);
ok(targetsInField(c26.ra, c26.dec, 5, 2026.0).map((t) => t.id).join() === "wise0855", "WISE 0855 found in its own 5′ field");
ok(targetsInField(c26.ra + 1, c26.dec, 5, 2026.0).length === 0, "nothing found 1° away");
// One year of WISE 0855 motion = 8.15"/yr -> on a 6.2"/px image about 1.3 px, mostly to the RIGHT (west).
const a = positionAtEpoch(wise, 2025.5), b = positionAtEpoch(wise, 2026.5);
const pa = skyToCanvas(a.ra, a.dec, geo), pb = skyToCanvas(b.ra, b.dec, geo);
const dxPx = (pb.fx - pa.fx) * geo.n, dyPx = (pb.fy - pa.fy) * geo.n;
ok(Math.abs(Math.hypot(dxPx, dyPx) - 8.151 / 6.2) < 0.01, `WISE 0855 moves ${Math.hypot(dxPx, dyPx).toFixed(3)} px/yr (expected 1.315)`);
ok(dxPx > 1.2 && dyPx < 0, "…towards the right (west, pmra < 0) and slightly up (north, pmdec > 0)");

// ---- the error bar of the spectrum: the calibrated error of the backend when there is one
ok(errOf({ fluxErr: 4, fluxErrCal: 1.5 }, "flux") === 1.5 && errOf({ fluxJyErr: 8e-6, fluxJyErrCal: 3e-6 }, "fluxJy") === 3e-6, "errOf: takes the calibrated error (fluxErrCal, fluxJyErrCal) when the backend gives it");
ok(errOf({ fluxErr: 4 }, "flux") === 4 && errOf({ fluxJyErr: 8e-6 }, "fluxJy") === 8e-6, "errOf: the mock and old answers have only the plain error, which is used");
ok(errOf({}, "flux") === 0 && errOf({ fluxErr: null, fluxErrCal: null }, "flux") === 0 && errOf({ fluxErrCal: 0, fluxErr: 5 }, "flux") === 0, "errOf: no error is 0 (no bar), and a calibrated error of 0 is respected, not replaced");

process.exit(fails ? 1 : 0);
