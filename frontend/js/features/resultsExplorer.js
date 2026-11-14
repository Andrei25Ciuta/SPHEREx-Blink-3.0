// resultsExplorer.js – the table of records of the Results page, the detail of the selected record, and its evidence report.
//
// It shows ONE dataset at a time (features/resultsData.js): whatever file was loaded, the rows, the columns, the filters and the sort orders here come from that file.
// A column that no row has a number for is not drawn; a filter that would have one choice is not offered. Loading a file is not done here (js/results.js does it):
//   const explorer = setupExplorer();   explorer.show(dataset);   explorer.focusRow(id);   explorer.onSelect = (id) => { ... };

import { selectRows, SORTS, evidenceReport, assistedReport } from "./candidateEvidence.js";
import { CAN_USE_LOCAL_BACKEND } from "../config.js";

const PAGE_SIZE = 20;
const num = (v) => typeof v === "number" && Number.isFinite(v);

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

/** The columns of the table for a set of rows: [{ key, label, cell(row), numeric }]. Only the columns at least one row has a value for. */
export function columnsFor(rows) {
  const has = (k) => rows.some((r) => num(r[k]));
  const cols = [{ key: "detector", label: "Detector", cell: (r) => r.detector }];
  if (new Set(rows.map((r) => r.field).filter(Boolean)).size > 1) cols.push({ key: "field", label: "Field", cell: (r) => r.field });
  if (new Set(rows.map((r) => r.classLabel ?? r.kind).filter(Boolean)).size > 1) cols.push({ key: "kind", label: rows.some((r) => r.classLabel) ? "Class" : "Kind", cell: (r) => r.classLabel ?? r.kind ?? "–" });
  cols.push({ key: "motion", label: "Speed (″/yr)", numeric: true, cell: (r) => (r.motion == null ? "Unavailable" : r.motion.toFixed(3)) });
  cols.push({ key: "detections", label: "Detections", numeric: true, cell: (r) => (r.images > 0 ? `${r.detections} of ${r.images}` : String(r.detections)) });
  if (has("sigma")) cols.push({ key: "sigma", label: "Significance (σ)", numeric: true, cell: (r) => (num(r.sigma) ? r.sigma.toFixed(1) : "–") });
  if (has("snr")) cols.push({ key: "snr", label: "S/N", numeric: true, cell: (r) => (num(r.snr) ? r.snr.toFixed(r.snr < 10 ? 1 : 0) : "–") });
  if (has("support")) cols.push({ key: "support", label: "Support", numeric: true, cell: (r) => (num(r.support) ? String(r.support) : "–") });
  return cols;
}

/** The sort orders a set of rows can use (an order needs at least one row with its number). */
export function sortsFor(rows) {
  return Object.entries(SORTS).filter(([, [, , key]]) => !key || rows.some((r) => num(r[key]))).map(([value, [label]]) => ({ value, label }));
}

