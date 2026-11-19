// Offline integration: the actual draft controller, URL writer and legacy
// synthetic cutout generator. Only the DOM, Aladin and player attachment are fakes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BROWSE_START } from "../frontend/js/features/skyBrowse.js";
import { parseSkyZone, setupSkyZone } from "../frontend/js/features/skyZone.js";
import { moveToPhotoViewer, openSyntheticZone, setupWorkspaceSky } from "../frontend/js/features/workspaceSky.js";
import { readUrlState, readWorkspaceStartup, writeUrlState } from "../frontend/js/urlState.js";

globalThis.location = new URL("https://iooonut.github.io/SPHEREx-Blink-3.0/index.html#workspace");
const network = [];
globalThis.fetch = (...args) => {
  network.push(args);
  throw new Error("Synthetic requests must not fetch");
};
const { CAN_USE_BACKEND, DATA_SOURCE, IS_REMOTE_BACKEND } = await import("../frontend/js/config.js");
assert.equal(DATA_SOURCE, "mock");
assert.equal(CAN_USE_BACKEND, true, "project Pages has a configured API even with Synthetic demo selected");
assert.equal(IS_REMOTE_BACKEND, true);
const { getCutouts } = await import("../frontend/js/data/getCutouts.js");
const { PLANET_X_DEMO } = await import("../frontend/js/data/mockSource.js");

globalThis.document = {
  activeElement: null,
  createElement(tag) {
    assert.equal(tag, "canvas");
    return {
      getContext() {
        return { createImageData: (w, h) => ({ data: new Uint8ClampedArray(4 * w * h) }), putImageData() {} };
      },
      toDataURL(type) { return `data:${type};base64,AA==`; },
    };
  },
};

function emit(control, type, props = {}, isTrusted = true) {
  const event = Object.assign(new Event(type, { cancelable: true }), props);
  Object.defineProperty(event, "isTrusted", { value: isTrusted });
  return !control.dispatchEvent(event);
}
class Control extends EventTarget {
  attributes = new Map();
  value = "";
  textContent = "";
  hidden = true;
  setAttribute(key, value) { this.attributes.set(key, value); }
  removeAttribute(key) { this.attributes.delete(key); }
  matches(selector) { return selector === ":focus" && document.activeElement === this; }
  focus() { document.activeElement = this; }
  append(child) { child.parent = this; }
  edit(value) { this.value = value; emit(this, "input"); emit(this, "change"); }
  click(detail = 1) { emit(this, "click", { detail }); }
}

function fixture(href = location.href) {
  const writes = [], loads = [], handoffs = [], outlines = [];
  const renderMap = Promise.withResolvers(), generated = Promise.withResolvers(), attach = Promise.withResolvers();
  globalThis.window = {
    location: new URL(href),
    history: { replaceState(_state, _title, url) {
      writes.push(url);
      window.location = new URL(url, window.location);
    } },
  };
  const ids = ["workspace-sky", ...["map", "surface", "status", "scale", "reset", "api-fov", "synthetic-fov",
    "zone-controls", "zone-ra", "zone-dec", "zone-fov", "zone-request", "zone-error", "zone-status"].map(key => `workspace-sky-${key}`),
    "workspace-legacy-fov", "fov-input", "fov-value", "search-form"];
  const els = Object.fromEntries(ids.map(id => [id, new Control()]));
  const slider = els["fov-input"], output = els["fov-value"];
  slider.value = output.textContent = "5";
  slider.addEventListener("input", () => { output.textContent = slider.value; });
  els["search-form"].append(els["workspace-legacy-fov"]);
  els["workspace-legacy-fov"].append(slider);
  els["workspace-sky-api-fov"].hidden = false;
  let opens = 0, centre = BROWSE_START, onCentre;
  const map = {
    async openBrowse(options) {
      opens++;
      onCentre = options.onCentre;
      onCentre(BROWSE_START);
      await renderMap.promise;
      return (this.browseSurvey = "dr1");
    },
    centreBrowse() { this.centreBrowseAt(BROWSE_START); },
    getBrowseCentre: () => centre,
    centreBrowseAt(position) { centre = position; onCentre(position); },
    setBrowseZone(query) { outlines.push(query); },
  };
  const controls = setupWorkspaceSky({
    dataSource: DATA_SOURCE,
    getElement: (id) => els[id],
    createMap: () => map,
    setupZone: setupSkyZone,
    submit: (query) => openSyntheticZone(query, {
      writeUrl: writeUrlState,
      async load(field) {
        loads.push(field);
        const frames = await getCutouts({ ra: field.ra, dec: field.dec, fovArcmin: field.fov, detector: "all" });
        generated.resolve(frames);
        return attach.promise;
      },
      report: (message) => controls.setStatus(message),
      handoff: () => moveToPhotoViewer({
        focus: (opts) => handoffs.push(["focus", opts]),
        scrollIntoView: (opts) => handoffs.push(["scroll", opts]),
      }, true),
    }),
  });
  return {
    controls, els, map, slider, output, writes, loads, handoffs, outlines, renderMap, generated, attach,
    get opens() { return opens; },
    draft: Object.fromEntries(["ra", "dec", "request", "error", "status", "controls"].map(key => [key, els[`workspace-sky-zone-${key}`]])),
  };
}

