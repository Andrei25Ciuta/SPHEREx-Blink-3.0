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
assert.ok(html.includes('id="sky-map-guide"'));
assert.match(html, /id="sky-map-surface"[^>]*>\s*<div id="aladin-box"[^>]*><\/div>\s*<button[^>]*id="sky-reset-light"/);
assert.ok(!skySrc.includes('this.aladin.on("click"'));
assert.ok(!main.includes('onSelectPosition:'));

let reset;
const resetLight = { addEventListener: (event, listener) => { reset = listener; } };
const context = new SkyContext(null, null, null, { resetLight });
const updates = [];
let layer;
context.aladin = { getBaseImageLayer: () => layer };
context.refreshLightControl();
assert.equal(resetLight.hidden, true);
reset();
assert.equal(updates.length, 0);
layer = { setOptions: (options) => updates.push(options) };
context.refreshLightControl();
assert.equal(resetLight.hidden, false);
reset();
assert.deepEqual(updates, [{ brightness: 0, contrast: 0, gamma: 1, saturation: 0 }]);

console.log("PASS Sky Context cursor coordinates and light reset without map click navigation");
