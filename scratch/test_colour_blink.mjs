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
