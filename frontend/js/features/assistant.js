// assistant.js – an explainer that is allowed to say only what was measured (pure: no DOM, no network, no language model).
//
// Every sentence it writes carries the ids of the measured values it is made from ("cites"), and a validator checks it: each cited id must exist, and EVERY NUMBER in the sentence must
// be one of the cited values (to the digits shown). A sentence with no citation is only allowed when it is a fixed caution that contains no number. So an explanation cannot contain a
// figure that is not in the evidence, and a reader can click a citation and see where the figure comes from.
//
// It works with no key and no network: the sentences are written by rules from the numbers. The same validator is the gate for a language model, if one is ever connected (promptFor
// and parseModelAnswer are the two ends of that road; NO provider is connected in this project, and one would be a decision, because the evidence would leave the machine): whatever a
// model returns is parsed as [{ text, cites }] and rejected, sentence by sentence, unless it passes.
//
//   evidenceFromCandidate()   the measured values of one candidate and of its field, as { id: { label, value, unit, source } }
//   explain(kind, evidence)   the sentences ("why", "wrong" or "next") with their citations
//   validateSentences()       is every sentence grounded? -> { ok, problems }
//   promptFor / parseModelAnswer   the two ends of the optional road to a language model

/** Name of this version (written into what it produces). First written 9 Nov 2026. */
export const VERSION = "assistant-1";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const item = (label, value, unit = "", source = "") => ({ label, value, unit, source });

/**
 * The evidence: every measured value the explainer may use.
 * c = a candidate as the page keeps it (speedArcsecPerYear, positionAngleDeg, compass, nDet, nFrames, significance, falseAlarm, rms, support, known, label, ra, dec, vErrPx);
 * ctx = { scaleArcsec, fieldRa, fieldDec, fovArcmin, images, passes, runVersion, ranAt, realData, models (modelComparison result or null) }.
 */
export function evidenceFromCandidate(c, ctx) {
  const e = {};
  const src = `Find movers ${ctx.runVersion ?? "(version unknown)"}${ctx.ranAt ? `, run ${String(ctx.ranAt).slice(0, 19).replace("T", " ")}` : ""}`;
  e["cand.label"] = item("Candidate", String(c.label ?? "#?"), "", src);
  if (isNum(c.speedArcsecPerYear)) e["cand.speed"] = item("Apparent motion", c.speedArcsecPerYear, "″/yr", src);
  if (isNum(c.vErrPx) && isNum(ctx.scaleArcsec)) e["cand.speedErr"] = item("Error of that motion (1σ)", c.vErrPx * ctx.scaleArcsec, "″/yr", `${src}; propagated from the errors of its dots (VALIDATION 15)`);
  if (isNum(c.positionAngleDeg)) e["cand.angle"] = item("Direction (position angle, north through east)", c.positionAngleDeg, "°", src);
  if (c.compass) e["cand.compass"] = item("Direction in words", String(c.compass), "", src);
  if (isNum(c.nDet)) e["cand.dots"] = item("Dots on its line", c.nDet, "", src);
  if (isNum(c.nFrames)) e["cand.frames"] = item("Images compared", c.nFrames, "", src);
  if (isNum(c.significance)) e["cand.significance"] = item("Significance (speed over its error)", c.significance, "σ", src);
  if (isNum(c.falseAlarm)) e["cand.chance"] = item("Chance lines this good expected in the whole field", c.falseAlarm, "", `${src}; calibrated on real empty sky (VALIDATION 10)`);
  if (isNum(c.rms)) e["cand.rms"] = item("Scatter of its dots about the line", c.rms, "px", src);
  if (c.support && isNum(c.support.supported) && isNum(c.support.measurable)) {
    e["cand.supported"] = item("Images where its flux is present at the predicted place", c.support.supported, "", `${src} (trackSupport)`);
    e["cand.measurable"] = item("Images where that could be measured", c.support.measurable, "", `${src} (trackSupport)`);
    e["cand.missing"] = item("Images where it could be measured but its flux is absent", c.support.measurable - c.support.supported, "", "measurable minus present: a difference of the two values above");
  }
  e["cand.known"] = item("Known object it matches", c.known ? String(c.known) : "none found", "", `${src}; catalogues: ${ctx.catalogues ?? "see the run"}`);
  if (isNum(ctx.fieldRa) && isNum(ctx.fieldDec)) { e["field.ra"] = item("Field centre RA", ctx.fieldRa, "°", "the field on screen"); e["field.dec"] = item("Field centre Dec", ctx.fieldDec, "°", "the field on screen"); }
  if (isNum(ctx.fovArcmin)) e["field.fov"] = item("Field of view", ctx.fovArcmin, "′", "the field on screen");
  if (isNum(ctx.images)) e["field.images"] = item("Images of the field", ctx.images, "", "the field on screen");
  if (isNum(ctx.passes)) e["field.passes"] = item("Survey passes", ctx.passes, "", "the field on screen");
  e["data.real"] = item("Kind of data", ctx.realData ? "real SPHEREx images" : "synthetic demo images", "", "the data source of the page");
  const mc = ctx.models;
  if (mc?.usable) {
    const best = mc.models.find((m) => m.id === mc.preferred), lin = mc.models.find((m) => m.id === "linear"), par = mc.models.find((m) => m.id === "parallax");
    e["models.preferred"] = item("Motion that fits best", best.label, "", "Planet X Lab, comparison by BIC");
    if (best.reducedChi2 !== null) e["models.chi2"] = item("χ² per degree of freedom of that model", best.reducedChi2, "", "Planet X Lab (error 0.15 px per dot, not calibrated)");
    if (lin.usable && par.usable) e["models.gain"] = item("BIC of the line minus BIC of the parallax model", lin.bic - par.bic, "", "Planet X Lab");
    e["models.distance"] = item("Distance verdict", mc.distance.status, "", "Planet X Lab");
  }
  return e;
}

