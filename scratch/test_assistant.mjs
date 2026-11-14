// Tests for the explainer (frontend/js/features/assistant.js): every sentence is made of cited, measured values, and a validator refuses anything else.   Run: node scratch/test_assistant.mjs
import { readFileSync } from "node:fs";
import { VERSION, CAUTIONS, evidenceFromCandidate, explain, numbersIn, validateSentences, promptFor, parseModelAnswer, acceptModelAnswer } from "../frontend/js/features/assistant.js";
import { mulberry32 } from "../frontend/js/features/planetLab.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  if (!ok) failed++;
}

const barnard = { label: "#1", speedArcsecPerYear: 10.14, vErrPx: 0.0065, positionAngleDeg: 354.2, compass: "N", nDet: 24, nFrames: 24, significance: 15.3, falseAlarm: 2e-21, rms: 0.06,
  support: { supported: 24, measurable: 24, fraction: 1 }, known: "Barnard's Star" };
const CTX = { scaleArcsec: 6.14, fieldRa: 269.4462, fieldDec: 4.769, fovArcmin: 5, images: 18, passes: 4, runVersion: "movers-2", ranAt: "2026-11-09T10:00:00.000Z", realData: true, catalogues: "SIMBAD, SkyBoT" };

// ---------------------------------------------------------------- the numbers of a sentence
check("numbers in a text: decimals, a minus sign (also the typographic one), exponents; digits stuck to letters (D2, 2MASS...) are names, not figures",
  JSON.stringify(numbersIn("10.1″ at −3 and 2.0e-21, 7 of 24; D2 and λ2")) === JSON.stringify([10.1, -3, 2e-21, 7, 24]) && numbersIn("no figures here").length === 0);
check("version", VERSION === "assistant-1");

// ---------------------------------------------------------------- the evidence
{
  const e = evidenceFromCandidate(barnard, CTX);
  check("evidence: every measured value is an item with a label, a value, a unit and where it comes from", Object.values(e).every((it) => typeof it.label === "string" && "value" in it && typeof it.unit === "string" && it.source.length > 3));
  check("evidence: the motion in arcsec per year, its error converted from pixels (0.0065 px/yr x 6.14 = 0.04 arcsec/yr), the direction, the dots and images, the significance, the chance, the support",
    e["cand.speed"].value === 10.14 && Math.abs(e["cand.speedErr"].value - 0.0065 * 6.14) < 1e-12 && e["cand.angle"].value === 354.2 && e["cand.compass"].value === "N" && e["cand.dots"].value === 24 && e["cand.significance"].value === 15.3
    && e["cand.chance"].value === 2e-21 && e["cand.supported"].value === 24 && e["cand.measurable"].value === 24 && e["cand.known"].value === "Barnard's Star");
  check("evidence: the source says which run (version and time) and the kind of data, and nothing from the pixels or the files is in it", e["cand.speed"].source.includes("movers-2") && e["cand.speed"].source.includes("2026-11-09 10:00:00") && e["data.real"].value === "real SPHEREx images"
    && !/\.fits|dataUrl|pixel values/i.test(JSON.stringify(e)));
  const sparse = evidenceFromCandidate({ label: "#2", speedArcsecPerYear: 3 }, { realData: false });
  check("evidence: a missing value is not in the evidence (not made up as 0); an unknown object says 'none found'; synthetic data says so", !("cand.significance" in sparse) && !("cand.chance" in sparse) && !("cand.supported" in sparse) && !("cand.speedErr" in sparse)
    && sparse["cand.known"].value === "none found" && sparse["data.real"].value === "synthetic demo images");
  const withModels = evidenceFromCandidate(barnard, { ...CTX, models: { usable: true, preferred: "linear", distance: { status: "not-claimed" }, models: [{ id: "linear", label: "Straight line", reducedChi2: 1.23, bic: 69.5, usable: true }, { id: "parallax", label: "Parallax", reducedChi2: 1.26, bic: 73.3, usable: true }, { id: "stationary", label: "Stationary", reducedChi2: 12, bic: 568, usable: true }] } });
  check("evidence: the Planet X Lab's comparison is added when there is one (preferred motion, chi2 per dof, the BIC gain, the distance verdict)", withModels["models.preferred"].value === "Straight line" && withModels["models.chi2"].value === 1.23 && Math.abs(withModels["models.gain"].value - (69.5 - 73.3)) < 1e-12 && withModels["models.distance"].value === "not-claimed");
}

