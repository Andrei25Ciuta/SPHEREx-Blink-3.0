import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { earthPositionAU, fitParallax } from "../frontend/js/features/parallax.js";

// Earth - Sun heliocentric J2000 position in AU. Reference Astropy 8.0.2, UTC MJD, builtin ERFA ephemeris.
for (const [mjd, ref] of [
  [60800, [-0.7203947432, -0.6475182658, -0.2806852931]],
  [60983, [0.7432049281, 0.6026068466, 0.2612134774]],
  [61168, [-0.6874030173, -0.6778538173, -0.2938310514]],
]) {
  const error = Math.hypot(...earthPositionAU(mjd).map((v, i) => v - ref[i]));
  assert.ok(error < 0.0005, `Earth offset ${error} AU on MJD ${mjd}`);
}
const text = readFileSync(new URL("../frontend/data/parallax_example.csv", import.meta.url), "utf8");
const obs = text.trim().split(/\r?\n/).slice(1).map(line => {
  const [mjd, east, north, sigma] = line.split(",").map(Number);
  return { mjd, east, north, sigma };
});
const opts = { ra: 45, dec: 10, mjdRef: (obs[0].mjd + obs.at(-1).mjd) / 2 };
const fit = fitParallax(obs, opts);
assert.ok(Math.abs(fit.best.distanceAU - 600) < 3);
assert.ok(fit.best.chi2 < fit.linear.chi2 && fit.linear.chi2 < fit.stationary.chi2);
assert.ok(fit.profileAU[0] < fit.best.distanceAU && fit.profileAU[1] > fit.best.distanceAU);
for (const edge of fit.profileAU) {
  const boundary = fitParallax(obs, { ...opts, distancesAU: [edge, edge * 1.00001] }).scan[0];
  assert.ok(Math.abs(boundary.chi2 - fit.best.chi2 - 1) < 1e-6);
}
const fixed = obs.map(o => ({ ...o, east: 3, north: -4 }));
assert.equal(fitParallax(fixed, opts).profileAU[1], null);
assert.throws(() => fitParallax(obs.map(o => ({ ...o, mjd: 60800 })), opts), RangeError);
assert.throws(() => fitParallax(obs.map(o => ({ ...o, sigma: 0 })), opts), RangeError);
console.log("Astropy ephemeris, independent 600 AU injection, profile endpoints and weak-data checks passed");
