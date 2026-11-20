import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const overview = await readFile(new URL("../frontend/overview.html", import.meta.url), "utf8");
assert.match(overview, /href="daily\.html\?challenge=real"/);
const daily = await readFile(new URL("../frontend/daily.html", import.meta.url), "utf8");
assert.ok(daily.indexOf('id="daily-real-game"') > daily.indexOf('id="daily-real-results-frames"'));

const day = 20778;
Date.now = () => day * 86400000;
const nodes = new Map();
const streakClasses = new Set();
function element(id) {
  if (!nodes.has(id)) nodes.set(id, {
    hidden: true, naturalWidth: 49, naturalHeight: 49, complete: true,
    classList: { add: (name) => streakClasses.add(name), remove: (name) => streakClasses.delete(name) },
    style: { setProperty() {} },
    setAttribute() {},
    addEventListener(name, callback) { this[name] = callback; },
    replaceChildren() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 49, height: 49 }),
  });
  return nodes.get(id);
}
let nextElementId = 0;
globalThis.document = {
  getElementById: element,
  createElement: () => element(`celebration-${nextElementId++}`),
};
globalThis.window = { matchMedia: () => ({ matches: false }), location: { search: "?challenge=real" } };
const epochA = 60908.981929;
const epochB = 61121.228205;
globalThis.fetch = async (url) => {
  assert.match(url, /\/api\/sequences\/barnard-d2$/);
  return Response.json({
    dataKind: "real",
    revision: "a75a1f6eaba54cba997233319b47bd3e",
    frames: [epochA, epochB].map((mjd) => ({
      mjd, dateISO: "2026-01-01T00:00:00Z", imageUrl: `https://example.test/${mjd}.png`,
      pixelScaleArcsec: 6.1386,
    })),
  });
};
await import("../frontend/js/dailyRealGame.js");
assert.equal(element("daily-real-game").hidden, false);
assert.equal(element("daily-mode-controls").hidden, true);
assert.equal(element("daily-real").hidden, true);
const image = element("real-game-image");
assert.match(image.src, /60908/);
let tick;
globalThis.setInterval = (callback) => { tick = callback; return 1; };
globalThis.clearInterval = () => { tick = undefined; };
element("real-game-blink").click();
image.click({ clientX: 24.41, clientY: 25.58 });
assert.equal(element("real-game-submit").disabled, true);
assert.equal(typeof tick, "function");
tick();
assert.match(image.src, /61121/);
element("real-game-b").click();
assert.match(image.src, /61121/);
image.click({ clientX: 24.49, clientY: 24.60 });
assert.equal(typeof tick, "function");
element("real-game-submit").click();
assert.equal(tick, undefined);
assert.match(element("real-game-status").textContent, /Barnard’s Star found · 100\/100/);
assert.equal(element("real-game-streak-count").textContent, "1");
assert.equal(streakClasses.has("is-glowing"), true);
element("real-game-streak-bubble").animationend();
assert.equal(streakClasses.has("is-glowing"), false);
assert.equal(element("daily-toast").textContent, "Well done! Real challenge completed. 1-day streak.");
const { clearDailyToast } = await import("../frontend/js/dailyCelebration.js");
clearDailyToast();
assert.equal(element("real-game-share").hidden, false);
console.log("PASS real daily pair, catalogue scoring and streak");
