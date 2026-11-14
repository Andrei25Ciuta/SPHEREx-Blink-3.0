// missionRunner.js – runs a Cosmic Mission inside Science Mode (index.html?mission=<id>): a mission console that shows the steps,
// highlights the control to use, ticks each step when the learner really does it, explains what just happened, asks for measurements
// read off the page, and awards XP. DOM only; the missions and the checks are pure, in missions.js.

import { findMission, stepMatches, checkMeasurement, STEP_NOTES, missionWhy, stepWhy, termsFor, categoryInfo, xpFor, totalXp, rankFor,
  loadProgress, saveProgress, markComplete, pickRandomMission, missionHref } from "./missions.js";

const store = (() => { try { return window.localStorage; } catch { return null; } })();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const visible = (el) => Boolean(el && el.getClientRects().length && !el.closest("[hidden]"));
const ICONS = { "Cockpit": "", "Blink": "✨", "Proper": "☄️", "Parallax": "📐", "Deep": "", "Sky": "", "Data": "", "Pro": "" };
const iconFor = (cat) => ICONS[Object.keys(ICONS).find((k) => cat.startsWith(k))] ?? "";

/** getCandidate(): the selected candidate or null; getCount(): how many candidates are listed. */
export function startMissionRunner({ getCandidate = () => null, getCount = () => 0 } = {}) {
  const id = new URLSearchParams(location.search).get("mission");
  const mission = id && findMission(id);
  if (!mission) return null;

  let step = 0, marked = null, note = "", wrong = "", collapsed = false, started = false, hint = "";
  const REAL = new URLSearchParams(location.search).get("data") === "api";
  const box = document.createElement("aside");
  box.className = "mission-runner";
  box.setAttribute("aria-label", "Mission console");
  document.body.appendChild(box);

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

  function render() {
    const n = mission.steps.length, done = step >= n;
    const items = mission.steps.map((s, i) =>
      `<li class="${i < step ? "is-done" : i === step ? "is-current" : ""}"><span class="mr-dot" aria-hidden="true">${i < step ? "✓" : i + 1}</span><span>${esc(s.does)}</span></li>`).join("");
    const s = current();
    const m = s?.check.measure;
    const progress = loadProgress(store);
    const xp = totalXp(progress);
    const next = pickRandomMission(Math.random, [...progress.completed, mission.id], undefined, { real: REAL });
    box.classList.toggle("is-collapsed", collapsed);
    box.classList.toggle("is-won", done);
    box.innerHTML = `
      <header class="mr-head">
        <span class="mr-icon" aria-hidden="true">${categoryInfo(mission).icon}</span>
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
      ${m ? `<form class="mr-measure" data-act="measure"><label for="mr-input">${esc(s.does)}</label>
          <div class="mr-measure-row"><input id="mr-input" autocomplete="off" inputmode="${m.field === "compass" ? "text" : "decimal"}" placeholder="${m.unit ? "value in " + esc(m.unit) : "your answer"}">
          <button type="submit" class="btn btn-small btn-primary">Check</button></div>
          ${wrong ? `<p class="mr-wrong" role="alert">${esc(wrong)}</p>` : ""}</form>` : ""}
      ${done ? `<div class="mr-win" role="status"><p class="mr-trophy" aria-hidden="true"></p><p><strong>Mission complete! +${xpFor(mission)} XP</strong> · ${xp} XP · rank: ${esc(rankFor(xp))}</p>
          <p>${esc(mission.successFeedback)}</p></div>
        <p class="mr-actions"><a class="btn btn-small btn-primary" href="${esc(missionHref(next, location.search))}">Next mission: ${esc(next.title)} →</a>
        <a class="btn btn-small" href="learn.html#missions">Back to Learn Mode</a></p>`
      : `<p class="mr-actions">${s?.check.on ? `<button type="button" class="btn btn-small" data-act="show">Show me where</button>` : ""}
          <button type="button" class="btn btn-small" data-act="quit">Quit</button></p>`}
      </div>`}`;
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
    if (current()?.check.measure) box.querySelector("#mr-input")?.focus({ preventScroll: true });
  }

  function noteFor(s) { return s.learn ?? STEP_NOTES[s.check.on] ?? ""; }
  function onEvent(e) {
    if (!started || box.contains(e.target)) return;
    const s = current();
    if (s && stepMatches(s.check, e.target)) setTimeout(() => advance(noteFor(s)), 0);   // let the page react first
  }
  function poll() {
    if (!started) return;
    const s = current();
    if (s?.check.see && [...document.querySelectorAll(s.check.see)].some(visible)) advance("");
    else if (s?.check.on && !marked) highlight();                       // the control may appear later
  }
  for (const t of ["click", "change", "input"]) document.addEventListener(t, onEvent, true);
  const timer = setInterval(poll, 600);

  box.addEventListener("submit", (e) => {
    e.preventDefault();
    const m = current()?.check.measure;
    if (!m) return;
    const truth = m.field === "count" ? { count: getCount() } : getCandidate();
    if (!truth || (m.field !== "count" && !getCandidate())) { wrong = "First select a candidate in the list."; render(); return; }
    const { ok, expected } = checkMeasurement(m, box.querySelector("#mr-input").value, truth);
    if (ok) {
      const shown = typeof expected === "number" ? (Number.isInteger(expected) ? expected : expected.toFixed(m.field === "positionAngleDeg" ? 0 : 1)) : expected;
      advance(`Correct: the page measured ${shown}${m.unit}. ${m.field === "speedArcsecPerYear" ? "At that rate it would cross the full Moon (about 1800″) in " + Math.round(1800 / expected) + " years." : ""}`);
    } else { wrong = `Not quite. ${m.hint}`; render(); box.querySelector("#mr-input")?.focus(); }
  });
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
    else if (act === "start") { started = true; render(); marked?.scrollIntoView({ behavior: "smooth", block: "center" }); }
    else if (act === "collapse") { collapsed = !collapsed; render(); }
  });
  render();
  return { mission };
}
