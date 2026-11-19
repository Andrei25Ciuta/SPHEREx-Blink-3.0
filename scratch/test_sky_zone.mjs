// Offline checks: actual draft wiring, URL and API client with fake DOM, Aladin and HTTP.
import assert from "node:assert/strict";
import { fieldCorners } from "../frontend/js/features/explorerGeometry.js";
import { parseSkyZone, setupSkyZone } from "../frontend/js/features/skyZone.js";
import { readUrlState, writeUrlState } from "../frontend/js/urlState.js";
import { createSkyZoneRequestFlow } from "../frontend/js/data/skyZoneRequest.js";

const requestId = `fr-${"a".repeat(32)}`;
const staleId = `fr-${"b".repeat(32)}`;
const initialUrl = new URL("http://127.0.0.1:8765/index.html?data=api&sky_browse=1&api=http://127.0.0.1:8765&"
  + `ra=155&dec=10&fov=8&request_id=${staleId}&dateFrom=2025-01-01&dateTo=2025-02-01#workspace`);
globalThis.location = initialUrl;
const { requestFieldApi, getFieldRequestApi } = await import("../frontend/js/data/apiSource.js");
const { SkyContext } = await import("../frontend/js/features/skyContext.js");

const draft = (ra, dec, fov = "5") => parseSkyZone({ ra, dec, fov });
const malformedCoordinates = {
  ra: ["08:", ":08", "08::00", "08 :  : 00", "08: h :00", "+ \t+08", "++08", "08:+15:00"],
  dec: ["-07:", ":-07", "-07::15", "-07: \t :15", "--7.25", "−−7.25", "− \t-7.25", "+ −7.25", "-  -7.25"],
};
assert.deepEqual(draft("08:00:00", "−07°15′", "7.25").query, { ra: 120, dec: -7.25, fov: 7.25 });
assert.deepEqual(draft("  +08 : 00 ", "−00:30").query, { ra: 120, dec: -0.5, fov: 5 });
assert.deepEqual(draft("08h00m00s", "-07d15m00s").query, { ra: 120, dec: -7.25, fov: 5 });
assert.deepEqual(draft("08 00 00", "−00 30").query, { ra: 120, dec: -0.5, fov: 5 });
assert.deepEqual(draft("+120,5", "−7.25").query, { ra: 120.5, dec: -7.25, fov: 5 });
assert.deepEqual(draft("1e-8", "-1e-8").query, { ra: 1e-8, dec: -1e-8, fov: 5 });
assert.deepEqual(draft("359.999999999", "+90", "1").query, { ra: 0, dec: 90, fov: 1 });
assert.deepEqual(draft("23h59m59.999999s", "-90", "10").query, { ra: 0, dec: -90, fov: 10 });
assert.deepEqual(draft("359.99999998", "-0.000000001", "6.123451").query, { ra: 359.99999998, dec: 0, fov: 6.1235 });
for (const [field, values] of Object.entries({
  ra: ["", "-", "360", "-1", "24:00:00", "11:60:00", "nonsense", ...malformedCoordinates.ra],
  dec: ["", "-", "-90:00:01", "+90:00:01", "Infinity", ...malformedCoordinates.dec],
  fov: ["", " ", "0", "0.99999", "10.00001", "11", "NaN", "Infinity"],
})) {
  for (const value of values) {
    const result = parseSkyZone({ ra: "1", dec: "2", fov: "5", [field]: value });
    assert.equal(result.query, null, `${field}=${JSON.stringify(value)} must not submit`);
    assert.ok(result.errors[field]);
  }
}

const writes = [], requests = [], seen = [];
let reply;
globalThis.fetch = async (url, options) => {
  const method = options?.method ?? "GET";
  seen.push({ url, method });
  if (method === "POST") {
    assert.equal(url, "http://127.0.0.1:8765/api/field-requests");
    assert.equal(window.location.searchParams.get("request_id"), null, "clear the previous ID before sending");
    requests.push(JSON.parse(options.body));
    return reply();
  }
  assert.equal(url, `http://127.0.0.1:8765/api/field-requests/${requestId}`);
  const { ra, dec, fov } = requests.at(-1);
  return Response.json({ requestId, query: { ra, dec, fov }, status: "unavailable",
    detectors: Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [`D${n}`, { status: "unavailable" }])),
  });
};
function emit(el, name, properties = {}) {
  return !el.dispatchEvent(Object.assign(new Event(name, { cancelable: true }), properties));
}
class Control extends EventTarget {
  attributes = new Map();
  textContent = "";
  disabled = false;
  hidden = true;
  value = "";
  setAttribute(key, value) { this.attributes.set(key, value); }
  removeAttribute(key) { this.attributes.delete(key); }
  matches() { return document.activeElement === this; }
  focus() { document.activeElement = this; }
  blur() { document.activeElement = null; emit(this, "blur"); }
  appendChild() {}
}

