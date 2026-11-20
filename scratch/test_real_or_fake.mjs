import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dailyCandidates, makeCandidate } from "../frontend/js/realOrFake.js";

const day = "2026-11-21";
const questions = dailyCandidates(day);
assert.equal(questions.length, 10);
assert.equal(questions.filter(({ kind }) => kind === "artefact").length, 5);
assert.deepEqual(questions, dailyCandidates(day));
assert.notDeepEqual(questions, dailyCandidates("2026-11-22"));
const training = await readFile(new URL("../frontend/daily.html", import.meta.url), "utf8");
assert.match(training, /href="real-or-fake.html"/);
assert.doesNotMatch(training, /Identify the object/);
assert.doesNotMatch(training, /href="training-quiz\.html"/);
const page = await readFile(new URL("../frontend/real-or-fake.html", import.meta.url), "utf8");
assert.match(page, /Synthetic training/);
assert.match(page, /Today’s leaderboard/);
assert.equal([...page.matchAll(/data-classification-answer="([^"]+)"/g)].map((match) => match[1]).join(), "real,fake");
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
      children: [],
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
const NativeDate = Date;
let today = day;
globalThis.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [today])); }
};
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
const posted = [];
let failSave = true;
globalThis.fetch = async (url, options) => {
  assert.ok(options.headers.apikey);
  if (options.method === "POST") {
    assert.equal(new URL(url).pathname, "/rest/v1/classification_scores");
    assert.match(options.headers.Prefer, /resolution=ignore-duplicates/);
    posted.push(JSON.parse(options.body));
    return { ok: !failSave, status: 503 };
  }
  const request = new URL(url);
  assert.equal(request.pathname, "/rest/v1/classification_daily_best");
  assert.equal(request.searchParams.get("play_day"), `eq.${today}`);
  assert.equal(request.searchParams.get("order"), "score.desc,elapsed_ms.asc,created_at.asc,id.asc");
  assert.equal(request.searchParams.get("limit"), "10");
  return { ok: true, json: async () => [
    { nickname: "Vega", score: 10, elapsed_ms: 14000 },
    { nickname: "Altair", score: 10, elapsed_ms: 15230 },
  ] };
};
element("classification-image").getContext = () => ({
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  putImageData() {}, beginPath() {}, arc() {}, stroke() {},
});
await import("../frontend/js/realOrFake.js?ui");
await new Promise(setImmediate);

const rankings = element("classification-scores");
assert.deepEqual(rankings.children[0].children.map((child) => child.textContent), ["#1", "Vega", "10/10 · 14.000 s"]);
assert.equal(rankings.children[1].children[1].textContent, "Altair");
assert.equal(element("classification-board-date").textContent, `${day} UTC`);

const correct = (index) => answers[Number(questions[index].kind === "artefact")];
const label = (index) => ({ star: "Star", asteroid: "Asteroid", artefact: "Artefact" })[questions[index].kind];
const next = element("classification-next");
assert.equal(tick, undefined);
element("classification-start").click();
assert.equal(element("classification-seconds").textContent, "10");
assert.equal(frames[0].attributes.get("aria-pressed"), "true");
time = 700;
tick();
assert.equal(frames[1].attributes.get("aria-pressed"), "true");
frames[2].click();
assert.equal(element("classification-blink").attributes.get("aria-pressed"), "false");
correct(0).click();
assert.equal(tick, undefined);
assert.equal(element("classification-result").children[0].textContent, `Correct · ${label(0)}`);
assert.equal(next.hidden, false);
time += 3000;
next.click();
time += 13000;
tick();
assert.equal(element("classification-seconds").textContent, "0");
assert.equal(element("classification-result").children[0].textContent, `Time’s up · ${label(1)}`);
assert.ok(answers.every((answer) => answer.disabled));
for (let i = 3; i <= 10; i++) {
  time += 3000;
  next.click();
  assert.equal(element("classification-question").textContent, `Question ${i} of 10`);
  time += 350;
  correct(i - 1).click();
}
assert.equal(element("classification-result").children.at(-1).textContent, "Final score: 9/10 · 13.500 s");
assert.equal(next.textContent, "Play again");
const form = element("classification-share-score");
assert.equal(form.hidden, false);
const nickname = element("classification-nickname");
nickname.value = "  Nova  ";
const formEvent = { preventDefault() {} };
await form.submit(formEvent);
assert.match(element("classification-share-status").textContent, /Try again/);
assert.equal(element("classification-publish-score").disabled, false);
failSave = false;
await form.submit(formEvent);
assert.deepEqual(posted[1], posted[0]);
assert.deepEqual(posted[1], { id: posted[0].id, play_day: day, nickname: "Nova", score: 9, elapsed_ms: 13500 });
assert.equal(element("classification-share-status").textContent, "Score posted to the shared leaderboard.");
await form.submit(formEvent);
assert.equal(posted.length, 2);
next.click();
assert.equal(form.hidden, true);
assert.equal(element("classification-ready").hidden, false);
element("classification-start").click();
for (let i = 0; i < 10; i++) {
  correct(i).click();
  if (i < 9) next.click();
}
today = "2026-11-22";
await form.submit(formEvent);
assert.match(element("classification-share-status").textContent, /new daily round/);
assert.equal(posted.length, 2);
next.click();
element("classification-start").click();
await new Promise(setImmediate);
assert.equal(element("classification-board-date").textContent, `${today} UTC`);
console.log("PASS daily candidates, blink, answer timing, replay and shared leaderboard");
