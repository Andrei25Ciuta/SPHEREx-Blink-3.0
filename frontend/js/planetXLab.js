import { CAN_USE_LOCAL_BACKEND } from "./config.js";

import { drawTrack, datedTrackPoints } from "./features/labTrackView.js";
import { recoveryTrack } from "./features/recoveryTrack.js";

const $ = id => document.getElementById(id);

const source = $("body-source");
let workspaceCandidate;
try {
  workspaceCandidate = JSON.parse(sessionStorage.getItem("spherex-lab-candidate"));
} catch {
  workspaceCandidate = null;
}
if (new URLSearchParams(location.search).get("inspect") === "candidate") source.value = "candidate";
function showBody() {
  const inspecting = source.value === "candidate";
  $("candidate-inspector").hidden = !inspecting;
  $("trial-inspector").hidden = inspecting || !$("trial").options.length;
  if (!inspecting) return;
  const c = workspaceCandidate;
  const valid = Number.isFinite(c?.distance) && Number.isFinite(c?.n) && c.n > 0 &&
    Array.isArray(c.points) && c.points.length > 0 &&
    c.points.every(p => Number.isFinite(p?.x) && Number.isFinite(p?.y) && Number.isFinite(p?.mjd) && Math.abs(p.mjd - 40587) < 1e8);
  $("candidate-evidence").hidden = !valid;
  $("candidate-next-steps").hidden = valid;
  $("candidate-summary").textContent = valid
    ? `${c.label} · ${c.synthetic ? "Synthetic workspace data" : "Workspace FITS data"} · fitted distance ${c.distance.toFixed(1)} AU (${c.range}) · ${c.points.length} supporting detections.`
    : "Select a distant-body result in Workspace and choose Inspect in Planet X Lab.";
  if (valid) drawTrack($("candidate-plot"), datedTrackPoints(c.points), c.n);
}
source.addEventListener("change", showBody);
showBody();

