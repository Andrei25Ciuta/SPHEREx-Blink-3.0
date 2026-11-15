// spaceGuide.js – Astra, the guide of the Learn page, and the "Explain simply" words of Science Mode.
//
// Two ways to answer, always labelled on the page:
//   1. Prepared notes (offline, reviewed): the glossary below and the larger set in astraKnowledge.js, found by matching the words of the question.
//   2. The AI built into the browser (Chrome's on-device model, the Prompt API "LanguageModel"), when the browser has it: no key, no server, the question
//      never leaves the computer. It is given the best-matching notes and told to stay with them; its answer is marked as written by an AI that can be wrong.
// Pure except askAstra, whose model is passed in (so Node can test it with a fake): scratch/test_learning.mjs, scratch/test_astra.mjs.

import { KNOWLEDGE } from "./astraKnowledge.js";

export const GLOSSARY = [
  { terms: ["redshift"], label: "Redshift", simple: "Light waves stretch as the universe expands, a little like the waves from a siren spread out as it moves away. That stretching can shift light toward redder and infrared wavelengths.", context: "Redshift is a change in wavelength caused by motion or the expansion of space. Astronomers use it to learn about distant objects; it is not a direct ruler by itself." },
  { terms: ["spectral signature", "spectrum", "spectroscopy"], label: "Spectral signature", simple: "A pattern in an object's light, like a set of fingerprints. It can give clues about the materials around the object.", context: "A spectrum measures light across wavelengths. Absorption and emission features can identify physical conditions and molecules, with interpretation depending on the data and model." },
  { terms: ["signal-to-noise ratio", "signal to noise", "snr"], label: "Signal-to-noise ratio", simple: "How clearly a signal rises above random background. A higher number usually makes a source easier to see.", context: "Signal-to-noise compares measured source signal with an estimate of noise. It describes detectability, not whether an object is new or what it is." },
  { terms: ["candidate mover", "mover", "moving object"], label: "Candidate mover", simple: "A dot that seems to shift between pictures taken at different times. It is a clue to check, not a confirmed discovery.", context: "A moving-source candidate is linked from image detections. Chance alignments, blends, variables, and artefacts can mimic motion." },
  { terms: ["infrared emission", "infrared", "ir light"], label: "Infrared light", simple: "Light beyond the red edge of the rainbow. Your eyes cannot see it, but telescopes can measure it; warm objects and dust can glow in infrared.", context: "Infrared has longer wavelengths than visible light. Some infrared wavelengths pass through dusty regions more readily than visible light." },
  { terms: ["provenance", "data source"], label: "Provenance", simple: "A record of where data came from and how it was handled, so another person can check the work.", context: "In this project, provenance records whether inputs are synthetic or observed and captures details of the analysis run." },
  { terms: ["nebula", "nebulae"], label: "Nebula", simple: "A huge cloud of gas and dust in space. Some are places where stars form; others are material released by dying stars.", context: "Nebulae have different physical origins and appearances; a single image can show only some of their structure." },
  { terms: ["galaxy", "galaxies"], label: "Galaxy", simple: "A very large family of stars, gas, dust, and other matter held together by gravity.", context: "Galaxies vary in structure. Their light can be studied across wavelengths to learn about their stars and history." },
  { terms: ["planet x", "planet nine", "distant body"], label: "Planet X search", simple: "The project tests whether a moving dot matches a pattern expected from Earth's orbit. A match is a candidate, not proof a planet exists.", context: "A parallax fit is model-dependent. Planet X is hypothetical; this application does not claim to have found it." },
];

const FALLBACK = {
  label: "Astra's space guide",
  simple: "I do not have a prepared answer for that yet. Try asking about infrared light, stars, nebulae, galaxies, moving objects, or Planet X.",
  context: "Astra uses a small offline set of reviewed explanations. It does not send your question to a model or search the internet.",
};

