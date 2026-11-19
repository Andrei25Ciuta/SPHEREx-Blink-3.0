import assert from "node:assert/strict";

const nodes = new Map();
function node(id) {
  if (!nodes.has(id)) nodes.set(id, {
    attributes: new Map(), style: {}, naturalWidth: 50, naturalHeight: 50,
    setAttribute(name, value) { this.attributes.set(name, value); },
    getAttribute(name) { return this.attributes.get(name); },
    addEventListener(name, fn) { this[name] = fn; },
    add() {},
    append(...children) { (this.children ??= []).push(...children); },
    replaceChildren() { this.children = []; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  });
  return nodes.get(id);
}
let nextElement = 0;
globalThis.document = { getElementById: node, createElement: () => node(`element-${nextElement++}`) };
globalThis.Option = class {};
globalThis.window = { matchMedia: () => ({ matches: true }) };
let calls = 0;
globalThis.fetch = async (url) => {
  assert.match(url, /\/api\/cutouts\?/);
  calls++;
  return Response.json({ frames: [60000, 60365.25, 60730.5].map((mjd) => ({
    mjd, detector: "D2", dateISO: "2025-01-01T00:00:00Z",
    wavelengthMinUm: 1.1, wavelengthMaxUm: 1.2, pixelScaleArcsec: 6,
    imageUrl: `https://example.test/${mjd}.png`,
  })) });
};
await import("../frontend/js/dailyReal.js");
node("daily-real-mode").click();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(node("daily-synthetic").hidden, true);
assert.equal(node("daily-real-viewer").hidden, false);
const image = node("daily-real-image");
image.load();
image.click({ clientX: 40, clientY: 50 });
assert.equal(node("daily-real-submit").disabled, true);
assert.equal(node("daily-real-results-frames").children.length, 1);
node("daily-real-epoch").value = "1";
node("daily-real-epoch").change();
image.load();
image.click({ clientX: 60, clientY: 50 });
assert.equal(node("daily-real-submit").disabled, false);
assert.equal(node("daily-real-marks").textContent, "2 marked frames.");
assert.equal(node("daily-real-motion").textContent, "");
assert.equal(node("daily-real-results-frames").children.length, 2);
node("daily-real-epoch").value = "2";
node("daily-real-epoch").change();
assert.equal(node("daily-real-submit").disabled, false);
node("daily-real-submit").click();
assert.match(node("daily-real-motion").textContent, /60.0 arcsec\/year · right/);
assert.equal(node("daily-real-details").hidden, false);
assert.match(node("daily-real-rating").textContent, /needs 3/);
const thumbnails = node("daily-real-results-frames");
assert.equal(thumbnails.hidden, false);
assert.deepEqual(thumbnails.children.map((item) => item.children[0].children[0].children[0].src),
  ["https://example.test/60000.png", "https://example.test/60365.25.png"]);
assert.equal(node("daily-real-path").getAttribute("points"), "40,50 60,50");
image.load();
image.click({ clientX: 65, clientY: 50 });
assert.equal(thumbnails.children.length, 3);
assert.equal(node("daily-real-motion").textContent, "");
image.click({ clientX: 70, clientY: 50 });
assert.equal(thumbnails.children.length, 3);
node("daily-real-submit").click();
assert.equal(thumbnails.children.length, 3);
assert.equal(node("daily-real-rating").textContent, "★☆☆☆☆ · 29/100 consistency");
assert.match(node("daily-real-fit").textContent, /2.50 px/);
node("daily-synthetic-mode").click();
assert.equal(node("daily-synthetic").hidden, false);
node("daily-real-mode").click();
assert.equal(calls, 1);
node("daily-real-clear").click();
assert.equal(thumbnails.hidden, true);
assert.equal(thumbnails.children.length, 0);
console.log("PASS real mode, prepared frames, marks and motion");