$("workspace-help").hidden = CAN_USE_LOCAL_BACKEND;
try {
  const response = await fetch("data/parallax_recovery.json");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  $("provenance").textContent = `${data.provenance}. ${data.frames.length} images, ${data.trials} trials per setting, seed ${data.seed}. Generated ${data.generated}.`;
  const distances = [...new Set(data.cells.map(c => c.distanceAU))];
  const fluxes = [...new Set(data.cells.map(c => c.fluxMjy))];
  $("distance").replaceChildren(...distances.map(v => new Option(`${v} AU`, v)));
  $("flux").replaceChildren(...fluxes.map(v => new Option(`${v} mJy`, v)));
  const map = $("recovery-map");
  const header = map.createTHead().insertRow();
  const addHeading = (row, label, scope) => {
    const th = document.createElement("th");
    th.scope = scope;
    th.textContent = label;
    row.append(th);
  };
  addHeading(header, "Distance / flux", "col");
  for (const flux of fluxes) addHeading(header, `${flux} mJy`, "col");
  const rows = map.createTBody(), buttons = new Map();
  const metric = $("recovery-metric");
  const percent = value => `${Math.round(value * 100)}%`;
  const interval = cell => cell.interval95.map(percent).join("–");
  const signal = cell => Number.isFinite(cell.medianInjectedApertureSnr) ? cell.medianInjectedApertureSnr.toFixed(1) : "—";
  const metrics = {
    recovery: { legend: "Colour intensity shows the recovered fraction. The 95% Wilson interval reflects the small trial count.",
      label: cell => `${cell.recovered} / ${cell.trials} · ${percent(cell.fraction)}`,
      detail: cell => `95% interval · ${interval(cell)}`, value: cell => cell.fraction },
    signal: { legend: "Colour intensity shows the median aperture signal-to-noise of the injected signal for each setting.",
      label: cell => signal(cell), detail: () => "Median aperture SNR", value: cell => cell.medianInjectedApertureSnr },
    unmatched: { legend: "Colour intensity shows the count of candidates that did not match the injected source across the trials.",
      label: cell => String(cell.unmatched), detail: () => "Unmatched candidates", value: cell => cell.unmatched },
  };
  function renderMetric() {
    const view = metrics[metric.value];
    const maximum = Math.max(1, ...data.cells.map(cell => view.value(cell) ?? 0));
    $("recovery-legend").textContent = view.legend;
    for (const [cell, button] of buttons) {
      const detail = document.createElement("small");
      detail.textContent = view.detail(cell);
      button.replaceChildren(document.createTextNode(view.label(cell)), detail);
      button.style.setProperty("--recovered", `${Math.round(32 * (view.value(cell) ?? 0) / maximum)}%`);
      button.setAttribute("aria-label", `${cell.distanceAU} AU, ${cell.fluxMjy} mJy: ${view.label(cell)}. ${detail.textContent}`);
    }
  }
  metric.addEventListener("change", renderMetric);
  for (const distance of distances) {
    const row = rows.insertRow();
    addHeading(row, `${distance} AU`, "row");
    for (const flux of fluxes) {
      const cell = data.cells.find(c => c.distanceAU === distance && c.fluxMjy === flux);
      const td = row.insertCell();
      if (!cell) { td.textContent = "—"; continue; }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.addEventListener("click", () => {
        $("distance").value = String(distance);
        $("flux").value = String(flux);
        render();
      });
      td.append(button);
      buttons.set(cell, button);
    }
  }

  renderMetric();

  const trials = $("trial"), reveal = $("reveal-track"), figure = $("recovery-track");
  let selectedCell;
  const trialFilter = $("trial-filter"), trialSort = $("trial-sort"), trialRows = $("trial-rows");
  let details = [];
  function renderTrialTable() {
    const visible = details.filter(row => trialFilter.value === "all" || row.result === trialFilter.value);
    if (trialSort.value === "candidates") visible.sort((a, b) => b.outcome.candidates - a.outcome.candidates);
    if (trialSort.value === "span") visible.sort((a, b) => b.span - a.span);
    const fragment = document.createDocumentFragment();
    if (!visible.length) {
      const row = document.createElement("tr");
      const cell = row.insertCell();
      cell.colSpan = 6;
      cell.textContent = "No trials match this filter.";
      fragment.append(row);
    }
    for (const { index, outcome, result, span, inCutout, total } of visible) {
      const row = document.createElement("tr");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-small";
      button.dataset.trial = String(index);
      button.textContent = `Trial ${index + 1}`;
      button.addEventListener("click", () => {
        trials.value = String(index);
        renderTrial();
      });
      row.insertCell().append(button);
      for (const value of [result === "recovered" ? "Recovered" : "Missed",
        outcome.fittedAU.length ? outcome.fittedAU.map(d => `${d.toFixed(1)} AU`).join(", ") : "—",
        outcome.candidates, `${span.toFixed(1)} px`, `${inCutout} / ${total}`]) {
        row.insertCell().textContent = value;
      }
      fragment.append(row);
    }
    trialRows.replaceChildren(fragment);
    markSelectedTrial();
  }
  function markSelectedTrial() {
    for (const button of trialRows.querySelectorAll("[data-trial]")) {
      button.setAttribute("aria-pressed", String(button.dataset.trial === trials.value));
    }
  }
  trialFilter.addEventListener("change", renderTrialTable);
  trialSort.addEventListener("change", renderTrialTable);

  const comparison = $("trial-comparison"), dateSlider = $("comparison-date");
  dateSlider.max = String(data.frames.length - 1);
  function renderComparison() {
    const outcomes = selectedCell?.outcomes ?? [];
    const recovered = outcomes.findIndex(outcome => outcome.fittedAU.length > 0);
    const missed = outcomes.findIndex(outcome => outcome.fittedAU.length === 0);
    comparison.hidden = figure.hidden || recovered < 0 || missed < 0;
    if (comparison.hidden) return;
    const index = Number(dateSlider.value);
    $("comparison-date-label").value = data.frames[index].dateISO.slice(0, 10);
    $("recovered-trial").textContent = `Trial ${recovered + 1} · recovered at ${outcomes[recovered].fittedAU.map(d => d.toFixed(1)).join(", ")} AU`;
    $("missed-trial").textContent = `Trial ${missed + 1} · missed · ${outcomes[missed].candidates} candidates`;
    drawTrack($("recovered-plot"), recoveryTrack(data, selectedCell, outcomes[recovered]), data.n, index);
    drawTrack($("missed-plot"), recoveryTrack(data, selectedCell, outcomes[missed]), data.n, index);
  }
  dateSlider.addEventListener("input", renderComparison);
  function renderTrial() {
    markSelectedTrial();
    figure.hidden = true;
    comparison.hidden = true;
    reveal.textContent = "Reveal injected path";
    reveal.setAttribute("aria-expanded", "false");
    const outcome = selectedCell?.outcomes?.[Number(trials.value)];
    if (!outcome) return;
    const fitted = outcome.fittedAU.map(value => `${value.toFixed(1)} AU`).join(", ");
    $("trial-result").textContent = `${fitted ? `Recovered. Fitted distance: ${fitted}.` : "Injection missed."} Candidates in trial: ${outcome.candidates}.`;
  }
  trials.addEventListener("change", renderTrial);
  reveal.addEventListener("click", () => {
    if (!figure.hidden) { renderTrial(); return; }
    const points = recoveryTrack(data, selectedCell, selectedCell.outcomes[Number(trials.value)]);
    const positions = $("track-positions");
    drawTrack($("track-plot"), points, data.n);
    positions.replaceChildren();
    points.forEach(point => {
      const row = positions.insertRow();
      for (const value of [point.dateISO.replace("T", " ").replace("Z", ""), point.x.toFixed(2), point.y.toFixed(2)])
        row.insertCell().textContent = value;
    });
    figure.hidden = false;
    reveal.textContent = "Hide injected path";
    reveal.setAttribute("aria-expanded", "true");
    dateSlider.value = "0";
    renderComparison();
  });

  const render = () => {
    const cell = data.cells.find(c => c.distanceAU === Number($("distance").value) && c.fluxMjy === Number($("flux").value));
    selectedCell = cell;
    for (const [key, button] of buttons) button.setAttribute("aria-pressed", String(key === cell));
    trials.replaceChildren(...(cell?.outcomes ?? []).map((outcome, i) =>
      new Option(`Trial ${i + 1} · ${outcome.fittedAU.length ? "recovered" : "missed"}`, i)));
    details = (cell?.outcomes ?? []).map((outcome, index) => {
      const points = recoveryTrack(data, cell, outcome);
      let span = 0;
      for (const a of points) {
        for (const b of points) span = Math.max(span, Math.hypot(a.x - b.x, a.y - b.y));
      }
      const inCutout = points.filter(p => p.x >= 0 && p.x < data.n && p.y >= 0 && p.y < data.n).length;
      return { index, outcome, result: outcome.fittedAU.length ? "recovered" : "missed", span, inCutout, total: points.length };
    });
    renderTrialTable();
    showBody();
    renderTrial();
    $("rows").replaceChildren();
    if (!cell) { $("summary").textContent = "No trial was recorded for this setting."; return; }
    const row = $("rows").insertRow();
    for (const value of [cell.distanceAU + " AU", cell.fluxMjy + " mJy", `${cell.recovered} / ${cell.trials}`,
      (100 * cell.fraction).toFixed(0) + "%", interval(cell),
      signal(cell)]) row.insertCell().textContent = value;
    $("summary").textContent = `${cell.distanceAU} AU · ${cell.fluxMjy} mJy · ${cell.recovered} of ${cell.trials} recovered. ${cell.unmatched} unmatched candidates in those trials. ${data.controlCounts.join(", ")} candidates in the ${data.nulls} uninjected controls.`;
  };
  $("distance").addEventListener("change", render);
  $("flux").addEventListener("change", render);
  const example = data.cells.find(cell => cell.recovered > 0 && cell.recovered < cell.trials) ?? data.cells[0];
  $("distance").value = String(example.distanceAU);
  $("flux").value = String(example.fluxMjy);
  render();
  const link = new URL("index.html", location.href);
  link.search = new URLSearchParams({ra:data.ra, dec:data.dec, fov:data.fov, det:data.det, data:"api"});
  $("workspace").href = link.href;
  $("workspace").hidden = !CAN_USE_LOCAL_BACKEND;
} catch (error) {
  $("provenance").textContent = `Experiment unavailable: ${error.message}`;
}