function normalize(text) {
  return String(text ?? "").toLocaleLowerCase().replace(/[–—]/g, "-").replace(/[’']/g, "'").trim();
}

/** The glossary entry a text names (Science Mode "Explain simply", lesson terms), or the fallback. */
export function explanationFor(text) {
  const query = normalize(text);
  return GLOSSARY.find((item) => item.terms.some((term) => query.includes(term))) ?? FALLBACK;
}

// ---------------------------------------------------------------- finding the notes that answer a question

const STOP = new Set("a an the is are was were be do does did what whats what's how who when where which can could would should will of in on at to for from by with about and or it its this that these those i you we me my your our tell explain please there their they them than then so if into as much many some any very".split(" "));
const tokens = (text) => normalize(text).replace(/[^a-z0-9\- ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
const stem = (w) => (w.length > 4 && w.endsWith("es") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);

/** All notes as one list: { id, label, keys, answer, glossary? }. */
export const NOTES = [
  ...GLOSSARY.map((g) => ({ id: `glossary:${g.label}`, label: g.label, keys: g.terms, answer: g.simple, glossary: true })),
  ...KNOWLEDGE,
];

// How many notes use each word in their keys: a word many notes share ("star", "light") says less about the question than a rare one ("barnard", "launch").
const DF = new Map();
for (const note of NOTES) for (const w of new Set(note.keys.flatMap((k) => tokens(k).map(stem)))) DF.set(w, (DF.get(w) ?? 0) + 1);
const weight = (w) => 1 / (DF.get(w) ?? 1);

/**
 * How well a note matches a question. Each key counts the weights of its words (rare words count more): twice when the key's words stand together in the question,
 * once when they are all there but apart; a key whose words are not all in the question counts nothing. A glossary note wins an exact tie.
 */
export function scoreNote(note, question) {
  const words = tokens(question).map(stem), q = ` ${words.join(" ")} `;
  let score = 0;
  const seen = new Set();                                              // "colour" and "colours" are one key
  for (const key of note.keys) {
    const kw = tokens(key).map(stem);
    if (seen.has(kw.join(" "))) continue;
    seen.add(kw.join(" "));
    if (!kw.length || !kw.every((w) => words.includes(w))) continue;
    const sum = kw.reduce((t, w) => t + weight(w), 0);
    score += kw.length > 1 && q.includes(` ${kw.join(" ")} `) ? 2 * sum : sum;
  }
  return score > 0 && note.glossary ? score + 0.01 : score;
}

/** The notes that best answer a question, best first (at most n). */
export function findAnswers(question, n = 3) {
  return NOTES.map((note) => ({ note, score: scoreNote(note, question) })).filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score).slice(0, n).map((x) => x.note);
}

/** The prepared answer as one line ("Label: answer"), or the fallback. */
export function answerAstra(question) {
  const best = findAnswers(question, 1)[0];
  return best ? `${best.label}: ${best.answer}` : `${FALLBACK.label}: ${FALLBACK.simple}`;
}

// ---------------------------------------------------------------- the AI in the browser

export const SYSTEM_PROMPT = [
  "You are Astra, a friendly space guide on an educational website about NASA's SPHEREx infrared telescope and a tool that finds moving objects by blinking images.",
  "Your readers are curious beginners about 10 to 15 years old. Answer in at most 6 short, clear sentences, in English, with an everyday comparison when it helps.",
  "Use the reference notes you are given when they are relevant, and do not contradict them. If you are not sure of a fact, say so plainly instead of guessing.",
  "Never claim that this website or project discovered a new object or Planet X: a candidate is a lead to check, not a discovery.",
  "You may answer any question that is safe and suitable for students, on any school subject; keep it short and, when it fits, link it back to space or science. Politely refuse anything harmful, adult or unkind.",
  "When you explain how to use this website, only describe tools named in the notes; if you do not know where something is, say so.",
].join(" ");

/** The user message given to the model: the question and the matching notes. */
/** Small AI models answer other languages badly (tried in Romanian, 14 Nov 2026): spot a question that is clearly not English so the page can ask for English. */
export function looksNotEnglish(question) {
  const q = ` ${normalize(question)} `;
  if (/[ăâîșşțţ]/.test(q)) return true;
  const ro = [" ce ", " este ", " sunt ", " cum ", " care ", " de ce ", " unde ", " cand ", " când ", " pentru ", " stelele ", " si ", " și ", " gaura ", " neagra "];
  return ro.filter((w) => q.includes(w)).length >= 2;
}

export function astraPrompt(question, notes) {
  const ref = notes.length ? notes.map((n) => `- ${n.label}: ${n.answer}`).join("\n") : "- (no prepared note matches this question)";
  return `Reference notes:\n${ref}\n\nQuestion: ${String(question).slice(0, 300)}`;
}

/** Whether the browser's on-device model can be used: "available" | "downloadable" | "downloading" | "unavailable". */
export async function aiAvailability(model = globalThis.LanguageModel) {
  if (!model?.availability) return "unavailable";
  try { return await model.availability(); } catch { return "unavailable"; }
}

/**
 * Answer a question. With `model` (the browser's LanguageModel) the on-device AI writes the answer from the notes; without it, or if it fails, the prepared answer is given.
 * -> { text, source: "ai" | "notes" | "none", notes: [labels], error? }.  onChunk(textSoFar) receives the AI answer while it is written.
 */
export async function askAstra(question, { model = null, signal, onChunk, onDownload } = {}) {
  const notes = findAnswers(question, 3);
  const prepared = () => (notes.length ? { text: `${notes[0].label}: ${notes[0].answer}`, source: "notes", notes: notes.map((n) => n.label) }
    : { text: `${FALLBACK.label}: ${FALLBACK.simple}`, source: "none", notes: [] });
  if (!model) return prepared();
  let session;
  try {
    session = await model.create({
      initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }], signal,
      monitor: onDownload ? (m) => m.addEventListener("downloadprogress", (e) => onDownload(e.loaded)) : undefined,
    });
    const prompt = astraPrompt(question, notes);
    let text = "";
    if (session.promptStreaming) {
      for await (const chunk of session.promptStreaming(prompt, { signal })) {
        text = chunk.startsWith(text) ? chunk : text + chunk;            // some versions send the whole text so far, newer ones only the new part
        onChunk?.(text);
      }
    } else text = await session.prompt(prompt, { signal });
    text = text.trim();
    if (!text) throw new Error("The model gave an empty answer.");
    return { text, source: "ai", notes: notes.map((n) => n.label) };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ...prepared(), error: error.message };
  } finally {
    session?.destroy?.();
  }
}
