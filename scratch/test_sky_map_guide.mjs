import assert from "node:assert/strict";
import { outsideWorkspaceField, skyMapGuide } from "../frontend/js/features/skyMapGuide.js";

let degreesPerPixel = 1 / 3600;
const aladin = {
  getSize: () => [400, 300],
  getRaDec: () => [359.99, 0],
  pix2world: (x, y) => [180 - (x - 200) * degreesPerPixel, -(y - 150) * degreesPerPixel],
};

const guide = skyMapGuide(aladin);
assert.equal(guide.label, "1′");
assert.ok(Math.abs(guide.width - 60) < 0.01);
assert.equal(guide.north, -90);
assert.equal(Math.abs(guide.east), 180);
const rotated = skyMapGuide({
  ...aladin,
  pix2world: (x, y) => [180 - (y - 150) * degreesPerPixel, (x - 200) * degreesPerPixel],
});
assert.ok(Math.abs(rotated.north) < 0.001);
assert.equal(rotated.east, -90);

degreesPerPixel /= 2;
assert.equal(skyMapGuide(aladin).label, "20″");
assert.equal(outsideWorkspaceField(aladin, { ra: 0.01, dec: 0, fov: 5 }), false);
assert.equal(outsideWorkspaceField(aladin, { ra: 0.1, dec: 0, fov: 5 }), true);
assert.equal(outsideWorkspaceField(aladin, null), false);
console.log("PASS Sky Map orientation, zoom scale and field return across RA 0");