async function setup({ unavailable = "", markup = true, url = initialUrl, initialDraft } = {}) {
  const els = Object.fromEntries(["root", "ra", "dec", "fov", "button", "error", "status"].map(id => [id, new Control()]));
  els.fov.value = "5";
  els.button.form = new Control(); // current markup has no form; an optional wrapper must not implicitly submit.
  globalThis.document = { activeElement: null, createElement: () => new Control() };
  globalThis.window = {
    location: url,
    history: { replaceState(_state, _title, url) {
      writes.push(url);
      window.location = new URL(url, initialUrl);
    } },
  };
  const map = new SkyContext(new Control(), new Control());
  let centre, zoom;
  const events = new Map(), outlines = [];
  const A = {
    aladin: () => ({
      on: (event, handler) => events.set(event, handler),
      gotoRaDec(ra, dec) {
        const old = centre;
        centre = [ra, dec];
        events.get("positionChanged")?.({ ra, dec });
        // Emulate an Aladin notification delivered after typing has already moved to the next field.
        if (old) queueMicrotask(() => events.get("positionChanged")({ ra: old[0], dec: old[1] }));
      },
      getRaDec: () => centre,
      setFoV: value => { zoom = value; },
      setBaseImageLayer: ({ successCallback }) => successCallback(),
      addOverlay: overlay => outlines.push(overlay),
    }),
    imageHiPS: (_root, options) => options,
    polygon: points => points,
    graphicOverlay: ({ name }) => ({
      name, polygon: null, hidden: false,
      add(polygon) { this.polygon = polygon; },
      removeAll() { this.polygon = null; },
      hide() { this.hidden = true; },
      show() { this.hidden = false; },
    }),
  };
  const flow = createSkyZoneRequestFlow({
    requestField: requestFieldApi, getStatus: getFieldRequestApi, writeUrl: writeUrlState,
    reset: () => {}, checking: () => zone.setStatus("Checking"),
    attached: () => zone.setStatus("Attached"), update: () => {},
    complete: (status) => zone.setStatus(`Verified: ${status.status}`),
    failed: (message) => zone.setStatus(message),
  });
  const zone = setupSkyZone({ els: markup ? els : { ...els, root: null }, map, submit: flow.submit, unavailable });
  assert.equal(els.root.hidden, true, "only open controls after a usable survey has loaded");
  assert.equal(await map.openBrowse({
    loadViewer: async () => A, probe: async () => {}, onCentre: zone?.syncCentre,
  }), "dr1");
  zone?.open(initialDraft);
  return { els, map, zone, outlines, get zoom() { return zoom; }, get centre() { return centre; } };
}

function input(el, value) {
  el.focus();
  el.value = value;
  emit(el, "input");
}
function finish(el) {
  emit(el, "change");
  el.blur();
}
const settle = () => new Promise(setImmediate);
const assertNoEffects = () => {
  assert.deepEqual(seen, [], "no implicit field request or status read");
  assert.deepEqual(writes, [], "no implicit URL commit");
};

const missing = await setup({ markup: false });
assert.equal(missing.zone, null);
assert.deepEqual(missing.outlines, []);
const legacy = await setup({ unavailable: "Read-only." });
assert.equal(legacy.els.root.hidden, false);
assert.equal(legacy.els.button.disabled, true);
emit(legacy.els.button, "click");
assertNoEffects();

const malformed = await setup();
for (const [field, values] of Object.entries(malformedCoordinates)) {
  const el = malformed.els[field];
  const valid = el.value;
  for (const value of values) {
    input(el, value);
    finish(el);
    emit(malformed.els.button, "click", { detail: 1 });
    await settle();
    assert.equal(el.attributes.get("aria-invalid"), "true", `${field}=${JSON.stringify(value)}`);
    assert.deepEqual(malformed.centre, [269.4462, 4.769], "malformed input does not move the reticle");
    assert.equal(window.location.href, initialUrl.href, "invalid explicit click leaves shared URL intact");
    assertNoEffects();
  }
  input(el, valid);
  finish(el);
}

const view = await setup();
const { map, els, outlines } = view;
const { ra, dec, fov, button, status, error } = els;
assert.equal(els.root.hidden, false);
assert.deepEqual([ra.value, dec.value, fov.value], ["269.4462", "4.769", "5"], "stale URL does not choose the initial draft");
assert.equal(view.zoom, 12);
assert.equal(outlines[0].name, "Draft zone");
assert.deepEqual(outlines[0].polygon, fieldCorners(269.4462, 4.769, 5), "true angular outline");
assert.equal(map.query, null, "draft outline does not touch the ordinary workspace field");
assert.equal(emit(button.form, "submit"), true);
assertNoEffects();

map.aladin.gotoRaDec(12, -77);
map.aladin.setFoV(0.2);
assert.deepEqual([ra.value, dec.value, fov.value], ["12", "-77", "5"], "panning updates coordinate draft; zoom is independent");
assert.deepEqual(outlines[0].polygon, fieldCorners(12, -77, 5));
assertNoEffects();

