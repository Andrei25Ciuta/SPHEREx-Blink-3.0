import { CAN_USE_LOCAL_BACKEND } from "./config.js";

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
  const render = () => {
    const cell = data.cells.find(c => c.distanceAU === Number($("distance").value) && c.fluxMjy === Number($("flux").value));
    $("rows").replaceChildren();
    const row = $("rows").insertRow();
    for (const value of [cell.distanceAU + " AU", cell.fluxMjy + " mJy", `${cell.recovered} / ${cell.trials}`,
      (100 * cell.fraction).toFixed(0) + "%", cell.interval95.map(v => (100 * v).toFixed(0) + "%").join("–"),
      cell.medianInjectedApertureSnr.toFixed(1)]) row.insertCell().textContent = value;
    $("summary").textContent = `${cell.recovered} injected sources recovered. ${cell.unmatched} unmatched candidates in those trials. ${data.controlCounts.join(", ")} candidates in the ${data.nulls} uninjected controls.`;
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
