// Tests for Astra (features/spaceGuide.js, astraKnowledge.js): which prepared note answers a question, and the on-device AI path with a fake model.
// Run: node scratch/test_astra.mjs
import { findAnswers, answerAstra, askAstra, astraPrompt, aiAvailability, NOTES, SYSTEM_PROMPT } from "../frontend/js/features/spaceGuide.js";
import { KNOWLEDGE } from "../frontend/js/features/astraKnowledge.js";

let failed = 0;
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`); if (!ok) failed++; }

// ---- the notes
check("about sixty notes, each with an id, a label, keys and an answer of one to six sentences", NOTES.length >= 55 && KNOWLEDGE.every((k) => k.id && k.label && k.keys.length && k.answer.length > 60 && k.answer.length < 700));
check("note ids are unique", new Set(KNOWLEDGE.map((k) => k.id)).size === KNOWLEDGE.length);
check("no note claims a discovery by this project", !NOTES.some((n) => /we (have )?(found|discovered)|this (site|project) (found|discovered)/i.test(n.answer)));

// ---- questions a learner may ask, in different words, and the note that must come first
const EXPECT = [
  ["What is infrared light?", "Infrared light"], ["why do astronomers use infrared", "Why astronomers use infrared"], ["What is a black hole?", "Black holes"],
  ["how old is the universe", "The Big Bang"], ["What is a brown dwarf?", "Brown dwarfs"], ["Tell me about WISE 0855", "Brown dwarfs"],
  ["How did they find Pluto?", "Pluto"], ["what does blink mean", "Blink comparator"], ["Is Planet Nine real?", "Planet X search"],
  ["what is parallax", "Parallax"], ["How far is a light year?", "Light-year"], ["what are asteroids made of", "Asteroids"],
  ["When did SPHEREx launch?", "When SPHEREx launched"], ["what is a detector", "Detectors"], ["is there life on other planets", "Life in space"],
  ["what is dark matter", "Dark matter and dark energy"], ["why is the sky dusty in infrared? dust clouds", "Why astronomers use infrared"],
  ["Why do stars have different colours?", "Star colours"], ["What is Barnard's Star?", "Barnard's Star"], ["what is a supernova", "Supernovae"],
  ["How does gravity keep planets in orbit?", "Gravity and orbits"], ["What is a comet?", "Comets"], ["what is a galaxy", "Galaxy"], ["what is a nebula", "Nebula"],
  ["is the data real or synthetic", "Synthetic data"], ["what does sigma mean", "Significance (sigma)"], ["What is a candidate?", "Candidate"], ["What is a candidate mover?", "Candidate mover"],
  ["How does SPHEREx measure 102 colours?", "How SPHEREx measures colours"], ["what is the Kuiper belt", "Kuiper Belt"], ["What is redshift?", "Redshift"],
];
const wrong = EXPECT.filter(([q, label]) => findAnswers(q, 1)[0]?.label !== label).map(([q, label]) => `${q} -> ${findAnswers(q, 1)[0]?.label ?? "nothing"} (wanted ${label})`);
check(`${EXPECT.length} learner questions in their own words get the right note first`, wrong.length === 0, wrong.join(" | "));
check("the old behaviour stays: infrared is answered from the glossary, an unknown question gets the honest fallback", answerAstra("What is infrared light?").includes("cannot see it") && /prepared answer/.test(answerAstra("how far is my spaceship")));
check("a question with nothing about space finds no note (no forced match)", findAnswers("what should I eat for dinner").length === 0);

// ---- the AI path, with a fake model
function fakeModel({ reply = "Infrared is light we cannot see.", fail = false, stream = true } = {}) {
  const seen = { system: null, prompt: null, destroyed: false };
  return { seen, availability: async () => "available", create: async ({ initialPrompts }) => {
    seen.system = initialPrompts[0].content;
    if (fail) throw new Error("model not ready");
    return { destroy: () => { seen.destroyed = true; },
      prompt: async (p) => { seen.prompt = p; return reply; },
      ...(stream ? { promptStreaming: async function* (p) { seen.prompt = p; yield reply.slice(0, 10); yield reply.slice(10); } } : {}) };
  } };
}
{
  const m = fakeModel(), chunks = [];
  const r = await askAstra("What is infrared light?", { model: m, onChunk: (t) => chunks.push(t) });
  check("with the browser's AI: the answer is the model's, marked as AI, and the session is closed", r.source === "ai" && r.text === "Infrared is light we cannot see." && m.seen.destroyed);
  check("the model is given the guide's rules and the matching notes", m.seen.system === SYSTEM_PROMPT && /Never claim/.test(SYSTEM_PROMPT) && m.seen.prompt.includes("Infrared light:") && m.seen.prompt.includes("Question: What is infrared light?"));
  check("the answer is shown while it is written (streamed pieces are joined)", chunks.at(-1) === "Infrared is light we cannot see." && chunks.length === 2);
  const r2 = await askAstra("What is infrared light?", { model: fakeModel({ stream: false }) });
  check("a model without streaming works too", r2.source === "ai" && r2.text.startsWith("Infrared"));
  const r3 = await askAstra("What is a black hole?", { model: fakeModel({ fail: true }) });
  check("if the model fails, the prepared note is given and the failure is reported", r3.source === "notes" && /Black holes/.test(r3.text) && r3.error === "model not ready");
  const r4 = await askAstra("What is a black hole?", { model: fakeModel({ reply: "   " }) });
  check("an empty AI answer is not shown: the note is given instead", r4.source === "notes" && r4.error);
  const r5 = await askAstra("what should I eat for dinner", {});
  check("without the AI and without a note, the source says none", r5.source === "none");
  check("the prompt cuts a very long question and says when no note matched", astraPrompt("x".repeat(1000), []).includes("no prepared note") && astraPrompt("x".repeat(1000), []).length < 400);
  check("no LanguageModel in this environment means 'unavailable' (never an error)", (await aiAvailability(undefined)) === "unavailable" && (await aiAvailability({ availability: async () => { throw new Error("x"); } })) === "unavailable");
}

// ---------------------------------------------------------------- the free in-browser model (WebLLM), with a fake engine
{
  const { createWebLlmModel, webGpuReady } = await import("../frontend/js/features/webLlmModel.js");
  let created = 0, sent = null, progress = [];
  const fakeLib = { CreateMLCEngine: async (id, cfg) => { created++; cfg.initProgressCallback({ progress: 0.5, text: "half" }); cfg.initProgressCallback({ progress: 1, text: "done" });
    return { chat: { completions: { create: async (req) => { sent = req; return (async function* () { yield { choices: [{ delta: { content: "Infrared is " } }] }; yield { choices: [{ delta: { content: "invisible light." } }] }; })(); } } } }; } };
  const gpuNav = { gpu: { requestAdapter: async () => ({}) } };
  const m = createWebLlmModel({ loadLibrary: async () => fakeLib, nav: gpuNav });
  check("no WebGPU means the free model is 'unavailable'; with it, 'downloadable' and nothing loaded yet", (await webGpuReady({})) === false && (await createWebLlmModel({ loadLibrary: async () => fakeLib, nav: {} }).availability()) === "unavailable" && (await m.availability()) === "downloadable" && created === 0);
  const r = await askAstra("What is infrared light?", { model: m, onDownload: (f) => progress.push(f) });
  check("the free model answers through askAstra, streaming, with the guide's rules and the notes", r.source === "ai" && r.text === "Infrared is invisible light." && sent.messages[0].role === "system" && sent.messages[0].content === SYSTEM_PROMPT && /Question: What is infrared light\?/.test(sent.messages.at(-1).content) && sent.stream === true);
  check("download progress is reported, and the engine is made once", progress.join() === "0.5,1" && (await askAstra("What is a galaxy?", { model: m }), created === 1));
  check("the guide answers any safe question, in English, and still never claims a discovery", /any question that is safe/.test(SYSTEM_PROMPT) && /in English/.test(SYSTEM_PROMPT) && /Never claim/.test(SYSTEM_PROMPT));
  const { looksNotEnglish } = await import("../frontend/js/features/spaceGuide.js");
  check("a Romanian question is spotted, English ones are not", looksNotEnglish("Ce este o gaura neagra?") && looksNotEnglish("De ce strălucesc stelele?") && !looksNotEnglish("What is a black hole?") && !looksNotEnglish("Why is the sky blue during the day?"));
}

console.log(failed ? `\n${failed} FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