export function setupExplorer() {
  const el = id => document.getElementById(id);
  let dataset, selected, page = 0, activeReport;
  const api = { onSelect: null };

  function clearReport() {
    activeReport?.abort();
    activeReport = undefined;
    el("report-output").hidden = true;
    el("report-output").textContent = "";
    el("download-report").hidden = true;
    el("report-status").textContent = "";
    el("ask-model").disabled = false;
  }

  function select(row, notify = true) {
    selected = row;
    clearReport();
    el("build-report").disabled = !row;
    el("ask-model").disabled = !row;
    el("candidate-detail").hidden = !row;
    for (const btn of el("candidate-rows").querySelectorAll("button")) {
      btn.setAttribute("aria-pressed", String(btn.dataset.id === row?.id));
    }
    if (notify) api.onSelect?.(row?.id ?? null);
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
    viewer.hidden = !row.link || (needsLocalBackend && !CAN_USE_LOCAL_BACKEND);
    el("candidate-viewer-help").hidden = !(row.link && viewer.hidden);
    if (viewer.hidden) viewer.removeAttribute("href");
    else viewer.href = row.link;
    viewer.textContent = needsLocalBackend ? "Open field in workspace (requires real-data backend)" : "Open synthetic field in workspace";
  }

  function currentRows() {
    return selectRows(dataset.rows, el("candidate-search").value, el("candidate-detector").value, el("candidate-sort").value, el("candidate-kind").value);
  }

  function render() {
    if (!dataset) return;
    const filtered = currentRows();
    const pages = Math.ceil(filtered.length / PAGE_SIZE);
    page = Math.min(page, Math.max(0, pages - 1));
    const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    el("candidate-count").textContent = `${filtered.length} of ${dataset.rows.length} records` + (pages > 1 ? ` · Page ${page + 1} of ${pages}` : "");
    el("candidate-pages").hidden = pages <= 1;
    el("candidate-prev").disabled = page === 0;
    el("candidate-next").disabled = page + 1 >= pages;
    const cols = columnsFor(dataset.rows);
    el("candidate-head").replaceChildren(...[{ label: "Record" }, ...cols].map((c) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = c.label;
      if (c.numeric) th.className = "num";
      return th;
    }));
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
      for (const c of cols) {
        const td = document.createElement("td");
        td.textContent = c.cell(row);
        if (c.numeric) td.className = "num";
        tr.append(td);
      }
      return tr;
    }));
    select(visible.includes(selected) ? selected : visible[0]);
  }

  /** Show a dataset: the header, the filters and the sort orders are rebuilt from its rows. */
  api.show = function show(next) {
    dataset = next;
    page = 0;
    selected = null;
    el("candidate-search").value = "";
    const rows = dataset.rows;
    const detectors = [...new Set(rows.map(r => r.detector).filter(Boolean))].sort();
    el("candidate-detector").replaceChildren(new Option("All detectors", ""), ...detectors.map(d => new Option(d, d)));
    el("candidate-detector").closest("label").hidden = detectors.length < 2;
    const kinds = [...new Set(rows.map(r => r.classLabel ?? r.kind).filter(Boolean))].sort();
    el("candidate-kind").replaceChildren(new Option(rows.some(r => r.classLabel) ? "All classes" : "All kinds", ""), ...kinds.map(k => new Option(k, k)));
    el("candidate-kind").closest("label").hidden = kinds.length < 2;
    el("candidate-sort").replaceChildren(...sortsFor(rows).map(s => new Option(s.label, s.value)));
    el("run-title").textContent = dataset.label;
    el("run-source").textContent = `${dataset.provenance} · ${dataset.date}${dataset.dateNote ? ` (${dataset.dateNote})` : ""}`;
    const matched = rows.filter(r => r.match).length;
    el("association-count").textContent = dataset.kind === "validation" ? "Each record is a validation run. The same object can appear in several runs."
      : dataset.kind === "sources" ? `${matched} of ${rows.length} sources have a catalogue or object match; the others are leads to check, not discoveries.`
      : `${matched} with a named object association · ${rows.length - matched} without a named association in the export. Detector labels use supporting frames where available and the viewer detector for older exports.`;
    render();
  };

  /** Make a record the selected one, whatever the filters and the page hide it behind. */
  api.focusRow = function focusRow(id) {
    const row = dataset?.rows.find(r => r.id === id);
    if (!row) return;
    if (!currentRows().includes(row)) {
      el("candidate-search").value = ""; el("candidate-detector").value = ""; el("candidate-kind").value = "";
    }
    const at = currentRows().indexOf(row);
    page = Math.max(0, Math.floor(at / PAGE_SIZE));
    selected = row;
    render();
    el("candidate-detail").scrollIntoView?.({ block: "nearest" });
  };

  for (const id of ["candidate-search", "candidate-detector", "candidate-sort", "candidate-kind"]) {
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
  return api;
}
