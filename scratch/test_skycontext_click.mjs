// Sky Context click-to-Workspace helpers. Run: node scratch/test_skycontext_click.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aladinSkyAt, selectionText, copySkySelection } from "../frontend/js/features/skyContextClick.js";

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
  {raText:"0.00000", decText:"-7.24511",clipboardText:"RA 0.00000°, Dec -7.24511°"});

let clipboardText="";
assert.equal(await copySkySelection("RA 96.00000°", {clipboard:{writeText(t){clipboardText=t;return Promise.resolve()}},document:null}),true);
assert.equal(clipboardText,"RA 96.00000°");
let copiedFallback="";
const doc={
  body:{appendChild(el){copiedFallback=el.value}},
  createElement(name){assert.equal(name,"textarea");return {style:{},value:"",select(){},remove(){}}},
  execCommand(name){return name==="copy"}
};
assert.equal(await copySkySelection("Coordinates", {clipboard:{writeText(){return Promise.reject(Error("denied"))}},document:doc}),true);
assert.equal(copiedFallback,"Coordinates");
assert.equal(await copySkySelection("Coordinates",{clipboard:null,document:null}),false);
assert.equal(await copySkySelection("Coordinates",{clipboard:{writeText(){throw Error("denied")}},document:doc}),true);

const html=readFileSync(new URL("../frontend/index.html",import.meta.url),"utf8");
const main=readFileSync(new URL("../frontend/js/main.js",import.meta.url),"utf8");
const skySrc=readFileSync(new URL("../frontend/js/features/skyContext.js",import.meta.url),"utf8");
assert.ok(html.includes('id="sky-selection-status"'));
assert.match(html, /src="js\/main\.js\?v=\d+"/);
assert.ok(skySrc.includes('this.aladin.on("click", (e) => {'));
assert.ok(skySrc.includes('this.aladin.on("objectClicked", (object) => {'));
assert.ok(skySrc.includes('if (!clickedSource) this.onMapClick(e);'));
assert.ok(skySrc.includes('e?.isDragging'));
assert.ok(skySrc.includes('this.onSelectPosition({ ...sky, ...fields })'));
assert.ok(main.includes('onSelectPosition: ({ raText, decText }) =>'));
assert.ok(main.includes('form.requestSubmit();'));
assert.ok(main.includes('selectionStatusEl: $("sky-selection-status")'));
assert.ok(main.includes('const nativeFullscreen = document.fullscreenElement === skyFrame'));
assert.ok(main.includes('if ($("controls-body").hidden) $("panel-left-btn").click();'));
console.log("PASS Sky Context cursor coordinates, copy fallbacks and Blink handoff");