// ------------------------------------------------------------------ writing

const f = (v, d = 1) => Number(v).toFixed(d);
/** "2.0e-21" or "0.35": a small number in a form the validator reads back. */
const small = (v) => (v !== 0 && Math.abs(v) < 0.01 ? v.toExponential(1) : String(Number(v.toPrecision(2))));
const s = (text, cites, extra = {}) => ({ text, cites, ...extra });
const have = (e, ...ids) => ids.every((id) => id in e);

/** The fixed cautions: no number, no citation needed. */
export const CAUTIONS = {
  lead: "A candidate is a lead, not a discovery: it says where to look, and a person has to look.",
  unlabelled: "Nothing here has been confirmed by anything outside this analysis.",
  synthetic: "These are synthetic demo images: the numbers show how the tool works, not what the sky holds.",
};

/**
 * The sentences for a question: "why" (why is it a candidate), "wrong" (what could make it wrong), "next" (what to check next).
 * -> [{ text, cites: [ids], fixed?: true }]
 */
export function explain(kind, e) {
  const out = [];
  const synthetic = e["data.real"]?.value !== "real SPHEREx images";
  if (kind === "why") {
    if (have(e, "cand.label", "cand.speed", "cand.compass", "cand.angle", "cand.dots", "cand.frames")) {
      out.push(s(`Candidate ${e["cand.label"].value} moves ${f(e["cand.speed"].value)}″ a year toward ${e["cand.compass"].value} (position angle ${f(e["cand.angle"].value, 0)}°), measured from ${e["cand.dots"].value} dots in ${e["cand.frames"].value} images.`,
        ["cand.label", "cand.speed", "cand.compass", "cand.angle", "cand.dots", "cand.frames"]));
    }
    if (have(e, "cand.speedErr", "cand.significance")) out.push(s(`The motion is known to ±${f(e["cand.speedErr"].value, 2)}″ a year, which makes a straight line through its dots ${f(e["cand.significance"].value, 0)}σ different from standing still.`, ["cand.speedErr", "cand.significance"]));
    if (have(e, "cand.chance")) out.push(s(`The number of lines this good that chance would make among the dots of this whole field is expected to be ${small(e["cand.chance"].value)}.`, ["cand.chance"]));
    if (have(e, "cand.supported", "cand.measurable")) out.push(s(`Its flux is present at the predicted place in ${e["cand.supported"].value} of ${e["cand.measurable"].value} images where that could be measured.`, ["cand.supported", "cand.measurable"]));
    if (have(e, "cand.known")) {
      const known = e["cand.known"].value !== "none found";
      out.push(s(known ? `It matches ${e["cand.known"].value}, a known object, so the search found something that was already catalogued.` : "No catalogued object was found at its place by the search, so it is not explained by what was asked.", ["cand.known"]));
    }
  } else if (kind === "wrong") {
    if (have(e, "cand.chance") && e["cand.chance"].value > 0.001) out.push(s(`It could be chance: the field is expected to make ${small(e["cand.chance"].value)} lines this good by itself.`, ["cand.chance"]));
    if (have(e, "cand.supported", "cand.measurable") && e["cand.supported"].value < 0.8 * e["cand.measurable"].value) out.push(s(`It is present at the predicted place in only ${e["cand.supported"].value} of ${e["cand.measurable"].value} images: a real object usually is in nearly all of them.`, ["cand.supported", "cand.measurable"]));
    if (have(e, "cand.dots", "cand.frames") && e["cand.dots"].value < 0.6 * e["cand.frames"].value) out.push(s(`Only ${e["cand.dots"].value} of the ${e["cand.frames"].value} images have a dot on its line.`, ["cand.dots", "cand.frames"]));
    if (have(e, "cand.rms")) out.push(s(`Its dots scatter ${f(e["cand.rms"].value, 2)} px about the line: a larger scatter would mean they are not one object.`, ["cand.rms"]));
    if (have(e, "models.preferred", "models.chi2") && e["models.chi2"].value > 3) out.push(s(`Even the motion that fits best (${e["models.preferred"].value}) fits badly: χ² per degree of freedom is ${f(e["models.chi2"].value, 1)}, so the dots are not following a simple path.`, ["models.preferred", "models.chi2"]));
    if (have(e, "cand.known") && e["cand.known"].value !== "none found") out.push(s(`If it is ${e["cand.known"].value}, it is not new: check that the motion agrees with the catalogue's.`, ["cand.known"]));
    if (!out.length) out.push(s("Nothing in the measured numbers argues against it, which is not the same as being right: the checks below are the ones that could.", [], { fixed: true }));
  } else {
    if (have(e, "field.images", "field.passes")) out.push(s(`Look at the ${e["field.images"].value} images of the field (${e["field.passes"].value} survey passes) with Difference and Trail: does the dot move between them?`, ["field.images", "field.passes"]));
    if (have(e, "cand.supported", "cand.measurable", "cand.missing") && e["cand.missing"].value > 0) out.push(s(`Open its spectrum along the path: it is missing in ${e["cand.missing"].value} of ${e["cand.measurable"].value} images, and a real object may simply be faint in some wavelengths.`, ["cand.missing", "cand.measurable"]));
    if (have(e, "models.distance")) out.push(s(e["models.distance"].value === "not-claimed" ? "The Planet X Lab does not claim a distance for it: a straight line explains its positions." : `The Planet X Lab's distance verdict is “${e["models.distance"].value}”: read its range, not only its best value.`, ["models.distance"]));
    out.push(s("Compare it with the other detector (a dot can be too faint in one wavelength band) and with the sky map of what is known there.", [], { fixed: true }));
  }
  out.push(s(CAUTIONS.lead, [], { fixed: true }));
  if (synthetic) out.push(s(CAUTIONS.synthetic, [], { fixed: true }));
  return out;
}

