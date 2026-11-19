// Exercise the actual canvas handler with local player/DOM fixtures, not the API.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const main = readFileSync(new URL("../frontend/js/main.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
assert.match(main, /pos: \$\("measure-pos"\)/);
assert.match(html, /<section class="panel measure" aria-labelledby="measure-title">[\s\S]*?<p [^>]*id="measure-pos" aria-live="polite"><\/p>/);
const handler = main.match(/canvas\.addEventListener\("click", async \(e\) => \{[\s\S]*?\n\}\);/);
assert.ok(handler, "the canvas click handler is still wired");

async function click({ SKY_BROWSE = false, activeFieldRequestId = null, fx = 0.5 } = {}) {
  let onClick;
  const effects = [];
  const pos = { textContent: "" };
  runInNewContext(handler[0], {
    SKY_BROWSE, activeFieldRequestId,
    canvas: { addEventListener(type, listener) { assert.equal(type, "click"); onClick = listener; } },
    currentQuery: { ra: 13, dec: -2, fov: 5 },
    currentFrames: [{ pixelScaleArcsec: 6 }],
    player: {
      length: 1, naturalSize: 50,
      pointToFrac: () => ({ fx, fy: 0.5 }),
      setMarker: () => effects.push("marker"),
    },
    inspectionPosition: () => ({ ra: 13, dec: -2 }),
    measureAndPlot: () => effects.push("photometry"),
    APERTURE_RADIUS_PX: 3,
    measureToken: 0,
    measureEls: { pos },
  });
  await onClick({ clientX: 10, clientY: 10 });
  return { effects, notice: pos.textContent };
}

const id = `fr-${"1".repeat(32)}`;
assert.deepEqual(await click(), { effects: ["marker", "photometry"], notice: "" },
  "unassociated prepared, local and synthetic callers retain the same path");
const scoped = await click({ activeFieldRequestId: id });
assert.deepEqual(scoped.effects, [], "scoped playback never calls unscoped click photometry or sets a measurement marker");
assert.match(scoped.notice, /cannot limit measurements to the images in this request/);
assert.deepEqual(await click({ activeFieldRequestId: id, fx: 1.2 }), { effects: [], notice: "" });
assert.deepEqual(await click({ SKY_BROWSE: true, activeFieldRequestId: id }), { effects: [], notice: "" },
  "pilot still ignores measurements without changing its interface");

console.log("PASS Workspace click photometry: scoped requests show a notice without measuring; legacy and pilot behavior retained");
