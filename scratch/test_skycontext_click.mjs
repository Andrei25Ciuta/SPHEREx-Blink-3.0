// Sky Context coordinates and reset control. Run: node scratch/test_skycontext_click.mjs
import assert from "node:assert/strict";
import { SkyContext } from "../frontend/js/features/skyContext.js";
import { readFileSync } from "node:fs";
import { aladinSkyAt, selectionText } from "../frontend/js/features/skyContextClick.js";

const calls = [];
const aladin = { pix2world(x, y, frame) {
  calls.push({x,y,frame});
  return [x * 0.6, y * 0.15 - 45];
} };
const sky = aladinSkyAt(aladin, { x: 160, y: 200, frame: "galactic", ra: 99, dec: 2 });
assert.deepEqual(sky, {ra: 96, dec: -15}, "use the ICRS pixel transform, not the displayed frame");
assert.deepEqual(calls, [{x: 160, y: 200, frame: "icrs"}]);
assert.equal(aladinSkyAt({pix2world(){return [360, 0]}}, {x:0,y:0}).ra,0);
assert.equal(aladinSkyAt({pix2world(){return [-1, 0]}}, {x:0,y:0}).ra,359);
assert.equal(aladinSkyAt({pix2world(){return [100, 91]}}, {x:0,y:0}),null);
assert.equal(aladinSkyAt({pix2world(){return null}}, {x:0,y:0}),null);
assert.equal(aladinSkyAt({pix2world(){throw Error("off sky")}}, {x:0,y:0}),null);
assert.deepEqual(aladinSkyAt(aladin, {ra:12,dec:-20,frame:"icrs"}),{ra:12,dec:-20});
assert.equal(aladinSkyAt(aladin, {ra:12,dec:-20,frame:"galactic"}),null);
assert.equal(aladinSkyAt(null, {ra:12,dec:0}),null);
assert.deepEqual(selectionText({ra:359.999999,dec:-7.24511}),
  {raText:"0.00000", decText:"-7.24511"});

const html=readFileSync(new URL("../frontend/index.html",import.meta.url),"utf8");
const main=readFileSync(new URL("../frontend/js/main.js",import.meta.url),"utf8");
const skySrc=readFileSync(new URL("../frontend/js/features/skyContext.js",import.meta.url),"utf8");
assert.match(html, /src="js\/main\.js\?v=\d+"/);
assert.match(html, /id="sky-reset-light"[^>]*aria-label="Reset light settings"[^>]*><span aria-hidden="true">↺<\/span>/);
assert.ok(!html.includes('id="sky-map-guide"'));
assert.match(html, /id="sky-map-surface"[^>]*>\s*<div id="aladin-box"[^>]*><\/div>\s*<button[^>]*id="sky-reset-light"/);
assert.ok(!skySrc.includes('this.aladin.on("click"'));
assert.ok(!main.includes('onSelectPosition:'));

let reset;
const resetLight = { addEventListener: (event, listener) => { reset = listener; } };
const resetStatus = { textContent: "" };
const context = new SkyContext(null, null, null, { resetLight, resetStatus });
const updates = [];
const layers = new Map();
context.aladin = { getStackLayers: () => [...layers.keys()], getOverlayImageLayer: (id) => layers.get(id) };
context.refreshLightControl();
assert.equal(resetLight.hidden, true);
reset();
assert.equal(updates.length, 0);

const initial = { brightness: 0, contrast: 0, gamma: 1, saturation: 0,
  minCut: 0, maxCut: 1, stretch: "linear", colormap: "native", reversed: false, opacity: 1 };
function addLayer(id, light) {
  layers.set(id, {
    getColorCfg: () => ({ get: () => ({
      opacity: light.opacity,
      color: { kBrightness: light.brightness, kContrast: light.contrast, kGamma: light.gamma,
        kSaturation: light.saturation, minCut: light.minCut, maxCut: light.maxCut,
        stretch: light.stretch, cmapName: light.colormap, reversed: light.reversed },
    }) }),
    setOptions: (options) => { updates.push(id); Object.assign(light, options); },
  });
}
const base = { ...initial, minCut: undefined, maxCut: undefined };
const overlay = { ...initial, minCut: 0.1, maxCut: 0.9 };
addLayer("base", base);
addLayer("overlay", overlay);
context.refreshLightControl();
assert.equal(resetLight.hidden, false);
Object.assign(base, { brightness: 0.75, contrast: -0.3, gamma: 2, saturation: 0.2,
  minCut: 0.25, maxCut: 0.55, stretch: "asinh", colormap: "grayscale", reversed: true, opacity: 0.6 });
overlay.brightness = -0.7;
context.refreshLightControl();
reset();
assert.deepEqual(updates, ["base", "overlay"]);
assert.deepEqual(base, initial);
assert.deepEqual(overlay, { ...initial, minCut: 0.1, maxCut: 0.9 });
assert.equal(resetStatus.textContent, "Map display reset.");

console.log("PASS Sky Context cursor coordinates and light reset without map click navigation");