const parse = (fov) => parseSkyZone({ ra: "269.4462", dec: "4.769", fov }, { dataSource: DATA_SOURCE });
for (const width of ["1", "30"]) assert.equal(parse(width).query.fov, Number(width));
for (const width of ["", "0", "31", "1.5", "Infinity"]) {
  assert.equal(parse(width).query, null);
  assert.ok(parse(width).errors.fov);
}
assert.equal(parseSkyZone({ ra: "1", dec: "2", fov: "10.25" }).query, null, "API retains its 10′ limit");
assert.equal(parseSkyZone({ ra: "1", dec: "2", fov: "7.25" }).query.fov, 7.25, "prepared API widths may be fractional");

const w = fixture();
w.controls.start();
assert.equal(w.els["workspace-legacy-fov"].parent, w.els["workspace-sky-synthetic-fov"]);
assert.equal(w.slider.parent, w.els["workspace-legacy-fov"], "move the wrapper with the original range control");
assert.equal(w.els["workspace-sky-synthetic-fov"].hidden, false);
assert.equal(w.els["workspace-sky-api-fov"].hidden, true);
assert.equal(w.slider.attributes.get("aria-describedby"), "workspace-sky-zone-error");
assert.equal(w.draft.controls.hidden, false);
assert.equal(w.draft.request.disabled, false);
assert.deepEqual([w.draft.ra.value, w.draft.dec.value, w.slider.value], ["269.4462", "4.769", "5"]);
assert.deepEqual([w.opens, w.writes.length, w.loads.length], [0, 0, 0]);

// Range change is a draft edit, even beyond the observed-data maximum.
w.slider.edit("30");
assert.equal(w.output.textContent, "30");
assert.deepEqual([w.opens, w.writes.length, w.loads.length], [0, 0, 0]);
w.slider.edit("31"); // normally prevented by the native range, also rejected by the shared parser
w.draft.request.click();
assert.match(w.draft.error.textContent, /between 1 and 30/);
assert.equal(document.activeElement, w.slider);
assert.deepEqual([w.opens, w.writes.length, w.loads.length], [0, 0, 0]);
w.draft.ra.edit("23h59m59.999999s");
w.draft.dec.edit("−07°15′");
w.slider.edit("1");
w.draft.request.focus();
window.location.searchParams.set("request_id", `fr-${"a".repeat(32)}`);
window.location.searchParams.set("dateFrom", "2025-01-01");
assert.deepEqual(readWorkspaceStartup(), { kind: "request", target: null }, "a synthetic link cannot restore a cloud status");
emit(w.draft.request, "click", { detail: 0 }, false);
assert.deepEqual(w.loads, []);
w.draft.request.click(0);
w.draft.request.click(0);
w.draft.request.click(2);
assert.equal(emit(w.draft.request, "keydown", { repeat: true, key: "Enter" }), true);
assert.equal(w.draft.request.disabled, true);
assert.match(w.draft.status.textContent, /Opening synthetic demo/);
assert.deepEqual(w.loads, [{ ra: 0, dec: -7.25, fov: 1 }]);
assert.equal(w.writes.length, 1);
assert.deepEqual(readUrlState(), { ra: "0", dec: "-7.25", fov: "1" });
assert.equal(window.location.searchParams.has("request_id"), false);
assert.equal(window.location.hash, "#workspace");
assert.deepEqual(readWorkspaceStartup(), { kind: "legacy" });
const frames = await w.generated.promise;
assert.ok(frames.length > 1 && frames.every(frame => frame.imageUrl.startsWith("data:image/png;")), "existing mock generator makes local image frames");
assert.ok(frames.every(frame => frame.pixelScaleArcsec === 6), "1′ is generated at the existing mock minimum of 10 pixels");
assert.equal(w.opens, 0, "map is not necessary for local generation");
assert.deepEqual(w.handoffs, [], "don't follow the viewer before playback attaches");
w.attach.resolve(true);
await new Promise(setImmediate);
assert.equal(w.draft.request.disabled, false);
assert.match(w.draft.status.textContent, /^Synthetic demo ready: .*1′ field\.$/);
assert.deepEqual(w.handoffs, [["focus", { preventScroll: true }], ["scroll", { block: "start", behavior: "instant" }]]);

const latest = window.location.href;
const reloaded = fixture(latest);
const state = readUrlState();
reloaded.controls.start({ ra: Number(state.ra), dec: Number(state.dec), fov: Number(state.fov) });
assert.deepEqual([reloaded.draft.ra.value, reloaded.draft.dec.value, reloaded.slider.value], ["0", "-7.25", "1"]);
assert.deepEqual([reloaded.opens, reloaded.writes.length, reloaded.loads.length, reloaded.handoffs.length], [0, 0, 0, 0]);

