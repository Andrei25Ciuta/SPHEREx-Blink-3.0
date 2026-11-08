// candidateExplorerView.js – the page part of the candidate explorer: a table you can sort (click a column), filter, search and page, and a plot of
// support score against signal-to-noise that shows the same sources. The maths is in candidateExplorer.js (pure, tested); this file builds the DOM, so it is
// checked in the browser.
//
//   const explorer = createExplorer({ root, onSelect, threshold, showField });
//   explorer.setRows(rows);          // rows as described in candidateExplorer.js
//   explorer.setSelected(id | null); // the one whose dossier is open
//
// The table is the way in for keyboard and screen readers (a real <table>, sortable column buttons, a button in every row); the plot is a picture of the
// same rows, hidden from assistive technology on purpose, and clicking a point selects it like clicking its row.

import { FILTERS, COLUMNS, exploreRows, cellText, scatterLayout } from "./candidateExplorer.js";
import { stateHtml, sparklineSvg } from "./ui.js";

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter((k) => k !== null && k !== undefined));
  return e;
};
const PAGE_SIZES = [10, 25, 50];

export function createExplorer({ root, onSelect = () => {}, threshold = null, showField = false }) {
  let rows = [], selected = null;
  const state = { filter: "all", text: "", sortKey: null, sortDir: "asc", page: 1, pageSize: 10 };
  const uid = `ex${Math.random().toString(36).slice(2, 7)}`;
  // the first column holds the button that opens a row, so the class stays first and the field comes next
  const columns = showField ? [COLUMNS[0], { key: "field", label: "Field", title: "The field and detector the source was found in" }, ...COLUMNS.slice(1)] : COLUMNS;

  // ------------------------------------------------------------------ the pieces
  const filter = el("select", { className: "ex-filter", id: `${uid}-filter` }, ...Object.entries(FILTERS).map(([k, [label]]) => el("option", { value: k, textContent: label })));
  const search = el("input", { type: "search", className: "ex-search", id: `${uid}-search`, placeholder: "id, catalogue, class…", autocomplete: "off" });
  const size = el("select", { className: "ex-size", id: `${uid}-size` }, ...PAGE_SIZES.map((n) => el("option", { value: String(n), textContent: String(n) })));
  const toolbar = el("div", { className: "ex-toolbar" },
    el("label", { htmlFor: filter.id }, "Show ", filter), el("label", { htmlFor: search.id }, "Search ", search), el("label", { htmlFor: size.id }, "Rows per page ", size));
  const count = el("p", { className: "ex-count", role: "status" });
  count.setAttribute("aria-live", "polite");

  const plotBox = el("div", { className: "chart ex-plotbox" });                 // .chart: a dark ground in every theme, like the other charts
  const plotNote = el("figcaption", { className: "ex-plotnote" });
  const plot = el("figure", { className: "ex-plot" }, plotBox, plotNote);
  plot.setAttribute("aria-hidden", "true");                                   // the table below is the accessible version of the same rows

  const headRow = el("tr");
  const sortButtons = new Map();
  for (const col of columns) {
    const btn = el("button", { type: "button", className: "ex-sort", title: `${col.title}. Press to sort by this column.` }, col.label, el("span", { className: "ex-arrow", textContent: "" }));
    btn.addEventListener("click", () => {
      state.sortDir = state.sortKey === col.key ? (state.sortDir === "asc" ? "desc" : "asc") : (col.numeric && col.key !== "ra" && col.key !== "dec" ? "desc" : "asc");   // a number you want the biggest of first
      state.sortKey = col.key;
      state.page = 1;
      render();
    });
    sortButtons.set(col.key, btn);
    headRow.append(el("th", { scope: "col", className: col.numeric ? "num" : "" }, btn));
  }
  // A small picture of each source's spectrum, for the rows that have one (the live app measures every source in every image; the published results page has no
  // spectra and no pixels, so there the column stays hidden). Not sortable: the numbers are in the dossier a row opens.
  const specTh = el("th", { scope: "col", className: "ex-spec", textContent: "Spectrum", title: "Flux against wavelength over the images where the source was measured and not flagged: a sketch of the shape, the numbers are in its dossier" });
  specTh.hidden = true;
  headRow.append(specTh);
  const tbody = el("tbody");
  const table = el("table", { className: "ex-table" }, el("caption", { className: "sr-only", textContent: "Sources, one row each. Sort with the column buttons." }), el("thead", {}, headRow), tbody);
  const tableWrap = el("div", { className: "table-scroll" }, table);
  const prev = el("button", { type: "button", className: "btn btn-small", textContent: "‹ Previous" });
  const next = el("button", { type: "button", className: "btn btn-small", textContent: "Next ›" });
  const pageText = el("span", { className: "ex-pagetext" });
  const pager = el("nav", { className: "ex-pager" }, prev, pageText, next);
  pager.setAttribute("aria-label", "Pages of the table");
  root.replaceChildren(el("div", { className: "explorer" }, toolbar, count, plot, tableWrap, pager));

  // ------------------------------------------------------------------ events
  filter.addEventListener("change", () => { state.filter = filter.value; state.page = 1; render(); });
  search.addEventListener("input", () => { state.text = search.value; state.page = 1; render(); });
  size.addEventListener("change", () => { state.pageSize = Number(size.value); state.page = 1; render(); });
  prev.addEventListener("click", () => { state.page -= 1; render(); });
  next.addEventListener("click", () => { state.page += 1; render(); });

  // ------------------------------------------------------------------ drawing
  function drawPlot(matchedIds) {
    // percent coordinates: the plot scales with its box and its text keeps its real size on a phone
    const L = scatterLayout(rows, { width: 100, height: 100, margin: { left: 9, right: 3, top: 4, bottom: 17 }, threshold });
    const parts = [];
    const { x0, x1, y0, y1 } = L.plot;
    const pct = (v) => `${v.toFixed(2)}%`;
    parts.push(el("div", { className: "ex-axisbox", style: `left:${pct(x0)};top:${pct(y0)};width:${pct(x1 - x0)};height:${pct(y1 - y0)}` }));
    for (const t of L.yTicks) parts.push(el("span", { className: "ex-tick ex-tick-y", textContent: String(t.value), style: `top:${pct(t.y)}` }));
    for (const t of L.xTicks) parts.push(el("span", { className: "ex-tick ex-tick-x", textContent: String(t.value), style: `left:${pct(t.x)};top:${pct(y1)}` }));
    parts.push(el("span", { className: "ex-axislabel", textContent: "median signal-to-noise (log scale) →   ·   support ↑" }));
    if (L.thresholdY !== null) {
      parts.push(el("div", { className: "ex-threshold", style: `left:${pct(x0)};width:${pct(x1 - x0)};top:${pct(L.thresholdY)}` }));
      parts.push(el("span", { className: "ex-thresholdlabel", textContent: `needs checking ≥ ${threshold}`, style: `top:${pct(L.thresholdY)}` }));
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const p of L.points) {
      const r = byId.get(p.id);
      const dot = el("button", { type: "button", className: `ex-dot cls-${p.class}${matchedIds.has(p.id) ? "" : " is-off"}${p.id === selected ? " is-selected" : ""}`, style: `left:${pct(p.x)};top:${pct(p.y)}`, tabIndex: -1, title: `${r.id}: ${r.classLabel ?? r.class}, support ${r.support}, S/N ${cellText(r, "snr")}` });
      dot.addEventListener("click", () => select(r.id));
      parts.push(dot);
    }
    plotBox.replaceChildren(...parts);
    plotNote.textContent = `Each point is a source: support score against signal-to-noise. ${threshold !== null ? `The dashed line is the “needs checking” threshold (${threshold}). ` : ""}Faint points do not pass the filter or search. ${L.skipped ? `${L.skipped} source${L.skipped === 1 ? " has" : "s have"} no signal-to-noise and ${L.skipped === 1 ? "is" : "are"} only in the table. ` : ""}Click a point to open it.`;
  }

  function render() {
    const view = exploreRows(rows, state);
    state.page = view.page;
    const showSpec = rows.some((r) => r.spec);
    specTh.hidden = !showSpec;
    // header: which column is sorted, and which way
    for (const [key, btn] of sortButtons) {
      const th = btn.parentElement, on = state.sortKey === key;
      th.setAttribute("aria-sort", on ? (state.sortDir === "asc" ? "ascending" : "descending") : "none");
      btn.querySelector(".ex-arrow").textContent = on ? (state.sortDir === "asc" ? " ▲" : " ▼") : "";
    }
    tbody.replaceChildren(...view.rows.map((r) => {
      const tr = el("tr", { className: r.id === selected ? "is-selected" : "" });
      columns.forEach((col, i) => {
        const text = cellText(r, col.key);
        const td = el("td", { className: col.numeric ? "num" : "" });
        if (i === 0) {
          const b = el("button", { type: "button", className: "ex-rowbtn", textContent: text, title: `Open ${r.id}` });
          b.setAttribute("aria-label", `${r.id}: ${text}. Open its details.`);
          if (r.id === selected) b.setAttribute("aria-current", "true");
          b.addEventListener("click", () => select(r.id));
          td.append(b);
        } else td.textContent = text;
        tr.append(td);
      });
      const spec = el("td", { className: "ex-spec" });
      spec.hidden = !showSpec;
      if (r.spec) spec.innerHTML = sparklineSvg(r.spec);
      tr.append(spec);
      tr.addEventListener("click", (e) => { if (!e.target.closest("button")) select(r.id); });
      return tr;
    }));
    if (!view.rows.length) {
      const cell = el("td", { colSpan: columns.length + (showSpec ? 1 : 0), className: "ex-empty" });
      cell.innerHTML = rows.length
        ? stateHtml({ kind: "empty", title: "No source passes this filter and search", text: "Change the filter or clear the search to see the others." })
        : stateHtml({ kind: "empty", title: "Nothing to show yet", text: "Run Find everything on a field to fill the table." });
      tbody.append(el("tr", {}, cell));
    }
    count.textContent = view.matched === 0 ? `0 of ${view.all} sources match.`
      : `Showing ${view.from}–${view.to} of ${view.matched}${view.matched !== view.all ? ` matching (${view.all} sources in all)` : " sources"}.`;
    pageText.textContent = `Page ${view.page} of ${view.pages}`;
    prev.disabled = view.page <= 1;
    next.disabled = view.page >= view.pages;
    pager.hidden = view.pages <= 1;
    drawPlot(new Set(view.ordered.map((r) => r.id)));
  }

  function select(id) { selected = id; render(); onSelect(id); }

  render();
  return {
    setRows(list) { rows = list; state.page = 1; selected = rows.some((r) => r.id === selected) ? selected : null; render(); },
    setSelected(id) { selected = id; render(); },
    /** Reset the controls (a new search starts from a clean table). */
    reset() { Object.assign(state, { filter: "all", text: "", sortKey: null, sortDir: "asc", page: 1 }); filter.value = "all"; search.value = ""; render(); },
  };
}