// ---------------------------------------------------------------- the sentences
{
  const e = evidenceFromCandidate(barnard, CTX), why = explain("why", e);
  check("why: the sentences say the motion, its error and significance, the chance, the support and the match, in this order, each citing what it is made of", why.length === 6 && /^Candidate #1 moves 10\.1″ a year toward N \(position angle 354°\), measured from 24 dots in 24 images\.$/.test(why[0].text)
    && /±0\.04″ a year/.test(why[1].text) && /15σ/.test(why[1].text) && /2\.0e-21/.test(why[2].text) && /24 of 24 images/.test(why[3].text) && /Barnard's Star/.test(why[4].text) && why[0].cites.includes("cand.speed") && why[2].cites[0] === "cand.chance", why.map((x) => x.text).join(" | "));
  check("why: every sentence is grounded: the validator accepts them all, the closing caution says a candidate is a lead, not a discovery", validateSentences(why, e).ok && why.at(-1).text === CAUTIONS.lead && why.at(-1).fixed === true && why.slice(0, -1).every((x) => x.cites.length >= 1));
  const weak = evidenceFromCandidate({ ...barnard, falseAlarm: 0.4, support: { supported: 7, measurable: 20, fraction: 0.35 }, nDet: 9, rms: 0.7, known: null }, CTX), wrong = explain("wrong", weak);
  check("wrong: a likely chance line, thin support, few dots and a big scatter are each said with their own numbers, and all are grounded", wrong.length === 5 && /0\.4 lines this good/.test(wrong[0].text) && /only 7 of 20 images/.test(wrong[1].text) && /Only 9 of the 24 images/.test(wrong[2].text) && /0\.70 px/.test(wrong[3].text) && validateSentences(wrong, weak).ok, wrong.map((x) => x.text).join(" | "));
  const good = explain("wrong", e);
  const bare = evidenceFromCandidate({ label: "#3", speedArcsecPerYear: 2 }, { realData: true }), bareWrong = explain("wrong", bare);
  check("wrong: with nothing measured that argues against it, the answer says so with a fixed sentence (no number), never an invented doubt; and says it is not the same as being right",
    bareWrong.length === 2 && bareWrong[0].fixed === true && /Nothing in the measured numbers argues against it/.test(bareWrong[0].text) && /not the same as being right/.test(bareWrong[0].text) && validateSentences(bareWrong, bare).ok, bareWrong.map((x) => x.text).join(" | "));
  check("derived values are evidence too: the number of images it is missing from is its own cited item (measurable minus present), so a sentence that says 'missing in 13' cites it", "cand.missing" in weak && weak["cand.missing"].value === 13 && /difference of the two/.test(weak["cand.missing"].source));
  check("wrong: a strong candidate gets the scatter and the 'if it is a known object' sentences only (no chance or support warning)", !good.some((x) => /could be chance|only \d+ of/.test(x.text)) && good.some((x) => /Barnard's Star/.test(x.text)) && validateSentences(good, e).ok, good.map((x) => x.text).join(" | "));
  const next = explain("next", e);
  check("next: what to look at is built from the field's own numbers, and a candidate present in every image has no 'missing in' advice", /18 images of the field \(4 survey passes\)/.test(next[0].text) && !next.some((x) => /missing in/.test(x.text)) && validateSentences(next, e).ok);
  const nextWeak = explain("next", weak);
  check("next: a candidate absent from some images is told how many (13 of 20), grounded", nextWeak.some((x) => /missing in 13 of 20 images/.test(x.text)) && validateSentences(nextWeak, weak).ok);
  const syn = evidenceFromCandidate(barnard, { ...CTX, realData: false });
  check("synthetic data: the explanation says the images are synthetic and what that means", explain("why", syn).some((x) => x.text === CAUTIONS.synthetic) && !explain("why", e).some((x) => x.text === CAUTIONS.synthetic));
  const noModels = explain("next", e).filter((x) => x.cites.includes("models.distance")), withM = explain("next", withModels0());
  function withModels0() { return evidenceFromCandidate(barnard, { ...CTX, models: { usable: true, preferred: "linear", distance: { status: "not-claimed" }, models: [{ id: "linear", label: "Straight line", reducedChi2: 1.2, bic: 70, usable: true }, { id: "parallax", label: "P", reducedChi2: 1.3, bic: 73, usable: true }] } }); }
  check("next: the Planet X Lab's verdict is quoted only when the lab was run", noModels.length === 0 && withM.some((x) => x.cites.includes("models.distance") && /does not claim a distance/.test(x.text)));
}

// ---------------------------------------------------------------- the validator refuses what is not grounded
{
  const e = evidenceFromCandidate(barnard, CTX);
  const bad = (text, cites, extra = {}) => validateSentences([{ text, cites, ...extra }], e);
  check("validator: a number that is not in the cited evidence is refused (20σ when the significance is 15.3)", !bad("It is 20σ significant.", ["cand.significance"]).ok && /number not in the cited evidence: 20/.test(bad("It is 20σ significant.", ["cand.significance"]).problems[0].problem));
  check("validator: the right number to the digits shown is accepted, a rounding the other way is not (10.14 shown as 10.1 or 10; 10.2 is refused)", bad("It moves 10.1″ a year.", ["cand.speed"]).ok && bad("It moves 10″ a year.", ["cand.speed"]).ok && !bad("It moves 10.2″ a year.", ["cand.speed"]).ok);
  check("validator: a number that IS in the evidence but is not cited is refused (the sentence must cite what it uses)", !bad("It is seen in 24 images.", ["cand.speed"]).ok && bad("It is seen in 24 images.", ["cand.frames"]).ok);
  check("validator: a citation of something that does not exist is refused; a sentence with no citation is refused unless it is a fixed caution; a fixed caution with a number is refused; an empty sentence is refused",
    !bad("It moves.", ["cand.nonsense"]).ok && !bad("It moves a lot.", []).ok && bad("Take care.", [], { fixed: true }).ok && !bad("Take care, 3 times.", [], { fixed: true }).ok && !bad("   ", ["cand.speed"]).ok && !validateSentences([null], e).ok && !validateSentences([{ cites: ["cand.speed"] }], e).ok);
  check("validator: names with digits and the label '#1' are read through the cited text (the known object, the candidate)", bad("It matches Barnard's Star.", ["cand.known"]).ok && bad("Candidate #1 is here.", ["cand.label"]).ok && !bad("Candidate #2 is here.", ["cand.label"]).ok);
  check("validator: a negative number and a small one in exponent form are read back (−3 for -3.04, 2.0e-21)", validateSentences([{ text: "The gain is −3.", cites: ["x"] }], { x: { label: "g", value: -3.04, unit: "", source: "t" } }).ok && bad("Chance is 2.0e-21.", ["cand.chance"]).ok && !bad("Chance is 3.0e-21.", ["cand.chance"]).ok);
  check("validator: with no sentences it has nothing to refuse (ok), and it lists every problem with the sentence's place", validateSentences([], e).ok && validateSentences([{ text: "a 99", cites: ["cand.speed"] }, { text: "b", cites: [] }], e).problems.map((p) => p.index).join() === "0,1");
}

// ---------------------------------------------------------------- the guarantee, at random
{
  const rng = mulberry32(11);
  let bad = 0, total = 0, checked = 0;
  for (let i = 0; i < 300; i++) {
    const c = {
      label: `#${1 + Math.floor(rng() * 9)}`, speedArcsecPerYear: rng() < 0.1 ? undefined : 0.05 + rng() * 40, vErrPx: rng() * 0.2, positionAngleDeg: rng() * 360, compass: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.floor(rng() * 8)],
      nDet: 3 + Math.floor(rng() * 30), nFrames: 10 + Math.floor(rng() * 30), significance: rng() * 60, falseAlarm: rng() < 0.3 ? 10 ** -(rng() * 25) : rng(), rms: rng() * 0.8,
      support: rng() < 0.2 ? undefined : (() => { const m = 5 + Math.floor(rng() * 25); return { supported: Math.floor(rng() * (m + 1)), measurable: m }; })(), known: rng() < 0.5 ? null : ["Barnard's Star", "2MASS J17574849+0441405", "Gaia DR3 4472832130942575872"][Math.floor(rng() * 3)],
    };
    const e = evidenceFromCandidate(c, { ...CTX, realData: rng() < 0.7 });
    for (const kind of ["why", "wrong", "next"]) { const r = validateSentences(explain(kind, e), e); total++; if (!r.ok) { bad++; if (bad < 4) console.log("   ", kind, JSON.stringify(r.problems[0])); } checked += explain(kind, e).length; }
  }
  check(`guarantee: ${total} explanations of ${checked} sentences for 300 random candidates (values from 1e-25 to 360, names with digits, missing fields): every one passes the validator`, bad === 0, `${bad} failed`);
}

// ---------------------------------------------------------------- the optional road to a language model (nothing is connected)
{
  const e = evidenceFromCandidate(barnard, CTX), prompt = promptFor("Why is it a candidate?", e);
  check("prompt: the instructions and ONLY derived numbers: the evidence ids with values and units, the question; nothing of the pixels, the files or the page", /Use ONLY the evidence/.test(prompt) && prompt.includes("cand.speed = 10.14 ″/yr") && prompt.includes("Question: Why is it a candidate?") && !/fits|dataUrl|base64|http/i.test(prompt));
  check("answer parsing: bare JSON and JSON in a code fence are read; anything else is refused with a reason", parseModelAnswer('[{"text":"a","cites":["cand.speed"]}]').sentences.length === 1 && parseModelAnswer('```json\n[{"text":"a","cites":[]}]\n```').sentences.length === 1
    && parseModelAnswer("Sure! Here is my answer").error === "the answer is not JSON" && parseModelAnswer("{}").error === "the answer is not a list of sentences" && parseModelAnswer("[]").error === "the answer is not a list of sentences");
  const answer = JSON.stringify([{ text: "It moves 10.1″ a year toward N.", cites: ["cand.speed", "cand.compass"] }, { text: "It is a certain discovery of 3 planets.", cites: ["cand.speed"] }, { text: "No source for this.", cites: [] }, { text: "It has 24 dots.", cites: ["cand.dots"] }]);
  const r = acceptModelAnswer(answer, e);
  check("a model's answer: only the sentences that are grounded are kept; the invented number (3 planets), the sentence without a citation are refused, and counted", r.accepted.length === 2 && r.refused.length === 2 && r.refused.some((x) => /3 planets/.test(x.text)) && r.accepted.every((x) => validateSentences([x], e).ok) && r.error === null);
  check("a model's answer that is not usable gives nothing to show, only the reason", acceptModelAnswer("I cannot help", e).accepted.length === 0 && acceptModelAnswer("I cannot help", e).error === "the answer is not JSON");
  const src = readFileSync(new URL("../frontend/js/features/assistant.js", import.meta.url), "utf8");
  check("no provider is connected: the module has no network call, no key, no storage and no DOM", !/fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|document\.|window\.|api[_-]?key|Authorization/i.test(src.replace(/\/\/.*$/gm, "")));
}

// ---------------------------------------------------------------- the page
{
  const HTML = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
  const MAIN = readFileSync(new URL("../frontend/js/main.js", import.meta.url), "utf8");
  const VIEW = readFileSync(new URL("../frontend/js/features/assistantView.js", import.meta.url), "utf8");
  const wired = [...(/setupAssistant\(\{\s*els: \{([\s\S]*?)\},\s*getContext/.exec(MAIN)?.[1] ?? "").matchAll(/\$\("([\w-]+)"\)/g)].map((m) => m[1]);
  check("page: main.js wires the explainer to ids that exist in index.html, after the sky explorer and with the Workspace Solar System panel removed", wired.length >= 5 && wired.every((id) => HTML.includes(`id="${id}"`)) && HTML.indexOf('id="assistant"') > HTML.indexOf('id="sky-explorer"') && !HTML.includes('id="solar-system"') && HTML.indexOf('id="assistant"') < HTML.indexOf("</main>"), wired.filter((id) => !HTML.includes(`id="${id}"`)).join(", "));
  const sec = HTML.slice(HTML.indexOf('id="assistant"'));
  check("page: three questions, and the page says that no language model is used, that it needs no key or network, and that every sentence cites its measured values", (sec.match(/data-kind="(why|wrong|next)"/g) || []).length === 3 && /No language model is used/.test(sec) && /without a key or a network/.test(sec) && /ids of the measured values/.test(sec));
  check("page: the view shows an answer only if the validator passes it (a sentence that is not grounded is never shown), and quotes the Planet X Lab's comparison only for the candidate it was made for",
    /validateSentences\(sentences, evidence\)/.test(VIEW) && /if \(!check\.ok\)[\s\S]{0,400}return;/.test(VIEW) && /comparisonFor\(m\.label\)/.test(MAIN) && /comparisonFor: \(label\) => \(lastComparison\?\.label === label/.test(readFileSync(new URL("../frontend/js/features/planetLabView.js", import.meta.url), "utf8")));
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exitCode = failed ? 1 : 0;
