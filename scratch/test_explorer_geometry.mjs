// Independent TAN-WCS references from Astropy WCS, with CRVAL=(centre RA, Dec),
// CRPIX=(1,1), CD=[[-1,0],[0,1]] degrees/pixel. East tangent coordinates are -x.
import assert from "node:assert/strict";
import { tangentPoint, fieldCorners } from "../frontend/js/features/explorerGeometry.js";

const references = [
  [359.9, 2, 0.1, 2.1, 0.19986679338456148, 0.10001288411977605],
  [0.1, -30, 359.9, -29.8, -0.17355459018819341, 0.19985027291270763],
  [120, 89.8, 300, 89.7, 0, 0.5000126927791331],
  [43, -75, 43.3, -74.8, 0.07865694656137157, 0.1998020911703844],
];
for (const [ra0, dec0, ra, dec, east, north] of references) {
  const projected = tangentPoint(ra, dec, ra0, dec0);
  assert.ok(projected, `TAN projection exists at ${ra}, ${dec}`);
  assert.ok(Math.abs(projected[0] - east) < 1e-9, `east offset at ${ra}, ${dec}`);
  assert.ok(Math.abs(projected[1] - north) < 1e-9, `north offset at ${ra}, ${dec}`);
}
assert.equal(tangentPoint(190, -10, 10, 10), null, "opposite hemisphere is not projectable");

// Inverse TAN corners must land at the requested tangent-plane half-width,
// including a field crossing RA=0 and one enclosing the north celestial pole.
for (const [ra0, dec0, fov] of [[359.9, 2, 30], [0.1, -30, 2], [120, 89.8, 30]]) {
  const expected = Math.tan(fov * Math.PI / (180 * 120)) * 180 / Math.PI;
  const corners = fieldCorners(ra0, dec0, fov);
  assert.equal(corners.length, 4);
  for (const [i, [ra, dec]] of corners.entries()) {
    assert.ok(ra >= 0 && ra < 360 && dec >= -90 && dec <= 90);
    const [east, north] = tangentPoint(ra, dec, ra0, dec0);
    assert.ok(Math.abs(east - (i === 0 || i === 3 ? expected : -expected)) < 1e-9);
    assert.ok(Math.abs(north - (i < 2 ? expected : -expected)) < 1e-9);
  }
}
console.log("Sky Explorer TAN projection matches independent Astropy references");
