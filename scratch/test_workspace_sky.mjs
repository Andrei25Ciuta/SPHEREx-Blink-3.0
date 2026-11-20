// Offline Workspace integration with fake elements, a fake map and no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setupSkyZone } from "../frontend/js/features/skyZone.js";
import { BROWSE_START } from "../frontend/js/features/skyBrowse.js";
import { explicitLoadActivation, moveToPhotoViewer, setupWorkspaceSky, skyRequestAvailability } from "../frontend/js/features/workspaceSky.js";

class Control extends EventTarget {
  hidden = true;
  value = "";
  textContent = "";
  attributes = new Map();
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  matches() { return false; }
  click(detail = 1) {
    const e = new Event("click");
    Object.defineProperties(e, { isTrusted: { value: true }, detail: { value: detail } });
    this.dispatchEvent(e);
  }
}

const api = { dataSource: "api", legacyReadOnly: false, canUseBackend: true, explicitBackend: true };
assert.equal(skyRequestAvailability(api), "", "explicit loopback fixture can stand in for cloud");
assert.equal(skyRequestAvailability({ ...api, explicitBackend: false, remoteBackend: true }), "", "canonical remote service is eligible");
const readOnly = skyRequestAvailability({ ...api, legacyReadOnly: true });
assert.match(readOnly, /read-only/);
assert.match(skyRequestAvailability({ ...api, canUseBackend: false }), /No eligible.*read-only/);
assert.match(skyRequestAvailability({ ...api, explicitBackend: false }), /FITS/);
assert.match(skyRequestAvailability({ ...api, dataSource: "mock" }), /Observed SPHEREx requests.*unavailable.*Synthetic/);

const preview = (opts) => {
  const ids = ["", "map", "surface", "status", "scale", "reset", "zone-controls", "zone-ra", "zone-dec", "zone-fov",
    "zone-request", "zone-error", "zone-status"];
  const els = Object.fromEntries(ids.map(key => [key, new Control()]));
  els["zone-fov"].value = "5";
  let opens = 0, centre = BROWSE_START, zones = [], reset = 0, onCentre, submits = [];
  const map = {
    async openBrowse(options) {
      opens++;
      onCentre = options.onCentre;
      await opts.beforeReady?.();
      return this.browseSurvey = "dr1";
    },
    centreBrowse() { reset++; this.centreBrowseAt(BROWSE_START); },
    getBrowseCentre: () => centre,
    centreBrowseAt(next) { centre = next; onCentre(next); },
    setBrowseZone(query) { zones.push(query); },
  };
  const controls = setupWorkspaceSky({
    getElement: (id) => els[id.slice("workspace-sky-".length)],
    createMap(container, status, surface, scale) {
      assert.deepEqual([container, status, surface, scale], [els.map, els.status, els.surface, els.scale]);
      return map;
    },
    setupZone: setupSkyZone,
    submit: (query) => { submits.push(query); },
    ...opts,
  });
  return { controls, els, map, zones, submits, get opens() { return opens; }, get resets() { return reset; } };
};

const settle = () => new Promise(setImmediate);
{
  const w = preview({ unavailable: readOnly, autoOpen: false });
  w.controls.start();
  await settle();
  assert.equal(w.els[""].hidden, false);
  assert.equal(w.opens, 0, "before opening an optional map, no renderer startup or tile probes");
  assert.equal(w.els.reset.textContent, "Open survey map");
  assert.match(w.els.status.textContent, /read-only/);
  w.els.reset.click();
  await settle();
  assert.equal(w.opens, 1);
  assert.equal(w.els["zone-request"].disabled, true);
  assert.match(w.els["zone-status"].textContent, /read-only/);
  w.els["zone-request"].click();
  assert.deepEqual(w.submits, []);
}

{
  const opening = Promise.withResolvers();
  const w = preview({ autoOpen: true, beforeReady: () => opening.promise });
  const linked = { ra: 15.12345678, dec: -0.7, fov: 5.251 };
  w.controls.start(linked);
  w.els.reset.click();
  assert.equal(w.opens, 1, "ordinary API boot opens the renderer exactly once");
  assert.deepEqual(w.submits, [], "renderer startup is read-only");
  opening.resolve();
  await settle();
  assert.deepEqual(w.zones.at(-1), linked);
  assert.equal(w.els.reset.attributes.get("aria-label"), "Re-centre survey map");
  w.map.centreBrowseAt({ ra: 71, dec: -3 });
  w.controls.setStatus("Attached zone");
  assert.equal(w.map.getBrowseCentre().ra, 71, "attach feedback never recentres the map");
  assert.deepEqual(w.submits, [], "panning and status changes never submit");
  w.els["zone-request"].click(0);
  w.els["zone-request"].click(2);
  await settle();
  assert.deepEqual(w.submits, [{ ra: 71, dec: -3, fov: linked.fov }]);
  w.els.reset.click();
  assert.equal(w.resets, 1);
  assert.equal(w.opens, 1, "reset does not reopen survey imagery");
}

assert.equal(setupWorkspaceSky({ getElement: () => null }), null, "older HTML can keep using its original controls");
const button = {}, other = {};
for (const [evt, focus, result] of [
  [{ isTrusted: true, detail: 1 }, other, true], [{ isTrusted: true, detail: 0 }, button, true],
  [{ isTrusted: true, detail: 0 }, other, false], [{ isTrusted: false, detail: 1 }, button, false],
  [{ isTrusted: true, detail: 2 }, button, false],
]) assert.equal(explicitLoadActivation(evt, button, focus), result);

const events = [];
const viewer = {
  focus(opts) { events.push(["focus", opts]); },
  scrollIntoView(opts) { events.push(["scroll", opts]); },
};
moveToPhotoViewer(null, false);
moveToPhotoViewer(viewer, true);
moveToPhotoViewer(viewer, false);
assert.deepEqual(events, [
  ["focus", { preventScroll: true }], ["scroll", { block: "start", behavior: "instant" }],
  ["focus", { preventScroll: true }], ["scroll", { block: "start", behavior: "smooth" }],
]);

const main = readFileSync(new URL("../frontend/js/main.js", import.meta.url), "utf8");
assert.match(main, /const workspaceSky = !SKY_BROWSE && !isEmbed \? setupWorkspaceSky/);
assert.match(main, /const sky = new SkyContext\(\$\("aladin-box"\)/);
assert.match(main, /createMap: .*new SkyContext\(container, status, null, \{ surface, scale \}\)/);
assert.match(main, /accepted\(\) \{\s*if \(workspaceSky\) moveToPhotoViewer\(\$\("workspace-photo-viewer"\), prefersReducedMotion\)/);
assert.match(main, /const explicit = explicitLegacyLoad && event\.submitter === loadButton/);
assert.equal((main.match(/\bform\.requestSubmit\(/g) ?? []).length, 1, "only the guarded explicit button uses requestSubmit in the page");
assert.doesNotMatch(main, /\brequestFieldApi\(/, "there is no standalone request write in the Workspace loader");
assert.match(main, /if \(route\.kind === "request"\) \{\s*if \(route\.target && CAN_USE_BACKEND\) \{\s*void skyZoneRequests\.restore\(route\.target\);/);

console.log("PASS Workspace sky: isolated map startup and opt-in, read-only and explicit controls, and viewer focus");
