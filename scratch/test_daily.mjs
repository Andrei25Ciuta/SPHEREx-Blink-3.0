import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mulberry32 } from "../frontend/js/data/mockSource.js";

const overview = await readFile(new URL("../frontend/overview.html", import.meta.url), "utf8");
assert.match(overview, /href="daily\.html"[^>]*><span>Play today’s field/);
const daily = await readFile(new URL("../frontend/daily.html", import.meta.url), "utf8");
assert.match(daily, /<div class="daily-heading">[\s\S]*id="daily-streak-count"[\s\S]*class="daily-layout"/);
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
      style: {},
      attributes: new Map(),
      setAttribute(name, value) { this.attributes.set(name, value); },
      classList: {
        items: new Set(),
        has(token) { return this.items.has(token); },
        add(token) { this.items.add(token); },
        remove(token) { this.items.delete(token); },
        toggle(token, enabled) {
          if (enabled) this.items.add(token);
          else this.items.delete(token);
        },
      },
      focus() {},
      replaceChildren(...children) { this.children = children; },
      width: id.startsWith("daily-preview-") ? 26 : 256,
      height: 256,
      getContext() {
        this.context ??= {
          ...context,
          putImageData(image) { this.image = image; },
          arc(x, y) { this.marker = { x, y }; },
        };
        return this.context;
      },
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
function assertStreak(count, freeze = "1 freeze available") {
  assert.equal(nodes.get("daily-streak-count").textContent, String(count));
  assert.equal(nodes.get("daily-streak-freeze").textContent, freeze);
}
assertStreak(0);
const image = nodes.get("daily-image");
const submit = nodes.get("daily-submit");
const guess = (x, y) => image.click({ clientX: x * 4, clientY: y * 4 });

// Advance playback without waiting for a real timer.
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
let tick;
globalThis.setInterval = (callback) => { tick = callback; return 1; };
globalThis.clearInterval = () => { tick = undefined; };
const blink = nodes.get("daily-blink");
blink.click();
assert.equal(blink.attributes.get("aria-pressed"), "true");
assert.equal(nodes.get("frame-b").attributes.get("aria-pressed"), "true");
tick();
assert.equal(nodes.get("frame-a").attributes.get("aria-pressed"), "true");
blink.click();
assert.equal(tick, undefined);
blink.click();
tick();
guess(0, 0);
assert.equal(blink.attributes.get("aria-pressed"), "false");
assert.equal(tick, undefined);
globalThis.setInterval = realSetInterval;
globalThis.clearInterval = realClearInterval;
assert.equal(submit.disabled, true);
assert.equal(nodes.get("daily-step-a").textContent, "Marked in A");
assert.equal(nodes.get("daily-check-a").textContent, "✓");
assert.equal(nodes.get("daily-step-b").textContent, "Mark in B");
nodes.get("frame-b").click();
guess(0, 0);
assert.equal(submit.disabled, false);
assert.equal(nodes.get("daily-check-b").textContent, "✓");
submit.click();
assert.equal(nodes.get("daily-attempt-stars").textContent, "★★☆");
assert.equal(nodes.get("daily-step-a").textContent, "Mark in A");
assert.equal(nodes.get("daily-step-b").textContent, "Mark in B");
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
assert.equal(nodes.get("daily-status").textContent, "Found in 2 of 3 attempts.");
assert.match(nodes.get("daily-measurement").textContent, /Your estimate: .*px\/year/);
assert.equal(nodes.get("daily-found").hidden, false);
assert.equal(nodes.get("daily-results-title").textContent, "Object found");
assert.equal(nodes.get("daily-results").classList.has("is-open"), true);
assert.equal(nodes.get("daily-speed").hidden, false);
assert.equal(nodes.get("daily-speed").textContent, `${Math.hypot(vx, vy).toFixed(1)} px/year`);
assert.match(nodes.get("daily-direction").textContent, /^Toward /);
assert.equal(nodes.get("daily-position-a").textContent, `X ${x.toFixed(1)} · Y ${y.toFixed(1)} px`);
assert.equal(nodes.get("daily-position-b").textContent, `X ${targetX.toFixed(1)} · Y ${targetY.toFixed(1)} px`);
assert.equal(nodes.get("daily-score").textContent, "90 / 100");
assert.equal(nodes.get("daily-progress").hidden, true);
const expectedAngle = (Math.atan2(targetY - y, targetX - x) * 180 / Math.PI + 360) % 360;
assert.match(nodes.get("daily-source-arrow").style.transform, /^rotate\(.+deg\)$/);
assert.ok(Math.abs(Number.parseFloat(nodes.get("daily-source-arrow").style.transform.slice(7)) - expectedAngle) < 1e-9);
const streakBadge = nodes.get("daily-streak-bubble");
assert.equal(streakBadge.classList.has("is-glowing"), true);
streakBadge.animationend();
assert.equal(streakBadge.classList.has("is-glowing"), false);
const previewA = nodes.get("daily-preview-a").context;
const previewB = nodes.get("daily-preview-b").context;
assert.equal(previewA.image.data.length, 26 * 26 * 4);
assert.notDeepEqual(previewA.image.data, previewB.image.data);
assert.ok(Math.abs((previewB.marker.x - previewA.marker.x) - (targetX - x)) < 1e-9);
assert.ok(Math.abs((previewB.marker.y - previewA.marker.y) - (targetY - y)) < 1e-9);
assert.equal(nodes.get("daily-celebration").children.length, 12);
assert.equal(nodes.get("daily-toast").textContent, "Well done! Object found. 1-day streak.");
nodes.get("frame-a").click();