// ------------------------------------------------------------------ checking

/** The numbers in a text: "12.5″", "7 of 24", "2.0e-21", "−3" ("−" is read as a minus sign). */
export function numbersIn(text) {
  return [...String(text).replace(/−/g, "-").matchAll(/(?<![\p{L}\p{N}_.])-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/giu)].map((m) => Number(m[0]));
}

/** The numbers a cited item can show: itself at 0 to 4 decimals, and (for text) the numbers inside it ("#1" -> 1). */
function allowedFrom(it) {
  const out = new Set();
  if (isNum(it.value)) { for (let d = 0; d <= 4; d++) out.add(Number(it.value.toFixed(d))); out.add(Number(it.value.toExponential(1))); out.add(Number(it.value.toPrecision(2))); out.add(Math.abs(Number(it.value.toFixed(2)))); }
  else for (const n of numbersIn(it.value)) out.add(n);
  return out;
}

/**
 * Is every sentence grounded? sentences: [{ text, cites, fixed? }]; evidence as made by evidenceFromCandidate.
 * Rules: a cited id must exist; every number in the text must be one of the cited values (to the digits shown); a sentence without citations is accepted only if it is marked fixed AND has no number.
 * -> { ok, problems: [{ index, text, problem }] }
 */
export function validateSentences(sentences, evidence) {
  const problems = [];
  (sentences ?? []).forEach((st, index) => {
    const bad = (problem) => problems.push({ index, text: st?.text ?? "", problem });
    if (!st || typeof st.text !== "string" || !st.text.trim()) return bad("empty sentence");
    const cites = Array.isArray(st.cites) ? st.cites : [];
    const nums = numbersIn(st.text);
    if (!cites.length) { if (!st.fixed) bad("no citation"); else if (nums.length) bad("a fixed sentence may not contain a number"); return; }
    const missing = cites.filter((id) => !(id in evidence));
    if (missing.length) return bad(`cites unknown evidence: ${missing.join(", ")}`);
    const allowed = new Set(cites.flatMap((id) => [...allowedFrom(evidence[id])]));
    const stray = nums.filter((n) => ![...allowed].some((a) => (a === 0 ? n === 0 : Math.abs(a - n) <= Math.abs(a) * 1e-9)));       // relative: 3e-21 is not 2e-21, and not 0
    if (stray.length) bad(`number not in the cited evidence: ${stray.join(", ")}`);
  });
  return { ok: problems.length === 0, problems };
}

