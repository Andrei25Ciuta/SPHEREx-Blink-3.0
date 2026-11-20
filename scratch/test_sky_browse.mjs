// Offline P1 checks: fake HiPS responses and the Aladin 3.6.5 layer interface.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BROWSE_START, BROWSE_SURVEYS, probeBrowseSurvey } from "../frontend/js/features/skyBrowse.js";
import { SkyContext } from "../frontend/js/features/skyContext.js";

const configs = [
  ["?data=api&sky_browse=1", true, "api"],
  ["?data=api&sky_browse=1&legacy_api=1", true, "api"],
  ["?data=api&sky_browse=0", false, "api"],
  ["?data=api", false, "api"],
  ["?data=mock&sky_browse=1", false, "mock"],
  ["?sky_browse=1", false, "mock"],
  ["", false, "mock"],
];
for (const [i, [search, pilot, source]] of configs.entries()) {
  globalThis.location = { search, hostname: "example.com" };
  const config = await import(`../frontend/js/config.js?browse-test=${i}`);
  assert.equal(config.SKY_BROWSE, pilot, search);
  assert.equal(config.DATA_SOURCE, source, search);
}
delete globalThis.location;

const { dr1, "2mass": twoMass } = BROWSE_SURVEYS;
const metadata = (survey) => `creator_did = ${survey.id}\r\nhips_tile_format = ${survey.format}
#data_cube_bunit3 = incorrect
data_cube_bunit3 = um
data_cube_crval3_arr = 0.753 0.771`;

function fakeArchive({ failUrl, wrongWavelength = false, wrongType = false, corrupt = false } = {}) {
  const seen = [], decoded = [];
  return { seen, decoded, probe: (key) => probeBrowseSurvey(key, {
    fetchImpl: async (url, { signal }) => {
      assert.ok(!signal.aborted);
      seen.push(url);
      assert.ok(url.startsWith(dr1.root) || url.startsWith(twoMass.root));
      if (url === failUrl) return new Response("Unavailable", { status: 503 });
      const survey = url.startsWith(dr1.root) ? dr1 : twoMass;
      if (url.endsWith("/properties")) {
        const properties = metadata(survey);
        return new Response(wrongWavelength ? properties.replace("0.753", "0.771") : properties);
      }
      return new Response(corrupt ? "corrupt" : "fake decodable image", {
        headers: { "content-type": wrongType ? "text/html" : survey.mime },
      });
    },
    decodeImage: async (blob) => {
      assert.equal(await blob.text(), "fake decodable image");
      return { close: () => decoded.push(blob.type) };
    },
  }) };
}

const success = fakeArchive();
await success.probe("dr1");
assert.deepEqual(success.seen, [
  `${dr1.root}/properties`,
  `${dr1.root}/Norder3/Allsky.png`,
  `${dr1.root}/Norder0/Dir0/Npix7.png`,
]);
assert.deepEqual(success.decoded, ["image/png", "image/png"]);
for (const options of [{ wrongWavelength: true }, { wrongType: true }, { corrupt: true }]) {
  await assert.rejects(fakeArchive(options).probe("dr1"));
}
// A hung network request receives an abort signal, not an unbounded wait.
const keepAlive = setInterval(() => {}, 500);
try {
  await assert.rejects(probeBrowseSurvey("dr1", {
    timeoutMs: 15, decodeImage: () => assert.fail("should not decode anything"),
    fetchImpl: (_url, { signal }) => new Promise((_yes, no) =>
      signal.addEventListener("abort", () => no(signal.reason), { once: true })),
  }), { name: "TimeoutError" });
} finally {
  clearInterval(keepAlive);
}

function mapFixture() {
  const container = { hidden: true, appendChild() {}, addEventListener() {} };
  const status = { textContent: "" };
  const surface = { hidden: true };
  const context = new SkyContext(container, status, null, { surface });
  const handlers = new Map(), layers = [];
  let mapCreated = false, centre, fov;
  const A = {
    aladin(el, options) {
      assert.equal(el, container);
      assert.equal(mapCreated, false, "fallback does not rebuild or recenter the viewer");
      mapCreated = true;
      assert.deepEqual(options.survey, [], "do not start an implicit default survey");
      assert.equal(options.showLayersControl, false, "attribution stays in sync with the displayed layer");
      assert.equal(options.fov, BROWSE_START.fovDeg);
      return {
        on(event, fn) { handlers.set(event, fn); },
        gotoRaDec(ra, dec) { centre = [ra, dec]; },
        getRaDec() { return centre; },
        setFoV(value) { fov = value; },
        setBaseImageLayer(layer) { layers.push(layer); },
      };
    },
    imageHiPS(root, options) { return { root, options }; },
  };
  return { context, status, surface, handlers, layers, get position() { return { centre, fov }; },
    start: (probe, loadViewer = async () => A) => context.openBrowse({ loadViewer, probe }) };
}

