import { CAN_USE_LOCAL_BACKEND } from "./config.js";

import { recoveryTrack } from "./features/recoveryTrack.js";

const $ = id => document.getElementById(id);
function drawTrack(plot, points, size, active = -1) {
  const minX = Math.min(0, ...points.map(p => p.x));
  const minY = Math.min(0, ...points.map(p => p.y));
  const span = Math.max(size - minX, size - minY,
    ...points.map(p => Math.max(p.x - minX, p.y - minY)));
  const project = p => [24 + 372 * (p.x - minX) / span, 24 + 372 * (p.y - minY) / span];
  const shape = (tag, attributes) => {
    const node = document.createElementNS(plot.namespaceURI, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    plot.append(node);
    return node;
  };
  plot.replaceChildren();
  const [x, y] = project({ x: 0, y: 0 });
  shape("rect", { x, y, width: 372 * size / span, height: 372 * size / span, class: "recovery-boundary" });
  shape("polyline", { points: points.map(p => project(p).join(",")).join(" "), class: "recovery-line" });
  points.forEach((point, i) => {
    const [cx, cy] = project(point);
    const dot = shape("circle", { cx, cy, r: i === active ? 6 : 3.5, class: i === active ? "recovery-point current" : "recovery-point" });
    const title = document.createElementNS(plot.namespaceURI, "title");
    title.textContent = point.dateISO;
    dot.append(title);
  });
}

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
    c.points.every(p => Number.isFinite(p?.x) && Number.isFinite(p?.y) && Math.abs(p.mjd - 40587) < 1e8);
  $("candidate-plot").hidden = !valid;
  $("candidate-note").hidden = !valid;
  $("candidate-summary").textContent = valid
    ? `${c.label} · ${c.synthetic ? "Synthetic workspace data" : "Workspace FITS data"} · fitted distance ${c.distance.toFixed(1)} AU (${c.range}) · ${c.points.length} supporting detections.`
    : "Select a distant-body result in Workspace and choose Inspect in Planet X Lab.";
  if (valid) drawTrack($("candidate-plot"), c.points.map(p => ({
    ...p, dateISO: new Date((p.mjd - 40587) * 86400000).toISOString(),
  })), c.n);
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
      button.style.setProperty("--recovered", `${Math.round(cell.fraction * 32)}%`);
      button.textContent = `${cell.recovered} / ${cell.trials}`;
      button.setAttribute("aria-label", `${distance} AU, ${flux} mJy: ${cell.recovered} of ${cell.trials} recovered`);
      button.addEventListener("click", () => {
        $("distance").value = String(distance);
        $("flux").value = String(flux);
        render();
      });
      td.append(button);
      buttons.set(cell, button);
    }
  }

  const trials = $("trial"), reveal = $("reveal-track"), figure = $("recovery-track");
  let selectedCell;
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
    showBody();
    renderTrial();
    $("rows").replaceChildren();
    if (!cell) { $("summary").textContent = "No trial was recorded for this setting."; return; }
    const row = $("rows").insertRow();
    for (const value of [cell.distanceAU + " AU", cell.fluxMjy + " mJy", `${cell.recovered} / ${cell.trials}`,
      (100 * cell.fraction).toFixed(0) + "%", cell.interval95.map(v => (100 * v).toFixed(0) + "%").join("–"),
      cell.medianInjectedApertureSnr.toFixed(1)]) row.insertCell().textContent = value;
    $("summary").textContent = `${cell.distanceAU} AU · ${cell.fluxMjy} mJy · ${cell.recovered} of ${cell.trials} recovered. ${cell.unmatched} unmatched candidates in those trials. ${data.controlCounts.join(", ")} candidates in the ${data.nulls} uninjected controls.`;
  };
  $("distance").addEventListener("change", render);
  $("flux").addEventListener("change", render);
  render();
  const link = new URL("index.html", location.href);
  link.search = new URLSearchParams({ra:data.ra, dec:data.dec, fov:data.fov, det:data.det, data:"api"});
  $("workspace").href = link.href;
  $("workspace").hidden = !CAN_USE_LOCAL_BACKEND;
} catch (error) {
  $("provenance").textContent = `Experiment unavailable: ${error.message}`;
}
