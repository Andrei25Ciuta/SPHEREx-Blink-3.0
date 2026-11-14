import { CAN_USE_LOCAL_BACKEND } from "./config.js";

import { recoveryTrack } from "./features/recoveryTrack.js";

const $ = id => document.getElementById(id);
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
  function renderTrial() {
    figure.hidden = true;
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
    const plot = $("track-plot"), positions = $("track-positions");
    const project = p => [24 + 372 * p.x / data.n, 24 + 372 * p.y / data.n];
    const shape = (tag, attributes, label = "") => {
      const node = document.createElementNS(plot.namespaceURI, tag);
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
      node.textContent = label;
      plot.append(node);
    };
    plot.replaceChildren();
    positions.replaceChildren();
    shape("rect", { x: 24, y: 24, width: 372, height: 372, class: "recovery-boundary" });
    shape("polyline", { points: points.map(p => project(p).join(",")).join(" "), class: "recovery-line" });
    points.forEach((point, i) => {
      const [cx, cy] = project(point);
      shape("circle", { cx, cy, r: i === 0 || i === points.length - 1 ? 5 : 3, class: "recovery-point" });
      const row = positions.insertRow();
      for (const value of [point.dateISO.replace("T", " ").replace("Z", ""), point.x.toFixed(2), point.y.toFixed(2)])
        row.insertCell().textContent = value;
    });
    figure.hidden = false;
    reveal.textContent = "Hide injected path";
    reveal.setAttribute("aria-expanded", "true");
  });

  const render = () => {
    const cell = data.cells.find(c => c.distanceAU === Number($("distance").value) && c.fluxMjy === Number($("flux").value));
    selectedCell = cell;
    for (const [key, button] of buttons) button.setAttribute("aria-pressed", String(key === cell));
    trials.replaceChildren(...(cell?.outcomes ?? []).map((outcome, i) =>
      new Option(`Trial ${i + 1} · ${outcome.fittedAU.length ? "recovered" : "missed"}`, i)));
    $("trial-inspector").hidden = !trials.options.length;
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