input(ra, "08:");
map.aladin.gotoRaDec(55, 11);
await settle();
assert.deepEqual([ra.value, dec.value], ["08:", "-77"], "map notifications do not overwrite an actively edited pair");
// Tab between initially invalid coordinates without throwing away either field.
input(ra, "broken");
finish(ra);
assert.match(error.textContent, /RA:/);
emit(button, "click");
assertNoEffects();
input(dec, "-07:15:00");
finish(dec);
assert.equal(dec.value, "-07:15:00");
input(ra, "08:00:00");
assert.equal(emit(ra, "keydown", { key: "Enter" }), true);
await settle();
assert.deepEqual(view.centre, [120, -7.25]);
assert.deepEqual([ra.value, dec.value], ["08:00:00", "-07:15:00"], "both edits survive delayed synthetic notification");
finish(ra);
assert.equal(view.zoom, 0.2, "typing coordinates does not zoom the map");

for (const size of ["", "0", "11"]) {
  input(fov, size);
  finish(fov);
  assert.equal(outlines[0].hidden, true);
  emit(button, "click");
  assert.equal(fov.attributes.get("aria-invalid"), "true");
  assert.match(error.textContent, /between 1 and 10 arcmin/);
  assertNoEffects();
}
input(fov, "7.25");
assert.equal(emit(fov, "keydown", { key: "Enter" }), true);
finish(fov);
assert.deepEqual(outlines[0].polygon, fieldCorners(120, -7.25, 7.25));
assert.equal(outlines[0].hidden, false);
assert.equal(view.zoom, 0.2);
assertNoEffects();

let respond;
reply = () => new Promise(resolve => { respond = resolve; });
emit(button, "click", { detail: 0 }); // native keyboard activation is a click with detail=0
assert.equal(button.disabled, true);
assert.match(status.textContent, /sending/i);
assert.equal(emit(button, "keydown", { key: "Enter", repeat: true }), true);
emit(button, "click");
emit(button, "click", { detail: 2 });
assert.equal(writes.length, 1);
assert.deepEqual(requests, [{
  ra: 120, dec: -7.25, fov: 7.25, dateFrom: null, dateTo: null,
  detectors: ["D1", "D2", "D3", "D4", "D5", "D6"], collection: "spherex_dr1",
}]);
assert.deepEqual(readUrlState(), { ra: "120", dec: "-7.25", fov: "7.25" });
assert.equal(window.location.hash, "#workspace");
assert.equal(window.location.searchParams.get("sky_browse"), "1");
assert.equal(window.location.searchParams.get("request_id"), null);
respond(Response.json({ status: "queued", requestId }));
await settle();
assert.match(status.textContent, /Verified: unavailable/, "the verified GET, not the acknowledgment, determines status");
assert.equal(window.location.searchParams.get("request_id"), requestId);
assert.deepEqual(seen.map(call => call.method), ["POST", "GET"]);
assert.equal(button.disabled, false);
emit(button, "click", { detail: 2 }); // second click when the first response was very fast
assert.equal(requests.length, 1);

for (const [response, message] of [
  [() => Response.json({ status: "ready", requestId }), /Verified: unavailable/],
  [() => Response.json({ status: "queued", requestId: "fixture-id" }), /did not acknowledge/],
  [() => Response.json({}, { status: 404 }), /unavailable/],
  [() => Response.json({}, { status: 405 }), /unavailable/],
  [() => Response.json({ detail: "Fixture busy." }, { status: 503 }), /Fixture busy/],
  [() => { throw new Error("Fixture network error"); }, /Fixture network error/],
  [() => Response.json({ status: "queued" }), /did not acknowledge/],
]) {
  const before = requests.length;
  reply = response;
  emit(button, "click", { detail: 1 });
  await settle();
  assert.match(status.textContent, message);
  assert.equal(button.disabled, false);
  assert.equal(requests.length, before + 1, "one explicit action, no retry");
}

const count = requests.length;
const effectsBeforeOpen = [writes.length, seen.length];
const reloaded = await setup({ url: window.location });
await settle();
assert.deepEqual(reloaded.centre, [269.4462, 4.769], "opening without a validated saved request uses Barnard's Star");
const seeded = await setup({ initialDraft: { ra: 120, dec: -7.25, fov: 7.25 } });
assert.deepEqual(seeded.centre, [120, -7.25]);
assert.equal(seeded.els.fov.value, "7.25");
assert.equal(seeded.zoom, 12, "seeding an outline does not set the map zoom");
assert.equal(requests.length, count);
assert.deepEqual([writes.length, seen.length], effectsBeforeOpen, "opening controls never writes or requests data");
console.log("PASS sky zone: malformed coordinates blocked before URL/POST, valid formats and bounds, edit races, footprint, submission and repeat guard");
