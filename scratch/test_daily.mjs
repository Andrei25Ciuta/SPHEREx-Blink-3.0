import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mulberry32 } from "../frontend/js/data/mockSource.js";

const overview = await readFile(new URL("../frontend/overview.html", import.meta.url), "utf8");
assert.match(overview, /href="daily\.html"[^>]*><span>Play today’s field/);
const daily = await readFile(new URL("../frontend/daily.html", import.meta.url), "utf8");
assert.match(daily, /<aside id="daily-results"[\s\S]*id="daily-share"[\s\S]*<\/aside>/);
let day = 20776;
Date.now = () => day * 86400000;
const nodes = new Map();
const context = {
  createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
  putImageData() {}, beginPath() {}, arc() {}, stroke() {}, clearRect() {}, drawImage() {},
};
let reducedMotion = false;
globalThis.window = { matchMedia: () => ({ matches: reducedMotion }) };
globalThis.document = {
  createElement: () => ({ style: { setProperty() {} }, addEventListener() {} }),
  getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, {
      addEventListener(type, callback) { this[type] = callback; },
      setAttribute() {},
      classList: {
        items: new Set(),
        has(token) { return this.items.has(token); },
        toggle(token, enabled) {
          if (enabled) this.items.add(token);
          else this.items.delete(token);
        },
      },
      focus() {},
      replaceChildren(...children) { this.children = children; },
      width: 256,
      height: 256,
      getContext: () => context,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 256, height: 256 }),
    });
    return nodes.get(id);
  },
};
const storage = new Map();
Object.defineProperty(globalThis, "localStorage", { value: {
  getItem: (key) => storage.get(key),
  setItem: (key, value) => storage.set(key, value),
} });
await import("../frontend/js/daily.js");
const image = nodes.get("daily-image");
const submit = nodes.get("daily-submit");
const guess = (x, y) => image.click({ clientX: x * 4, clientY: y * 4 });

guess(0, 0);
assert.equal(submit.disabled, true);
nodes.get("frame-b").click();
guess(0, 0);
submit.click();
assert.equal(nodes.get("daily-status").textContent, "2 attempts left.");
const rng = mulberry32(day);
const x = 14 + rng() * 36;
const y = 14 + rng() * 36;
const vx = 5 + rng() * 5;
const vy = 3 + rng() * 5;
const targetX = x + vx * (rng() < .5 ? -1 : 1);
const targetY = y + vy * (rng() < .5 ? -1 : 1);
nodes.get("frame-a").click();
guess(x, y);
nodes.get("frame-b").click();
guess(targetX, targetY);
submit.click();
assert.equal(nodes.get("daily-status").textContent, "Found in 2/3 · 90/100 points.");
assert.match(nodes.get("daily-measurement").textContent, /Your estimate: .*px\/year/);
assert.equal(nodes.get("daily-found").hidden, false);
assert.equal(nodes.get("daily-results-title").textContent, "Object found");
assert.equal(nodes.get("daily-results").classList.has("is-open"), true);
assert.equal(nodes.get("daily-speed").hidden, false);
assert.equal(nodes.get("daily-speed").textContent, `${Math.hypot(vx, vy).toFixed(1)} px/year`);
assert.match(nodes.get("daily-direction").textContent, /^Toward /);
assert.equal(nodes.get("daily-position-a").textContent, `X ${x.toFixed(1)} · Y ${y.toFixed(1)} px`);
assert.equal(nodes.get("daily-position-b").textContent, `X ${targetX.toFixed(1)} · Y ${targetY.toFixed(1)} px`);
assert.match(nodes.get("daily-preview-caption").textContent, /Frame B/);
assert.equal(nodes.get("daily-celebration").children.length, 12);
nodes.get("frame-a").click();
assert.match(nodes.get("daily-preview-caption").textContent, /Frame A/);
assert.equal(nodes.get("daily-result-actions").hidden, false);
assert.equal(nodes.get("daily-streak").textContent, "Streak: 1 day · 1 freeze available");
nodes.get("daily-replay").click();
assert.equal(nodes.get("daily-found").hidden, true);
assert.equal(nodes.get("daily-results").classList.has("is-open"), false);
assert.equal(nodes.get("daily-speed").hidden, true);
assert.equal(nodes.get("daily-direction").hidden, true);
assert.equal(nodes.get("daily-celebration").children.length, 0);
reducedMotion = true;
assert.equal(nodes.get("daily-status").textContent, "3 attempts left.");
assert.equal(submit.disabled, true);
assert.equal(nodes.get("daily-result-actions").hidden, true);
nodes.get("frame-b").click();
nodes.get("frame-a").click();
guess(x, y);
nodes.get("frame-b").click();
guess(targetX, targetY);
submit.click();
assert.equal(nodes.get("daily-streak").textContent, "Streak: 1 day · 1 freeze available");
assert.equal(nodes.get("daily-found").hidden, false);
assert.equal(nodes.get("daily-celebration").children.length, 0);
await import("../frontend/js/daily.js?reload");
assert.equal(nodes.get("daily-status").textContent, "3 attempts left.");
assert.equal(submit.disabled, true);
assert.equal(nodes.get("daily-streak").textContent, "Streak: 1 day · 1 freeze available");
// Three misses complete a day and count as play.
function loseRound() {
  for (let i = 0; i < 3; i++) {
    nodes.get("frame-a").click();
    guess(0, 0);
    nodes.get("frame-b").click();
    guess(0, 0);
    submit.click();
  }
  assert.equal(nodes.get("daily-status").textContent, "Out of attempts · 0/100 points.");
  assert.equal(nodes.get("daily-results-title").textContent, "Round complete");
  assert.equal(nodes.get("daily-found").hidden, true);
  assert.equal(nodes.get("daily-speed").hidden, false);
  assert.equal(nodes.get("daily-result-actions").hidden, false);
}

day += 2;
await import("../frontend/js/daily.js?skip-one");
loseRound();
assert.equal(nodes.get("daily-streak").textContent, "Streak: 2 days · Freeze used");
day += 2;
await import("../frontend/js/daily.js?skip-again");
loseRound();
assert.equal(nodes.get("daily-streak").textContent, "Streak: 1 day · 1 freeze available");
globalThis.location = { href: "https://example.org/daily.html" };
let shared;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
  clipboard: { writeText: async (text) => { shared = text; } },
} });
await nodes.get("daily-share").click();
assert.match(shared, /\n🟥🟥🟥 · 0\/100\nhttps:/);
assert.doesNotMatch(shared, /px\/year|Simulated motion/);
console.log("PASS daily scoring, motion, sharing, replay, streak freeze, source preview and celebration");
