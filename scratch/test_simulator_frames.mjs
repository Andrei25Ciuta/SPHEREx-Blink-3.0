import assert from "node:assert/strict";
import { orbitScene } from "../frontend/js/features/orbitScene.js";
import { FRAME_WIDTH, FRAME_HEIGHT, POINTING_JITTER, MONTH_PRESETS, syntheticStars, targetShiftPixels, exposureGeometry } from "../frontend/js/features/simulatorFrames.js";

assert.equal(FRAME_WIDTH, 320);
assert.equal(FRAME_HEIGHT, 200);
assert.deepEqual(MONTH_PRESETS.map(p => p.day), [0, 183, 365]);
const stars = syntheticStars();
assert.ok(stars.length >= 30);
assert.deepEqual(stars, syntheticStars(), "synthetic background must remain fixed across months");
assert.ok(stars.every(s => s.x >= 0 && s.x < 320 && s.y >= 0 && s.y < 200));

const epoch = Date.UTC(2025, 0, 1) / 86400000 + 40587;
const scene0 = orbitScene(70, 15, 500, epoch, 0);
const scene6 = orbitScene(70, 15, 500, epoch, 183);
const scene12 = orbitScene(70, 15, 500, epoch, 365);
const length = s => Math.hypot(s.x, s.y);
const shift0 = targetShiftPixels(scene0.offset, 500);
const shift6 = targetShiftPixels(scene6.offset, 500);
const shift12 = targetShiftPixels(scene12.offset, 500);
assert.ok(length(shift0) < 1e-9, "month zero must match its reference");
assert.ok(length(shift6) > 10, "six-month parallax should be clearly visible");
assert.ok(length(shift12) < length(shift6) * .03, "after a year the apparent position should almost return");

const raw = exposureGeometry(scene6.offset, 500, false);
const aligned = exposureGeometry(scene6.offset, 500, true);
assert.deepEqual(raw.stars, POINTING_JITTER);
assert.deepEqual(aligned.stars, {x: 0, y: 0}, "registration must remove only pointing jitter");
assert.ok(Math.abs(aligned.target.x - (160 + shift6.x)) < 1e-8);
assert.ok(Math.abs(aligned.target.y - (100 + shift6.y)) < 1e-8);
assert.deepEqual(raw.relativeTargetShift, aligned.relativeTargetShift, "registration must preserve parallax");
assert.deepEqual(targetShiftPixels({east: NaN, north: 2}, 500), {x: 0, y: 0});
console.log("PASS simulator synthetic exposures, monthly return, and star registration");
