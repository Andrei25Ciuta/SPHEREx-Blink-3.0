import assert from "node:assert/strict";
import { THEORY_QUESTIONS } from "../frontend/js/trainingQuiz.js";

assert.equal(THEORY_QUESTIONS.length, 10);
assert.equal(new Set(THEORY_QUESTIONS.map(({ slug }) => slug)).size, 10);
assert.ok(THEORY_QUESTIONS.every(({ quiz }) =>
  quiz.choices.some(({ id }) => id === quiz.answer)));

const nodes = new Map();
function element(id) {
  if (!nodes.has(id)) nodes.set(id, {
    addEventListener(name, callback) { this[name] = callback; },
    replaceChildren(...children) { this.children = children; },
    toggleAttribute() {},
    focus() {},
  });
  return nodes.get(id);
}
let counter = 0;
globalThis.document = {
  getElementById: element,
  createElement: () => element(`choice-${counter++}`),
};
await import("../frontend/js/trainingQuiz.js?ui");
const next = element("theory-next");
for (const [index, { quiz }] of THEORY_QUESTIONS.entries()) {
  next.click();
  assert.equal(element("theory-progress").textContent, `Question ${index + 1} of 10`);
  const button = element("theory-answers").children[quiz.choices.findIndex(({ id }) => id === quiz.answer)];
  button.click();
  button.click(); // A repeated action must not increment the score.
}
next.click();
assert.equal(element("theory-prompt").textContent, "Final score: 10/10");
next.click();
assert.equal(element("theory-progress").textContent, "Question 1 of 10");
console.log("PASS ten theory questions, grading, score and replay");
