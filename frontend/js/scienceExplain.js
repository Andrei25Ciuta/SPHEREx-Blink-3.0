// Science Mode panels. The per-panel simple-explanation buttons were removed on request (2026-11-15); Astra and the Learn Mode lessons still explain the terms.
const panels = document.querySelectorAll("main .panel");

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