assert.equal(nodes.get("daily-result-actions").hidden, false);
assertStreak(1);
nodes.get("daily-replay").click();
assert.equal(nodes.get("daily-found").hidden, true);
assert.equal(nodes.get("daily-results").classList.has("is-open"), false);
assert.equal(nodes.get("daily-speed").hidden, true);
assert.equal(nodes.get("daily-direction").hidden, true);
assert.equal(nodes.get("daily-celebration").children.length, 0);
assert.equal(nodes.get("daily-toast").textContent, "");
reducedMotion = true;
assert.equal(nodes.get("daily-status").textContent, "3 attempts left.");
assert.equal(nodes.get("daily-progress").hidden, false);
assert.equal(nodes.get("daily-attempt-stars").textContent, "★★★");
assert.equal(submit.disabled, true);
assert.equal(nodes.get("daily-result-actions").hidden, true);
nodes.get("frame-b").click();
nodes.get("frame-a").click();
guess(x, y);
nodes.get("frame-b").click();
guess(targetX, targetY);
submit.click();
assertStreak(1);
assert.equal(nodes.get("daily-found").hidden, false);
assert.equal(nodes.get("daily-celebration").children.length, 0);
assert.equal(streakBadge.classList.has("is-glowing"), false);
assert.equal(nodes.get("daily-toast").textContent, "Well done! Object found. 1-day streak.");
nodes.get("daily-replay").click();
await import("../frontend/js/daily.js?reload");
assert.equal(nodes.get("daily-status").textContent, "3 attempts left.");
assert.equal(submit.disabled, true);
assertStreak(1);
// Three misses complete a day and count as play.
function loseRound() {
  for (let i = 0; i < 3; i++) {
    nodes.get("frame-a").click();
    guess(0, 0);
    nodes.get("frame-b").click();
    guess(0, 0);
    submit.click();
  }
  assert.equal(nodes.get("daily-status").textContent, "Out of attempts.");
  assert.equal(nodes.get("daily-results-title").textContent, "Round complete");
  assert.equal(nodes.get("daily-found").hidden, true);
  assert.equal(nodes.get("daily-speed").hidden, false);
  assert.equal(nodes.get("daily-result-actions").hidden, false);
}

day += 2;
await import("../frontend/js/daily.js?skip-one");
loseRound();
assertStreak(2, "Freeze used");
day += 2;
await import("../frontend/js/daily.js?skip-again");
loseRound();
assertStreak(1);
globalThis.location = { href: "https://example.org/daily.html" };
let shared;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
  clipboard: { writeText: async (text) => { shared = text; } },
} });
await nodes.get("daily-share").click();
assert.match(shared, /\n🟥🟥🟥 · 0\/100\nhttps:/);
assert.doesNotMatch(shared, /px\/year|Simulated motion/);
console.log("PASS daily scoring, motion, sharing, replay, streak freeze, source preview, celebration, streak notification and guess progress");
