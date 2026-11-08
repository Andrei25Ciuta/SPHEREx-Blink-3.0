// References: Astropy 8.0.2 builtin Earth-minus-Sun ephemeris, UTC MJD,
// target fixed at the reference Earth position + distance * ICRS direction,
// with apparent direction projected through Astropy TAN WCS.
import assert from "node:assert/strict";
import { orbitScene, cameraPoint } from "../frontend/js/features/orbitScene.js";

const cases = [
  { input: [70, 15, 500, 60676, 180], east: 379.1437493963, north: 142.3685218761,
    range: 501.7409863773, angleTolerance: 0.1 },
  { input: [359.8, -45, 52, 60800, 183], east: -5041.9127793696, north: -5683.7196370401,
    range: 51.3861760943, angleTolerance: 0.5 },
  { input: [120, 89, 1000, 60983, 91], east: -249.4356539098, north: 155.8522712072,
    range: 999.9660806666, angleTolerance: 0.1 },
];
for (const { input, east, north, range, angleTolerance } of cases) {
  const scene = orbitScene(...input);
  assert.ok(Math.abs(scene.offset.east - east) < angleTolerance, `east offset for ${input}`);
  assert.ok(Math.abs(scene.offset.north - north) < angleTolerance, `north offset for ${input}`);
  assert.ok(Math.abs(scene.range - range) < 0.0002, `observer range for ${input}`);
  assert.ok(Math.abs(Math.hypot(...scene.direction) - 1) < 1e-12);
}
const reference = orbitScene(70, 15, 500, 60676, 0);
assert.ok(Math.hypot(reference.offset.east, reference.offset.north) < 1e-9);
assert.ok(Math.abs(reference.range - 500) < 1e-10);
assert.deepEqual(cameraPoint([1, 2, 3], 0, 0), [1, 3]);
console.log("Simulator geometry matches independent Astropy Earth and TAN references");
