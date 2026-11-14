import assert from "node:assert/strict";
import { demoComparison, SIZE } from "../frontend/js/features/colourBlink.js";

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-5, `Expected ${expected}, got ${actual}`);
}
const wavelength = demoComparison("wavelength");
const date = demoComparison("date");
for (const comparison of [wavelength, date]) {
  assert.equal(comparison.frames.length, 2);
  for (const tiles of comparison.frames) {
    assert.equal(tiles.length, 3);
    for (const { pixels, centre } of tiles) {
      assert.equal(pixels.length, SIZE ** 2);
      near(centre.y, (SIZE - 1) / 2);
    }
  }
  near(comparison.measured[2], 0.6);
  near(comparison.corrected[2], 0);
}
near(wavelength.corrected[0], 2.1);
near(wavelength.corrected[1], 0);
near(date.corrected[0], 0);
near(date.corrected[1], 6);
console.log("PASS  reference-corrected centres separate spectral blending from motion");
