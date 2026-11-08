import { archiveDataset, importDataset, selectRows, speedHistogram, evidenceReport, assistedReport } from "./candidateEvidence.js";
import { CAN_USE_LOCAL_BACKEND } from "../config.js";

const PAGE_SIZE = 20;
const MAX_FILE_BYTES = 16 * 1024 * 1024;

// The two axes use one pixel scale. Canvas y increases down just as in the fit.
function showCentroids(samples, canvas, tbody) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  const bounds = samples.reduce((b, p) => [
    Math.min(b[0], p.x), Math.max(b[1], p.x), Math.min(b[2], p.y), Math.max(b[3], p.y)
  ], [Infinity, -Infinity, Infinity, -Infinity]);
  const [xmin, xmax, ymin, ymax] = bounds;
  const scale = Math.min((width - 100) / Math.max(1, xmax - xmin), (height - 56) / Math.max(1, ymax - ymin));
  const left = (width - (xmax - xmin) * scale) / 2;
  const top = (height - (ymax - ymin) * scale) / 2;
  const style = getComputedStyle(canvas);
  ctx.fillStyle = style.color;
  ctx.font = "14px sans-serif";
  ctx.fillText(`X ${xmin.toFixed(2)} – ${xmax.toFixed(2)} px`, 8, height - 8);
  ctx.fillText(`Y ${ymin.toFixed(2)} – ${ymax.toFixed(2)} px`, 8, 17);
  ctx.fillStyle = style.getPropertyValue("--accent");
  for (const p of samples) {
    ctx.beginPath();
    ctx.arc(left + (p.x - xmin) * scale, top + (p.y - ymin) * scale, 3.5, 0, 2 * Math.PI);
    ctx.fill();
  }
  const visible = samples.slice(0, 200);
  tbody.closest("table").caption.textContent = `Supporting observations (${visible.length} of ${samples.length})`;
  tbody.replaceChildren(...visible.map(p => {
    const tr = document.createElement("tr");
    for (const value of [p.key, p.x.toFixed(3), p.y.toFixed(3)]) {
      const td = tr.insertCell();
      td.textContent = value;
    }
    return tr;
  }));
}