globalThis.document = { createElement: () => ({}) };
try {
  const map = mapFixture();
  const probe = fakeArchive();
  const opened = map.start(probe.probe);
  await new Promise(setImmediate);
  assert.deepEqual(map.position, { centre: [269.4462, 4.769], fov: 12 });
  assert.equal(map.context.query, null, "does not set or request a cutout field");
  assert.equal(map.status.textContent, "Loading sky map…", "wait for layer installation before attribution");
  const [layer] = map.layers;
  assert.equal(layer.root, dr1.root);
  assert.equal(layer.options.imgFormat, "png");
  layer.options.successCallback();
  assert.equal(await opened, "dr1");
  assert.match(map.status.textContent, /SPHEREx DR1 · 0\.753 µm mosaic · IRSA/);
  assert.equal(map.surface.hidden, false);
  map.context.aladin.gotoRaDec(4, -62);
  map.handlers.get("positionChanged")();
  map.context.aladin.setFoV(1);
  assert.equal(map.layers.length, 1, "map gestures do not probe or select a layer");
  assert.equal(probe.seen.length, 3);
  assert.equal(map.context.browseSurvey, "dr1");
  map.context.centreBrowse();
  assert.deepEqual(map.position, { centre: [269.4462, 4.769], fov: 12 });

  for (const path of ["/properties", "/Norder3/Allsky.png", "/Norder0/Dir0/Npix7.png"]) {
    const failed = mapFixture();
    const opened = failed.start(fakeArchive({ failUrl: dr1.root + path }).probe);
    await new Promise(setImmediate);
    assert.match(failed.status.textContent, /DR1 map unavailable.*Loading 2MASS fallback/);
    assert.deepEqual(failed.layers.map(({ root }) => root), [twoMass.root], "never install unverified DR1");
    assert.equal(failed.layers[0].options.imgFormat, "jpeg");
    failed.layers[0].options.successCallback();
    assert.equal(await opened, "2mass");
    assert.match(failed.status.textContent, /Showing 2MASS.*not SPHEREx data/);
  }

  const badLayer = mapFixture();
  const badLayerOpened = badLayer.start(fakeArchive().probe);
  await new Promise(setImmediate);
  badLayer.layers[0].options.errorCallback(new Error("layer construction failed"));
  await new Promise(setImmediate);
  badLayer.layers[1].options.successCallback();
  assert.equal(await badLayerOpened, "2mass");

  const unavailable = mapFixture();
  assert.equal(await unavailable.start(async () => { throw new Error("offline"); }), null);
  assert.match(unavailable.status.textContent, /Neither SPHEREx DR1 nor the 2MASS fallback could load/);
  assert.equal(unavailable.surface.hidden, true);

  const noWebGL = mapFixture();
  await noWebGL.start(() => assert.fail("viewer failed"), async () => { throw new Error("WebGL2 unsupported"); });
  assert.match(noWebGL.status.textContent, /Aladin Lite could not start.*WebGL2/);
  assert.equal(noWebGL.surface.hidden, true);
} finally {
  delete globalThis.document;
}

const main = readFileSync(new URL("../frontend/js/main.js", import.meta.url), "utf8");
assert.match(main, /if \(SKY_BROWSE\) document\.documentElement\.classList\.add\("sky-browse"\)/);
assert.match(main, /async function loadData\([^\n]+\) \{\s*if \(SKY_BROWSE\) return;/);
assert.match(main, /function retryLastRequest\(\) \{\s*if \(SKY_BROWSE\) return;/);
assert.match(main, /form\.addEventListener\("submit", \(event\) => \{\s*event\.preventDefault\(\);[^\n]*\n\s*if \(SKY_BROWSE\) return;/);
assert.match(main, /if \(SKY_BROWSE\) \{\s*applyUrlState\(\);[^\n]*\n\s*void openSkyBrowse\(\);\s*\} else \{\s*renderQuickPicks\(\);\s*applyUrlState\(\);/);

console.log("PASS sky browse opt-in, acquisition guards, PNG readiness and 2MASS fallback");
