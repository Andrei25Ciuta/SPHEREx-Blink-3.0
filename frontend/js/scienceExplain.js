import { explanationFor } from "./features/spaceGuide.js";

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
  button.textContent = "Explain Simply";
  button.setAttribute("aria-expanded", "false");
  const answer = document.createElement("p");
  answer.className = "science-explain-answer";
  answer.hidden = true;
  answer.setAttribute("role", "status");
  answer.textContent = `${explanation.label}: ${explanation.simple} ${explanation.context}`;
  button.addEventListener("click", () => {
    const open = answer.hidden;
    answer.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    button.textContent = open ? "Hide simple explanation" : "Explain Simply";
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