// ------------------------------------------------------------------ the optional road to a language model (nothing is connected)

/** The prompt that would be sent: the instructions and ONLY the evidence (derived numbers: no pixels, no file names). */
export function promptFor(question, evidence) {
  const lines = Object.entries(evidence).map(([id, it]) => `${id} = ${isNum(it.value) ? it.value : JSON.stringify(it.value)} ${it.unit}  (${it.label})`);
  return [
    "You explain the result of an analysis of infrared sky images. Use ONLY the evidence below.",
    "Answer with a JSON array of objects {\"text\": string, \"cites\": [evidence ids]}. Every sentence must cite the ids it is made from; every number in a sentence must be a cited value.",
    "Never claim a discovery. Say what is measured and what is not.",
    `Question: ${question}`, "Evidence:", ...lines,
  ].join("\n");
}

/** A model's answer -> sentences, or { error }. Accepts bare JSON or JSON inside a code fence; anything else is refused. */
export function parseModelAnswer(text) {
  const raw = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let data;
  try { data = JSON.parse(raw); } catch { return { error: "the answer is not JSON" }; }
  if (!Array.isArray(data) || !data.length) return { error: "the answer is not a list of sentences" };
  const sentences = data.map((x) => ({ text: typeof x?.text === "string" ? x.text : "", cites: Array.isArray(x?.cites) ? x.cites.filter((c) => typeof c === "string") : [] }));
  return { sentences };
}

/** What may be shown of a model's answer: only the sentences that pass (and how many were refused). Nothing is shown unless it is grounded. */
export function acceptModelAnswer(text, evidence) {
  const parsed = parseModelAnswer(text);
  if (parsed.error) return { accepted: [], refused: [], error: parsed.error };
  const accepted = [], refused = [];
  parsed.sentences.forEach((st) => (validateSentences([st], evidence).ok ? accepted : refused).push(st));
  return { accepted, refused, error: null };
}
