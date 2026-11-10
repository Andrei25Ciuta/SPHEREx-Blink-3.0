// assistantView.js – the page part of the explainer (the sentences and the check are in assistant.js, tested with Node).
//
//   const assistant = setupAssistant({ els, getContext });   // getContext() -> { candidate, ctx } for the candidate selected in the list, or null
//   assistant.refresh();                                     // call it when the selection changes
//
// Three questions (why is it a candidate, what could make it wrong, what to check next). The answer is a list of sentences, each followed by the ids of the measured values it is made of; a
// click on an id marks that value in the table of the evidence. The page runs the validator on every answer and shows it ONLY if it passes: a sentence that is not grounded is never shown.
// No language model is used, nothing is sent anywhere.

import { VERSION, evidenceFromCandidate, explain, validateSentences } from "./assistant.js";

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const show = (it) => (typeof it.value === "number" ? `${Number(it.value.toPrecision(4))}${it.unit ? ` ${it.unit}` : ""}` : String(it.value));

export function setupAssistant({ els, getContext }) {
  let evidence = null;

  function refresh() {
    const ok = Boolean(getContext());
    for (const b of els.buttons) b.disabled = !ok;
    if (!ok && !els.out.children.length) els.status.textContent = "Select a candidate in the list (Find movers, or Look for a distant body) and ask.";
  }

  function drawEvidence(cited = new Set()) {
    if (!evidence) { els.wrap.hidden = true; return; }
    els.wrap.hidden = false;
    els.table.replaceChildren(el("caption", { className: "sr-only", textContent: "The measured values the explainer may use, with where each comes from." }),
      el("thead", {}, el("tr", {}, ...["Id", "What", "Value", "Where it comes from"].map((h) => el("th", { scope: "col", textContent: h })))),
      el("tbody", {}, ...Object.entries(evidence).map(([id, it]) => el("tr", { className: cited.has(id) ? "is-cited" : "", id: `ev-${id.replace(/\./g, "-")}` },
        el("td", {}, el("code", { textContent: id })), el("td", { textContent: it.label }), el("td", { className: "num", textContent: show(it) }), el("td", { className: "muted", textContent: it.source })))));
  }

  function ask(kind) {
    const got = getContext();
    if (!got) { els.status.textContent = "Select a candidate first."; return; }
    evidence = evidenceFromCandidate(got.candidate, got.ctx);
    const sentences = explain(kind, evidence), check = validateSentences(sentences, evidence);
    els.out.replaceChildren();
    if (!check.ok) {
      // never shown: a sentence that is not grounded
      els.status.textContent = `Not shown: ${check.problems.length} sentence${check.problems.length === 1 ? "" : "s"} failed the check (${check.problems.map((p) => p.problem).join("; ")}). This is a defect of the explainer, not a finding.`;
      drawEvidence();
      return;
    }
    for (const st of sentences) {
      const chips = st.cites.map((id) => {
        const b = el("button", { type: "button", className: "cite", textContent: id });
        b.setAttribute("aria-label", `Evidence ${id}: mark it in the table below`);
        b.addEventListener("click", () => { drawEvidence(new Set([id])); document.getElementById(`ev-${id.replace(/\./g, "-")}`)?.scrollIntoView({ block: "nearest" }); els.details.open = true; });
        return b;
      });
      els.out.append(el("li", { className: st.fixed ? "is-fixed" : "" }, el("span", { textContent: st.text }), ...(chips.length ? [el("span", { className: "cites" }, ...chips)] : [])));
    }
    const cited = new Set(sentences.flatMap((st) => st.cites));
    const fixed = sentences.filter((s) => s.fixed).length;
    els.status.textContent = `Checked (${VERSION}): in these ${sentences.length} sentences every number is one of the values the sentence cites, and every citation exists. ${fixed === 1 ? "One is a fixed caution" : `${fixed} are fixed cautions`} with no number. Written by rules from the measured values: no language model, nothing sent anywhere.`;
    drawEvidence(cited);
  }

  for (const b of els.buttons) b.addEventListener("click", () => ask(b.dataset.kind));
  refresh();
  return { refresh };
}
