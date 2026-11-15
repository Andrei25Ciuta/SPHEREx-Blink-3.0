import { aiAvailability, askAstra, explanationFor } from "./features/spaceGuide.js";
import { createWebLlmModel } from "./features/webLlmModel.js";

let modelPromise;

// Use the browser's built-in model when available, otherwise load the existing
// on-device WebLLM only after the visitor asks for an explanation.
function scienceAiModel() {
  modelPromise ??= (async () => {
    const builtinState = await aiAvailability();
    if (builtinState !== "unavailable") return { model: globalThis.LanguageModel, kind: "browser" };

    const webllm = createWebLlmModel();
    if (await webllm.availability() !== "unavailable") return { model: webllm, kind: "webllm" };
    return null;
  })().catch(() => null);
  return modelPromise;
}

function preparedExplanation(explanation) {
  if (explanation.label === "Astra's space guide") return "A prepared explanation is not available for this panel yet.";
  return `${explanation.label}: ${explanation.simple} ${explanation.context}`;
}

const panels = document.querySelectorAll("main .panel");
for (const panel of panels) {
  const headingId = panel.getAttribute("aria-labelledby");
  const heading = headingId ? document.getElementById(headingId) : panel.querySelector("h2,h3");
  const title = heading?.textContent?.trim();
  if (!title) continue;
  const explanation = explanationFor(title);
  const control = document.createElement("div");
  control.className = "science-explain";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "science-explain-button";
  button.textContent = "Explain Simply with AI";
  button.setAttribute("aria-expanded", "false");
  const answer = document.createElement("p");
  answer.className = "science-explain-answer";
  answer.hidden = true;
  answer.setAttribute("role", "status");

  let activeJob = null;
  button.addEventListener("click", async () => {
    if (!answer.hidden) {
      activeJob?.abort();
      activeJob = null;
      answer.hidden = true;
      button.setAttribute("aria-expanded", "false");
      button.textContent = "Explain Simply with AI";
      return;
    }

    answer.hidden = false;
    button.setAttribute("aria-expanded", "true");
    button.textContent = "Hide simple explanation";
    const job = new AbortController();
    activeJob?.abort();
    activeJob = job;
    answer.textContent = "Preparing an on-device AI explanation…";

    try {
      const available = await scienceAiModel();
      if (activeJob !== job) return;
      if (!available) {
        answer.textContent = `${preparedExplanation(explanation)} (On-device AI is not available in this browser.)`;
        return;
      }

      answer.textContent = available.kind === "webllm"
        ? "Starting the on-device AI. The first use may download its model (about 2 GB)…"
        : "The on-device AI is writing a simple explanation…";
      const question = `Explain the Science Mode panel “${title}” in simple terms for a beginner. Keep the explanation short and accurate.`;
      const result = await askAstra(question, {
        model: available.model,
        signal: job.signal,
        onChunk: (text) => { if (activeJob === job) answer.textContent = text; },
        onDownload: (fraction) => {
          if (activeJob === job) answer.textContent = `Loading the on-device AI model: ${Math.round(fraction * 100)}%`;
        },
      });
      if (activeJob !== job) return;
      answer.textContent = result.source === "ai"
        ? `${result.text} Written by an on-device AI; it can be wrong.`
        : `${preparedExplanation(explanation)} (Showing the prepared explanation because the AI could not answer.)`;
    } catch {
      if (activeJob === job) answer.textContent = `${preparedExplanation(explanation)} (Showing the prepared explanation because the AI could not answer.)`;
    }
  });
  control.append(button, answer);
  const header = panel.querySelector(":scope > .panel-head");
  if (header) header.insertAdjacentElement("afterend", control);
  else if (heading && panel.contains(heading)) heading.insertAdjacentElement("afterend", control);
  else panel.prepend(control);
}

// Calmer panels: a long first description is shortened to two lines with a "More" toggle (the full text stays in the page for screen readers).
for (const panel of panels) {
  const intro = [...panel.children].find((el) => el.tagName === "P" && el.textContent.trim().length > 200);
  if (!intro || intro.id) continue;
  intro.classList.add("panel-intro", "is-clamped");
  const more = document.createElement("button");
  more.type = "button";
  more.className = "panel-intro-more";
  more.textContent = "More";
  more.setAttribute("aria-expanded", "false");
  more.addEventListener("click", () => {
    const open = intro.classList.toggle("is-clamped") === false;
    more.textContent = open ? "Less" : "More";
    more.setAttribute("aria-expanded", String(open));
  });
  intro.insertAdjacentElement("afterend", more);
}