// Optional survey starts independently, and its initial centre callback does
// not replace edits made before or during render.
reloaded.els["workspace-sky-reset"].click();
reloaded.draft.ra.edit("08:00:00");
reloaded.draft.dec.edit("−10:30");
reloaded.slider.edit("30");
reloaded.renderMap.resolve();
await new Promise(setImmediate);
assert.equal(reloaded.opens, 1);
assert.deepEqual(reloaded.map.getBrowseCentre(), { ra: 120, dec: -10.5 });
assert.deepEqual(reloaded.outlines.at(-1), { ra: 120, dec: -10.5, fov: 30 });
assert.deepEqual([reloaded.draft.ra.value, reloaded.draft.dec.value, reloaded.slider.value], ["08:00:00", "−10:30", "30"]);
assert.deepEqual([reloaded.writes.length, reloaded.loads.length, reloaded.handoffs.length], [0, 0, 0]);

const { ra, dec } = PLANET_X_DEMO;
const preset = { ra, dec, fov: 30 };
const publishLegacyLoad = (query) => {
  writeUrlState(query);
  reloaded.controls.syncSyntheticField(query);
  assert.deepEqual(reloaded.outlines.at(-1), query);
  assert.deepEqual([reloaded.draft.ra.value, reloaded.draft.dec.value, reloaded.output.textContent], [query.ra, query.dec, query.fov].map(String));
};
publishLegacyLoad(preset);
assert.deepEqual(readUrlState(), { ra: String(ra), dec: String(dec), fov: "30" });
publishLegacyLoad({ ra: BROWSE_START.ra, dec: BROWSE_START.dec, fov: 5 });
assert.deepEqual(reloaded.loads, [], "legacy synchronization doesn't open a second field or wake the zone submit");
assert.deepEqual(reloaded.handoffs, []);

publishLegacyLoad(preset);
reloaded.draft.request.click();
assert.deepEqual(reloaded.loads, [preset]);
const wideFrames = await reloaded.generated.promise;
assert.ok(wideFrames.length > 1 && wideFrames.every(frame => frame.pixelScaleArcsec === 6.207), "30′ uses the existing full-width synthetic field");
reloaded.attach.resolve(true);
await new Promise(setImmediate);
assert.match(reloaded.draft.status.textContent, /30′ field/);

for (const result of [false, undefined]) {
  let report = "";
  await openSyntheticZone(preset, {
    writeUrl() {}, load: async () => result, report: (message) => { report = message; },
    handoff() { assert.fail("failed or stale playback cannot hand off"); },
  });
  if (result === false) assert.match(report, /Could not open synthetic/);
  else assert.equal(report, "");
}
assert.deepEqual(network, [], "no cloud submission, status, retry or HTTP cutout in the demo");

// Check the main-page wiring too: an eligible production endpoint MUST NOT
// authorize either observed submit path or replace the old local form loader.
const main = readFileSync(new URL("../frontend/js/main.js", import.meta.url), "utf8");
assert.match(main, /function submitObservedZone\(query\) \{\s*if \(DATA_SOURCE === "api"\) return skyZoneRequests\.submit\(query\);/);
assert.match(main, /const workspaceSky = !SKY_BROWSE && !isEmbed \? setupWorkspaceSky/);
assert.match(main, /submit: DATA_SOURCE === "api" \? submitObservedZone : \(query\) => openSyntheticZone/);
assert.match(main, /if \(DATA_SOURCE === "api" && explicit && !zoneRequestUnavailable\) \{[\s\S]*?skyZoneRequests\.submit\(query, \{ origin: "legacy", \.\.\.readArchiveDates\(\) \}\);\s*\} else if \(explicit \|\| !new URLSearchParams\(location.search\)\.has\("request_id"\)\) \{\s*loadPreparedForm\(\);/);
assert.equal((main.match(/skyZoneRequests\.submit\(/g) ?? []).length, 2);
assert.match(main, /fovInput\.addEventListener\("change", \(\) => \{\s*if \(workspaceSky\?\.synthetic \|\| SKY_BROWSE \|\| .*has\("request_id"\)\) return;\s*if \(allFrames\.length \|\| DATA_SOURCE === "api"\) loadPreparedForm\(\);/);
assert.match(main, /load: \(field\) => \{[\s\S]*?return loadData\(field, \{\}, \{ fromSyntheticZone: true \}\);/);
assert.match(main, /if \(DATA_SOURCE === "api"\) \{\s*skyZoneRequests\.cancel\(\);[\s\S]*?\} else if \(workspaceSky\?\.synthetic && !fromSyntheticZone\) \{\s*workspaceSky\.syncSyntheticField\(query\);/);
assert.match(main, /const frames = await getCutouts\(\{ ra: query\.ra, dec: query\.dec, fovArcmin: query\.fov, detector: "all" \}\);[\s\S]*?await applyFrames\(frames, query, token\);/);
assert.match(main, /if \(workspaceSky\?\.synthetic\) document\.documentElement\.classList\.add\("workspace-synthetic-zone"\);/);
console.log("PASS synthetic Workspace zone: shared slider, offline local playback, opt-in map, presets, URL and hard API separation");
