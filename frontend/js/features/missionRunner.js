// missionRunner.js – runs a Cosmic Mission inside Science Mode (index.html?mission=<id>): a mission console that shows the steps,
// highlights the control to use, ticks each step when the learner really does it, explains what just happened, asks for measurements
// read off the page, and awards XP. DOM only; the missions and the checks are pure, in missions.js.

import { findMission, stepMatches, STEP_NOTES, missionWhy, stepWhy, termsFor, categoryInfo, xpFor, totalXp, rankFor,
  loadProgress, saveProgress, markComplete, pickRandomMission, missionHref } from "./missions.js?v=2";

const store = (() => { try { return window.localStorage; } catch { return null; } })();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const visible = (el) => Boolean(el && el.getClientRects().length && !el.closest("[hidden]"));

/** getCandidate(): the selected candidate or null; getCount(): how many candidates are listed. */
export function startMissionRunner({ getCandidate = () => null, getCount = () => 0 } = {}) {
  const id = new URLSearchParams(location.search).get("mission");
  const mission = id && findMission(id);
  if (!mission) return null;

  const skipped = new Set();                         // steps passed over with Skip: shown as skipped, not as done
  let step = 0, marked = null, note = "", wrong = "", collapsed = false, started = false, hint = "";
  const REAL = new URLSearchParams(location.search).get("data") === "api";
  const box = document.createElement("aside");
  box.className = "mission-runner";
  box.setAttribute("aria-label", "Mission console");
  document.body.appendChild(box);

  // Drag the top-left corner to make the console smaller or larger (it is pinned to the bottom-right corner). The size is kept in this browser only.
  const SIZE_KEY = "spherex-blink-mission-size";
  const grip = document.createElement("button");
  grip.type = "button";
  grip.className = "mr-grip";
  grip.setAttribute("aria-label", "Resize the mission console: drag, or use the arrow keys");
  grip.title = "Drag to resize";
  const clampSize = (w, h) => [Math.max(Math.min(260, innerWidth - 32), Math.min(w, innerWidth - 32)), Math.max(140, Math.min(h, innerHeight - 32))];
  function applySize(w, h, save) {
    [w, h] = clampSize(w, h);
    box.style.width = `${w}px`; box.style.height = `${h}px`; box.style.maxHeight = "none";
    if (save) try { localStorage.setItem(SIZE_KEY, JSON.stringify([w, h])); } catch {}
  }
  try { const saved = JSON.parse(localStorage.getItem(SIZE_KEY) ?? "null"); if (Array.isArray(saved)) applySize(saved[0], saved[1], false); } catch {}
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const r = box.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
    const move = (ev) => applySize(r.width - (ev.clientX - x0), r.height - (ev.clientY - y0), false);
    const up = (ev) => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); const b2 = box.getBoundingClientRect(); applySize(b2.width, b2.height, true); };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
  });
  grip.addEventListener("keydown", (e) => {
    const d = { ArrowLeft: [20, 0], ArrowRight: [-20, 0], ArrowUp: [0, 20], ArrowDown: [0, -20] }[e.key];
    if (!d) return;
    e.preventDefault();
    const r = box.getBoundingClientRect();
    applySize(r.width + d[0], r.height + d[1], true);
  });

  const current = () => mission.steps[step];
  function highlight() {
    marked?.classList.remove("mission-target");
    marked = null;
    const s = current();
    if (!started || !s?.check.on) return;
    const el = [...document.querySelectorAll(s.check.on)].find(visible);
    const target = el?.matches("input[type=radio], input[type=checkbox]") ? el.closest("label") ?? el : el;
    if (target) { target.classList.add("mission-target"); marked = target; }
  }

  /** The value a "read it" step points at, as the page reports it, or null when nothing is selected yet. */
  function readValue(m) {
    if (m.field === "count") { const n = getCount(); return n ? String(n) : null; }
    const c = getCandidate();
    const v = c?.[m.field];
    if (v === undefined || v === null) return null;
    return typeof v === "number" ? `${Number.isInteger(v) ? v : v.toFixed(m.field === "positionAngleDeg" ? 0 : 1)}${m.unit}` : String(v);
  }

  function render() {
    const n = mission.steps.length, done = step >= n;
    const items = mission.steps.map((s, i) =>
      `<li class="${i < step ? (skipped.has(i) ? "is-done is-skipped" : "is-done") : i === step ? "is-current" : ""}"><span class="mr-dot" aria-hidden="true">${i < step ? (skipped.has(i) ? "↷" : "✓") : i + 1}</span><span>${esc(s.does)}${skipped.has(i) ? " <em>(skipped)</em>" : ""}</span></li>`).join("");
    const s = current();
    const m = s?.check.measure;
    const progress = loadProgress(store);
    const xp = totalXp(progress);
    const next = pickRandomMission(Math.random, [...progress.completed, mission.id], undefined, { real: REAL });
    box.classList.toggle("is-collapsed", collapsed);
    box.classList.toggle("is-won", done);
    box.innerHTML = `
      <header class="mr-head">
        <div><p class="mr-kicker">${esc(mission.category)} · level ${mission.tier} · +${xpFor(mission)} XP</p><h2>${esc(mission.title)}</h2></div>
        <button type="button" class="mr-collapse" data-act="collapse" aria-expanded="${!collapsed}" aria-label="${collapsed ? "Expand" : "Collapse"} the mission console">${collapsed ? "▴" : "▾"}</button>
      </header>
      <div class="mr-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${Math.min(step, n)}" aria-label="Steps done"><span style="width:${(100 * Math.min(step, n) / n).toFixed(0)}%"></span></div>
      <div class="mr-body">
      ${!started ? `<p class="mr-section">Mission briefing</p><p class="mr-story">${esc(mission.story)}</p>
        <p class="mr-section">What is this about?</p><p class="mr-why-text">${esc(categoryInfo(mission).intro)}</p>
        <p class="mr-section">Why it matters</p><p class="mr-why-text">${esc(missionWhy(mission))}</p>
        ${termsFor(mission).length ? `<details class="mr-words"><summary>New words (${termsFor(mission).length}) · tap to read</summary><dl>${termsFor(mission).map((g) => `<dt>${esc(g.term)}</dt><dd>${esc(g.simple)}</dd>`).join("")}</dl></details>` : ""}
        ${mission.needsReal && !REAL ? `<p class="mr-warn"><strong>Needs real SPHEREx data.</strong> This tool works only when the page runs with the backend on real images (Learn Mode → “Search the real sky”). On this synthetic demo it explains why it cannot run, so the mission cannot be finished here.</p>` : ""}
        <p class="mr-section">What you will do · ${n} steps</p>
        <ol class="mr-steps mr-steps-preview">${mission.steps.map((x, i) => `<li><span class="mr-dot" aria-hidden="true">${i + 1}</span><span>${esc(x.does)}</span></li>`).join("")}</ol>
        <p class="mr-actions">${mission.needsReal && !REAL ? `<a class="btn btn-small btn-primary" href="${esc(missionHref(next, location.search))}">Try another mission: ${esc(next.title)} →</a> <button type="button" class="btn btn-small" data-act="start">Look anyway</button>` : `<button type="button" class="btn btn-small btn-primary" data-act="start">Start the mission</button> <button type="button" class="btn btn-small" data-act="quit">Not now</button>`}</p>
      </div>` : `
      ${note ? `<p class="mr-note" role="status"><strong>What just happened:</strong> ${esc(note)}</p>` : ""}
      <ol class="mr-steps">${items}</ol>
      ${hint && !done ? `<p class="mr-hint" role="status">${esc(hint)}</p>` : ""}
      ${!done && stepWhy(s) ? `<p class="mr-why"><strong>Why this step?</strong> ${esc(stepWhy(s))}</p>` : ""}
      ${m ? (() => {                                     // no typing: the guide shows the value the page measured and where to read it
          const v = readValue(m);
          return `<div class="mr-measure"><p class="mr-measure-q">${esc(s.does)}</p>
          ${v === null ? `<p class="mr-measure-a">Select a candidate in the list first; its value then appears here.</p>`
            : `<p class="mr-measure-a">The page says: <strong>${esc(v)}</strong></p><p class="mr-measure-where">${esc(m.hint)}</p>`}
          <button type="button" class="btn btn-small btn-primary" data-act="read"${v === null ? " disabled" : ""}>Got it, next →</button></div>`;
        })() : ""}
      ${done ? `<div class="mr-win" role="status"><p class="mr-trophy" aria-hidden="true"></p><p><strong>Mission complete! +${xpFor(mission)} XP</strong> · ${xp} XP · rank: ${esc(rankFor(xp))}</p>
          <p>${esc(mission.successFeedback)}</p></div>
        <p class="mr-actions"><a class="btn btn-small btn-primary" href="${esc(missionHref(next, location.search))}">Next mission: ${esc(next.title)} →</a>
        <a class="btn btn-small" href="learn.html#missions">Back to Learn Mode</a></p>`
      : `<p class="mr-actions">${s?.check.on ? `<button type="button" class="btn btn-small" data-act="show">Show me where</button>` : ""}
          <button type="button" class="btn btn-small" data-act="skip" title="Go to the next step without doing this one">Skip this step</button>
          <button type="button" class="btn btn-small" data-act="quit">Quit</button></p>`}
      </div>`}`;
    box.prepend(grip);                                // first child, so it can stick to the top corner while the box scrolls
    highlight();
  }

  function advance(learnt) {
    note = learnt ?? "";
    hint = "";
    wrong = "";
    step++;
    if (step >= mission.steps.length) {
      saveProgress(store, markComplete(loadProgress(store), mission.id));
      marked?.classList.remove("mission-target");
      clearInterval(timer);
    }
    collapsed = false;
    render();
  }

  function noteFor(s) { return s.learn ?? STEP_NOTES[s.check.on] ?? ""; }
  function onEvent(e) {
    if (!started || box.contains(e.target)) return;
    const s = current();
    // let the page react first; one action can fire click AND change (a radio button): tick the step once, not twice
    if (s && stepMatches(s.check, e.target)) { const at = step; setTimeout(() => { if (step === at) advance(noteFor(s)); }, 0); }
  }
  function poll() {
    if (!started) return;
    const s = current();
    if (s?.check.see && [...document.querySelectorAll(s.check.see)].some(visible)) advance("");
    else if (s?.check.on && !marked) highlight();                       // the control may appear later
  }
  for (const t of ["click", "change", "input"]) document.addEventListener(t, onEvent, true);
  const timer = setInterval(poll, 600);

  /** Scroll to the control of the step; if it is hidden or greyed out, go to where it will appear and say why. */
  function showWhere() {
    highlight();
    const sel = current()?.check.on;
    if (marked && !marked.matches(":disabled") && !marked.querySelector?.(":disabled")) { hint = ""; render(); marked.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    const el = sel && document.querySelector(sel);
    if (!el) { hint = "This control is not on the page yet: finish the previous steps first."; render(); return; }
    for (let d = el.closest("details:not([open])"); d; d = d.parentElement?.closest("details:not([open])")) d.open = true;
    let spot = el;
    while (spot && !visible(spot)) spot = spot.parentElement;
    const section = (spot ?? el).closest("section, .panel") ?? spot;
    const status = [...(section?.querySelectorAll("[role=status]") ?? [])]          // the status line just before the control: why it is not there
      .filter((n) => visible(n) && n.textContent.trim() && (n.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)).pop()?.textContent.trim();
    hint = (el.disabled || el.matches(":disabled") ? "This control is greyed out for now. It becomes available after the earlier steps (for example after loading images, running a search or selecting a candidate)." : "This control is hidden until the result of the previous step is ready, so you see the place where it will appear.")
      + (mission.needsReal && !REAL ? " This mission needs real SPHEREx data: on the synthetic demo the tool cannot run." : "")
      + (status ? ` The page says: “${status.slice(0, 220)}”` : "");
    render();
    (spot ?? section)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  box.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "quit") {
      clearInterval(timer); marked?.classList.remove("mission-target"); box.remove();
      const u = new URL(location.href); u.searchParams.delete("mission"); history.replaceState(null, "", u);
    } else if (act === "show") showWhere();
    else if (act === "skip") { skipped.add(step); advance("Skipped. Every step is optional; you can come back to it any time."); }
    else if (act === "read") { const m = current()?.check.measure; const v = m && readValue(m); if (v !== null && v !== undefined) advance(`The page measured ${v}. Reading the numbers yourself is how you learn where the evidence is.`); }
    else if (act === "start") { started = true; render(); marked?.scrollIntoView({ behavior: "smooth", block: "center" }); }
    else if (act === "collapse") { collapsed = !collapsed; render(); }
  });
  render();
  return { mission };
}
