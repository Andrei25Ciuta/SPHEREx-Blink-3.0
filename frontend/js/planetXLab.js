import { CAN_USE_LOCAL_BACKEND } from "./config.js";
import { recoveryTrack } from "./features/recoveryTrack.js";

import { mulberry32 } from "./data/mockSource.js";

const $ = id => document.getElementById(id);
function drawTrack(plot, points, size) {
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
  // Keep the illustrative stars stationary when switching trials.
  const random = mulberry32(1365);
  for (let i = 0; i < 156; i++) {
    const [cx, cy] = project({ x: size * (.025 + .95 * random()), y: size * (.025 + .95 * random()) });
    const brightness = random() ** 3;
    if (brightness > .72) {
      shape("circle", { cx, cy, r: 4.2, class: "recovery-star", opacity: .10, "aria-hidden": "true" });
    }
    shape("circle", { cx, cy, r: .45 + 1.65 * brightness,
      class: "recovery-star", opacity: .16 + .58 * brightness, "aria-hidden": "true" });
  }
  shape("polyline", { points: points.map(p => project(p).join(",")).join(" "), class: "recovery-line" });
  points.forEach(point => {
    const [cx, cy] = project(point);
    const dot = shape("circle", { cx, cy, r: 3.5, class: "recovery-point" });
    const title = document.createElementNS(plot.namespaceURI, "title");
    title.textContent = point.dateISO;
    dot.append(title);
  });
}


if (new URLSearchParams(location.search).get("inspect") === "candidate") {
  $("body-inspector").hidden = false;
  let candidate;
  try {
    candidate = JSON.parse(sessionStorage.getItem("spherex-lab-candidate"));
  } catch {
    candidate = null;
  }
  if (Number.isFinite(candidate?.distance) && candidate.n > 0 && Number.isFinite(candidate.n) &&
      Array.isArray(candidate.points) && candidate.points.length &&
      candidate.points.every(p => Number.isFinite(p?.x) && Number.isFinite(p?.y) && Number.isFinite(p?.mjd) && Math.abs(p.mjd - 40587) < 1e8)) {
    $("candidate-summary").textContent = `${candidate.label} · ${candidate.synthetic ? "Synthetic workspace data" : "Workspace FITS data"} · ${candidate.distance.toFixed(1)} AU (${candidate.range}) · ${candidate.points.length} supporting detections.`;
    drawTrack($("candidate-plot"), candidate.points.map(p => ({
      ...p, dateISO: new Date((p.mjd - 40587) * 86400000).toISOString(),
    })), candidate.n);
    $("candidate-evidence").hidden = false;
  } else {
    $("candidate-summary").textContent = "Select a result from Look for a distant body in Workspace, then choose Inspect in Planet X Lab.";
  }
}

const distance = $("distance"), flux = $("flux"), trial = $("trial");
const reveal = $("reveal-track"), track = $("recovery-track");

try {
  const response = await fetch("data/parallax_recovery.json");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const distances = [...new Set(data.cells.map(cell => cell.distanceAU))];
  distance.replaceChildren(...distances.map(value => new Option(`${value} AU`, value)));

  let selectedCell;
  function hideTrack() {
    track.hidden = true;
    reveal.textContent = "Reveal injected path";
    reveal.setAttribute("aria-expanded", "false");
  }

  function updateSetting() {
    const settings = data.cells.filter(cell => cell.distanceAU === Number(distance.value));
    const previousFlux = flux.value;
    flux.replaceChildren(...settings.map(cell => new Option(`${cell.fluxMjy} mJy`, cell.fluxMjy)));
    if (settings.some(cell => String(cell.fluxMjy) === previousFlux)) flux.value = previousFlux;
    selectedCell = settings.find(cell => cell.fluxMjy === Number(flux.value));
    $("summary").textContent = `${selectedCell.recovered} of ${selectedCell.trials} recovered · ${selectedCell.distanceAU} AU · ${selectedCell.fluxMjy} mJy`;
    trial.replaceChildren(...selectedCell.outcomes.map((outcome, index) =>
      new Option(`Trial ${index + 1} · ${outcome.fittedAU.length ? "recovered" : "missed"}`, index)));
    reveal.disabled = !trial.options.length;
    hideTrack();
  }

  distance.addEventListener("change", updateSetting);
  flux.addEventListener("change", updateSetting);
  trial.addEventListener("change", hideTrack);
  reveal.addEventListener("click", () => {
    if (!track.hidden) { hideTrack(); return; }
    const outcome = selectedCell.outcomes[Number(trial.value)];
    if (!outcome) return;
    drawTrack($("track-plot"), recoveryTrack(data, selectedCell, outcome), data.n);
    track.hidden = false;
    reveal.textContent = "Hide injected path";
    reveal.setAttribute("aria-expanded", "true");
  });

  const example = data.cells.find(cell => cell.recovered > 0 && cell.recovered < cell.trials) ?? data.cells[0];
  distance.value = String(example.distanceAU);
  updateSetting();
  flux.value = String(example.fluxMjy);
  updateSetting();

  $("provenance").textContent = `${data.provenance}. ${data.frames.length} images, ${data.trials} trials per setting.`;
  if (CAN_USE_LOCAL_BACKEND) {
    const link = new URL("index.html", location.href);
    link.search = new URLSearchParams({ ra: data.ra, dec: data.dec, fov: data.fov, det: data.det, data: "api" });
    $("workspace").href = link.href;
    $("workspace").hidden = false;
  }
  $("lab-status").hidden = true;
  $("experiment-controls").hidden = false;
} catch (error) {
  $("lab-status").textContent = `Experiment unavailable: ${error.message}`;
}
