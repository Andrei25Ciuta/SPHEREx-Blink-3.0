import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { makeCandidate } from "../frontend/js/realOrFake.js";

const training = await readFile(new URL("../frontend/daily.html", import.meta.url), "utf8");
assert.match(training, /href="real-or-fake.html"/);
assert.doesNotMatch(training, /Identify the object/);
assert.doesNotMatch(training, /href="training-quiz\.html"/);
const page = await readFile(new URL("../frontend/real-or-fake.html", import.meta.url), "utf8");
assert.match(page, /Synthetic training/);
for (const kind of ["star", "asteroid", "artefact"]) {
  const candidate = makeCandidate(kind, 1984);
  assert.equal(candidate.frames.length, 3);
  assert.ok(candidate.frames.every((frame) => frame.length === 48 * 48));
}
assert.deepEqual(makeCandidate("star", 21), makeCandidate("star", 21));

const elements = new Map();
function element(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      attributes: new Map(),
      setAttribute(name, value) { this.attributes.set(name, value); },
      removeAttribute(name) { this.attributes.delete(name); },
      toggleAttribute(name, value) { if (value) this.attributes.set(name, true); else this.attributes.delete(name); },
      addEventListener(type, handler) { this[type] = handler; },
      replaceChildren(...children) { this.children = children; },
      append(...children) { this.children.push(...children); },
      focus() {},
    });
  }
  return elements.get(id);
}
const frames = [element("frame1"), element("frame2"), element("frame3")];
const answers = ["real", "fake"].map((kind) => {
  const button = element(kind);
  button.dataset = { classificationAnswer: kind };
  return button;
});
let id = 0;
globalThis.document = {
  getElementById: element,
  createElement: () => element(`generated-${id++}`),
  querySelectorAll: (selector) => selector.includes("frame") ? frames : answers,
};
globalThis.window = { matchMedia: () => ({ matches: false }), location: { search: "" } };
let time = 0;
Object.defineProperty(globalThis, "performance", { value: { now: () => time } });
let tick;
globalThis.setInterval = (handler) => { tick = handler; return 1; };
globalThis.clearInterval = () => { tick = undefined; };
Math.random = () => .999;
element("classification-image").getContext = () => ({
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  putImageData() {}, beginPath() {}, arc() {}, stroke() {},
});
await import("../frontend/js/realOrFake.js?ui");

assert.equal(tick, undefined);
element("classification-start").click();
assert.equal(element("classification-seconds").textContent, "10");
assert.equal(frames[0].attributes.get("aria-pressed"), "true");
time = 700;
tick();
assert.equal(frames[1].attributes.get("aria-pressed"), "true");
frames[2].click();
assert.equal(element("classification-blink").attributes.get("aria-pressed"), "false");
answers[0].click();
assert.equal(tick, undefined);
assert.equal(element("classification-result").children[0].textContent, "Correct · Star");
assert.equal(element("classification-next").hidden, false);
element("classification-next").click();
time += 10000;
tick();
assert.equal(element("classification-seconds").textContent, "0");
assert.equal(element("classification-result").children[0].textContent, "Time’s up · Asteroid");
assert.ok(answers.every((answer) => answer.disabled));
for (let i = 3; i <= 10; i++) {
  element("classification-next").click();
  assert.equal(element("classification-question").textContent, `Question ${i} of 10`);
  answers[0].click();
}
assert.equal(element("classification-result").children.at(-1).textContent, "Final score: 4/10");
assert.equal(element("classification-next").textContent, "Play again");
element("classification-next").click();
assert.equal(element("classification-ready").hidden, false);
console.log("PASS synthetic candidates, blink, answers and ten-second deadline");
