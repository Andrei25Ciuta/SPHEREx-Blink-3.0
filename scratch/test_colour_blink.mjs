import assert from "node:assert/strict";
import { colourSequences } from "../frontend/js/features/colourBlink.js";
import { BlinkPlayer } from "../frontend/js/player.js";

const frames = [[60000, 2], [60001, 1], [60002, 3], [60100, 2], [60101, 1], [60200, 2], [60201, 2]]
  .map(([mjd, wavelength]) => ({ mjd, dateISO: "2025-01-01", wavelengthMinUm: wavelength, wavelengthMaxUm: wavelength }));
assert.deepEqual(colourSequences(frames, [0, 1, 2, 3, 4, 5, 6]).map(pass => pass.indices), [[1, 0, 2], [4, 3]]);
assert.deepEqual(colourSequences(frames, [0, 2, 3]).map(pass => pass.indices), [[0, 2]]);
const player = Object.create(BlinkPlayer.prototype);
Object.assign(player, { frames, active: [0, 2, 3], index: 0, mode: "colour", playing: false,
  pause() {}, onFrameChange() {}, goTo(index) { this.index = index; } });
player.setColourOrder([2, 0], { restart: true });
assert.equal(player.index, 2);
assert.equal(player.firstPlaybackIndex, 2);
assert.equal(player.playbackCount, 2);
player.next();
assert.equal(player.index, 0);
player.next();
assert.equal(player.index, 2);
player.prev();
assert.equal(player.index, 0);
player.setColourOrder([]);
player.next();
assert.equal(player.index, 0);
player.mode = "blink";
player.next();
assert.equal(player.index, 2);
console.log("PASS  wavelength ordering, filters, playback and return to chronological blinking");

const followed = [];
Object.assign(player, {
  mode: "colour", draw() {}, setFollow(index) { followed.push(index); this.following = index; },
  stopFollow() { this.following = null; },
});
const candidate = { points: [{ fx: 0.5, fy: 0.5 }] };
player.setCandidates([candidate], 0);
assert.deepEqual(followed, [0]);
player.setMode("blink");
assert.equal(player.following, null);
player.setMode("colour");
assert.deepEqual(followed, [0, 0]);
player.setCandidates([], -1);
assert.equal(player.following, null);
console.log("PASS  selection follows candidate in colour mode and stops on exit");

const { lightCentre } = await import("../frontend/js/features/colourBlink.js");
const size = 21;
const target = { fx: 0.5, fy: 0.5 };
const pixels = new Uint8Array(size ** 2).fill(12);
assert.equal(lightCentre(pixels, size, target), null);
pixels[10 * size + 11] = 90;
pixels[3 * size + 3] = 255; // unrelated bright source outside the aperture
const centre = lightCentre(pixels, size, target);
assert.equal(centre.fx, 11.5 / size);
assert.equal(centre.fy, 0.5);
assert.equal(centre.peak, 90);
assert.equal(centre.background, 12);
assert.ok(Math.abs(centre.offsetPx - 1) < 1e-12);
const mask = new Uint8Array(size ** 2);
mask[10 * size + 11] = 1;
assert.equal(lightCentre(pixels, size, target, mask), null);
assert.equal(lightCentre(pixels, size, { fx: 0.05, fy: 0.5 }), null);
console.log("PASS  local light centre ignores unrelated peaks and rejects weak, masked or clipped measurements");

const { observe, stretchAsinh } = await import("../frontend/js/data/mockSource.js");
const { TARGETS, positionAtEpoch } = await import("../frontend/js/targets.js");
const { skyToCanvas, mjdToYear } = await import("../frontend/js/geometry.js");
const ra = 269.44627, dec = 4.76820;
const demo = observe(ra, dec, 5);
const barnard = TARGETS.find(target => target.label.startsWith("Barnard"));
const barnardFrames = demo.obs.filter(frame => frame.detector === "D1");
assert.ok(barnardFrames.length > 1);
for (const frame of barnardFrames) {
  const predicted = positionAtEpoch(barnard, mjdToYear(frame.mjd));
  const point = skyToCanvas(predicted.ra, predicted.dec, { ra, dec, n: demo.size, scaleArcsec: demo.scale });
  const centre = lightCentre(stretchAsinh(frame.pixels), demo.size, point, frame.flagMask);
  assert.ok(centre && Math.hypot(centre.fx - point.fx, centre.fy - point.fy) < 2.5 / demo.size);
}
console.log("PASS  Barnard D1 demo yields local light centres");

const gradientStops = [];
const haloPlayer = Object.create(BlinkPlayer.prototype);
Object.assign(haloPlayer, {
  index: 0, frames: [{}], images: [{ naturalWidth: size }],
  candidates: [{ points: [target] }], selectedCandidate: 0, tracks: [], flagImages: [],
  _colourMasks: new Map(), _greys: () => [pixels], _px: (x, y) => [x * size, y * size],
  ctx: {
    createRadialGradient: () => ({ addColorStop: (...stop) => gradientStops.push(stop) }),
    save() {}, restore() {}, fillRect() {},
  },
});
assert.equal(haloPlayer._drawLightCentre().kind, "measured");
assert.equal(gradientStops.length, 6);
haloPlayer._colourMasks.set(0, mask);
assert.equal(haloPlayer._drawLightCentre().kind, "predicted");
haloPlayer.candidates = [];
haloPlayer.selectedCandidate = -1;
assert.equal(haloPlayer._drawLightCentre(), undefined);
console.log("PASS  halo distinguishes measured, predicted and unavailable positions");