export function setupExplorer() {
  const el = id => document.getElementById(id);
  let archive, dataset, selected, page = 0, importVersion = 0, activeReport;

  function clearReport() {
    activeReport?.abort();
    activeReport = undefined;
    el("report-output").hidden = true;
    el("report-output").textContent = "";
    el("download-report").hidden = true;
    el("report-status").textContent = "";
    el("ask-model").disabled = false;
  }

  function select(row) {
    selected = row;
    clearReport();
    el("build-report").disabled = !row;
    el("ask-model").disabled = !row;
    el("candidate-detail").hidden = !row;
    for (const btn of el("candidate-rows").querySelectorAll("button")) {
      btn.setAttribute("aria-pressed", String(btn.dataset.id === row?.id));
    }
    if (!row) return;
    el("candidate-title").textContent = row.label;
    el("candidate-ref").textContent = dataset.source + "#" + row.pointer;
    const facts = row.facts.flatMap(f => {
      const term = document.createElement("dt"), value = document.createElement("dd");
      term.textContent = f.label;
      value.textContent = f.value;
      return [term, value];
    });
    el("candidate-facts").replaceChildren(...facts);
    const detail = el("candidate-samples");
    detail.hidden = !row.samples?.length;
    detail.open = false;
    el("centroid-rows").replaceChildren();
    const needsLocalBackend = row.link.includes("data=api");
    const viewer = el("candidate-viewer");
    viewer.hidden = needsLocalBackend && !CAN_USE_LOCAL_BACKEND;
    el("candidate-viewer-help").hidden = !viewer.hidden;
    if (viewer.hidden) viewer.removeAttribute("href");
    else viewer.href = row.link;
    viewer.textContent = needsLocalBackend ? "Open field in workspace (requires real-data backend)" : "Open synthetic field in workspace";
  }

  function render() {
    if (!dataset) return;
    const filtered = selectRows(dataset.rows, el("candidate-search").value, el("candidate-detector").value, el("candidate-sort").value);
    const pages = Math.ceil(filtered.length / PAGE_SIZE);
    page = Math.min(page, Math.max(0, pages - 1));
    const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    el("candidate-count").textContent = `${filtered.length} of ${dataset.rows.length} records` + (pages > 1 ? ` · Page ${page + 1} of ${pages}` : "");
    const bins = speedHistogram(filtered);
    const largest = Math.max(1, ...bins.map(b => b.count));
    el("speed-bins").replaceChildren(...bins.map(bin => {
      const li = document.createElement("li");
      const bar = document.createElement("span");
      bar.className = "histogram-bar";
      bar.style.width = `${100 * bin.count / largest}%`;
      li.textContent = `${bin.label} ″/yr · ${bin.count} records`;
      li.append(bar);
      return li;
    }));
    el("candidate-pages").hidden = pages <= 1;
    el("candidate-prev").disabled = page === 0;
    el("candidate-next").disabled = page + 1 >= pages;
    el("candidate-rows").replaceChildren(...visible.map(row => {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "record-button";
      button.textContent = row.label;
      button.dataset.id = row.id;
      button.addEventListener("click", () => select(row));
      th.append(button);
      tr.append(th);
      for (const text of [row.detector, row.motion == null ? "Unavailable" : row.motion.toFixed(3), row.detections]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
      }
      return tr;
    }));
    select(visible.includes(selected) ? selected : visible[0]);
  }

  function useDataset(next) {
    dataset = next;
    page = 0;
    selected = null;
    el("candidate-search").value = "";
    el("candidate-sort").value = "original";
    const detectors = [...new Set(dataset.rows.map(r => r.detector))].sort();
    el("candidate-detector").replaceChildren(new Option("All detectors", ""), ...detectors.map(d => new Option(d, d)));
    el("run-title").textContent = dataset.label;
    el("run-source").textContent = `${dataset.provenance} · ${dataset.date}`;
    const matched = dataset.rows.filter(r => r.match).length;
    el("association-count").textContent = dataset === archive
      ? "Each record is a validation run. The same object can appear in several runs."
      : `${matched} with a named object association · ${dataset.rows.length - matched} without a named association in the export. Detector labels use supporting frames where available and the viewer detector for older exports.`;
    el("restore-archive").disabled = !archive || next === archive;
    render();
  }

  el("restore-archive").addEventListener("click", () => {
    importVersion++;
    el("import-status").textContent = "";
    useDataset(archive);
  });
  el("candidate-file").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = "";
    const version = ++importVersion;
    try {
      if (file.size > MAX_FILE_BYTES) throw Error("Choose a file under 16 MiB.");
      const next = importDataset(JSON.parse(await file.text()), file.name);
      if (version !== importVersion) return;
      useDataset(next);
      el("import-status").textContent = "Candidate export loaded.";
    } catch (error) {
      if (version === importVersion) el("import-status").textContent = "Import failed. " + error.message;
    }
  });
  for (const id of ["candidate-search", "candidate-detector", "candidate-sort"]) {
    el(id).addEventListener("input", () => { page = 0; render(); });
  }
  el("candidate-prev").addEventListener("click", () => { page--; render(); });
  el("candidate-next").addEventListener("click", () => { page++; render(); });
  function redrawCentroids() {
    if (el("candidate-samples").open && selected?.samples?.length) {
      showCentroids(selected.samples, el("centroid-plot"), el("centroid-rows"));
    }
  }
  el("candidate-samples").addEventListener("toggle", redrawCentroids);
  new MutationObserver(redrawCentroids).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  function showReport(text) {
    el("report-output").textContent = text;
    el("report-output").hidden = false;
    el("download-report").hidden = false;
  }
  el("build-report").addEventListener("click", () => {
    clearReport();
    showReport(evidenceReport(dataset, selected));
    el("report-status").textContent = "Evidence report ready.";
  });
  el("download-report").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([el("report-output").textContent], { type: "text/plain;charset=utf-8" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: "spherex-candidate-report.txt" });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const model = globalThis.LanguageModel;
  // Offer only a model already installed and ready on this device.
  if (model) model.availability().then(status => { el("local-ai").hidden = status !== "available"; }).catch(() => {});
  el("ask-model").addEventListener("click", async () => {
    const question = el("report-question").value.trim();
    if (!question || !selected) return;
    clearReport();
    const controller = new AbortController();
    activeReport = controller;
    el("ask-model").disabled = true;
    el("report-status").textContent = "Selecting evidence on this device…";
    try {
      const report = await assistedReport(model, question, dataset, selected, controller.signal);
      if (controller.signal.aborted) return;
      showReport(report);
      el("report-status").textContent = "Local AI selected the evidence below.";
    } catch (error) {
      if (!controller.signal.aborted) el("report-status").textContent = "Local AI could not select valid evidence. Generate the full evidence report instead.";
    } finally {
      if (activeReport === controller) { activeReport = undefined; el("ask-model").disabled = false; }
    }
  });
  return data => {
    archive = archiveDataset(data);
    if (!dataset) useDataset(archive);
    else el("restore-archive").disabled = false;
  };
}
