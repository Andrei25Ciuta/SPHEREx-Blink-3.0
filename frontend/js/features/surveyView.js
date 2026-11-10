// surveyView.js – the page part of "Which survey images cover a place?" (the maths and the request are in surveyCoverage.js, tested with Node).
//
//   setupSurveySearch({ els, fetchSurvey, openField, hasBackend, currentField })
//
// fetchSurvey(params) -> Promise of the backend's answer (or rejects with a sentence); openField({ ra, dec, fov }) opens a position in the viewer; hasBackend is false with synthetic data;
// currentField() -> { ra, dec } of the data on screen, or null.
//
// A button that cannot work says why, in words, where the user is looking: without a backend it is disabled and the status line explains (IRSA sends no CORS headers, so the page cannot ask it
// itself). A failed search draws nothing in place of the answer.

import { parseRA, parseDec, formatRA, formatDec } from "../coords.js";
import { planeOffsets, coverage, coverageText, planeRow } from "./surveyCoverage.js";

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...kids);
  return e;
};
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

export const NO_BACKEND_TEXT = "Needs the backend (open the page with ?data=api): IRSA, the archive of the SPHEREx survey, sends no CORS headers, so a web page cannot ask it directly. Nothing is invented in its place.";

export function setupSurveySearch({ els, fetchSurvey, openField, hasBackend, currentField }) {
  let ticket = 0;                                   // a late answer to an earlier search is ignored

  function drawPlot(answer, ra, dec, radiusDeg) {
    const radiusArcmin = radiusDeg * 60, shapes = [];
    for (const p of answer.planes) {
      const poly = planeOffsets(p, ra, dec);
      if (poly) shapes.push({ p, poly, centre: coverage([p], ra, dec).covering.length === 1 });
    }
    const reach = Math.max(radiusArcmin, ...shapes.filter((s) => s.centre).flatMap((s) => s.poly.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]))) * 1.08;
    const svg = svgEl("svg", { viewBox: `${-reach} ${-reach} ${2 * reach} ${2 * reach}`, class: "survey-svg", role: "img",
      "aria-label": `Footprints of ${shapes.length} survey images around RA ${formatRA(ra)}, Dec ${formatDec(dec)}, at true scale, east to the left, north up. The table below lists them.` });
    for (const s of shapes.filter((x) => !x.centre)) svg.append(svgEl("polygon", { points: s.poly.map(([x, y]) => `${x.toFixed(2)},${(-y).toFixed(2)}`).join(" "), class: "survey-poly-far" }));
    for (const s of shapes.filter((x) => x.centre)) svg.append(svgEl("polygon", { points: s.poly.map(([x, y]) => `${x.toFixed(2)},${(-y).toFixed(2)}`).join(" "), class: "fp-poly" }));
    svg.append(svgEl("circle", { cx: 0, cy: 0, r: radiusArcmin, class: "survey-circle" }), svgEl("circle", { cx: 0, cy: 0, r: Math.max(0.8, reach / 90), class: "fp-centre" }));
    els.plot.replaceChildren(svg);
    return shapes.length;
  }

  function drawTable(answer, ra, dec) {
    const rows = answer.planes.map((p) => planeRow(p, ra, dec)).sort((a, b) => a.mjd - b.mjd);
    els.table.replaceChildren(
      el("caption", { className: "sr-only", textContent: "Survey images that touch the circle, oldest first, with whether each covers the centre of the search." }),
      el("thead", {}, el("tr", {}, ...["Date (UTC)", "Detector", "λ (µm)", "Covers the centre"].map((t) => el("th", { scope: "col", textContent: t })))),
      el("tbody", {}, ...rows.map((r) => el("tr", {}, el("td", { textContent: r.date }), el("td", { textContent: r.detector }), el("td", { textContent: r.wavelength }), el("td", { textContent: r.coversCentre ? "yes" : "no" })))));
  }

  function clear() { els.result.hidden = true; els.plot.replaceChildren(); els.table.replaceChildren(); els.summary.textContent = ""; }

  async function search(event) {
    event?.preventDefault();
    els.error.textContent = "";
    const raP = parseRA(els.ra.value), decP = parseDec(els.dec.value);
    if (!raP.ok || !decP.ok) { els.error.textContent = !raP.ok ? raP.error : decP.error; return; }
    const radiusDeg = Number(els.radius.value), det = els.det.value, limit = Number(els.limit.value), mine = ++ticket;
    els.button.disabled = true;
    clear();
    els.status.textContent = "Asking IRSA through the backend… (a few seconds; up to a minute if IRSA is slow)";
    try {
      const answer = await fetchSurvey({ ra: raP.deg, dec: decP.deg, radiusDeg, det, limit });
      if (mine !== ticket) return;
      const c = coverage(answer.planes, raP.deg, decP.deg, { truncated: Boolean(answer.truncated) });
      drawPlot(answer, raP.deg, decP.deg, radiusDeg);
      drawTable(answer, raP.deg, decP.deg);
      els.summary.textContent = coverageText(c);
      els.status.textContent = `${answer.planes.length} survey image${answer.planes.length === 1 ? "" : "s"} touch the circle (RA ${formatRA(raP.deg)}, Dec ${formatDec(decP.deg)}, radius ${radiusDeg * 60 < 60 ? `${Math.round(radiusDeg * 60)}′` : `${radiusDeg}°`}`
        + `${det === "all" ? "" : `, detector ${det}`}). Retrieved ${answer.retrievedAt}${answer.fromCache ? " (kept from an earlier search; IRSA is asked again after a day)" : ""} from ${answer.source}.`
        + `${answer.truncated ? ` The list stops at ${answer.query?.limit ?? limit} images: more exist.` : ""}${answer.skipped ? ` ${answer.skipped} row${answer.skipped === 1 ? "" : "s"} with a footprint that could not be read ${answer.skipped === 1 ? "was" : "were"} left out.` : ""}`;
      els.result.hidden = false;
      els.openBtn.onclick = () => openField({ ra: raP.deg, dec: decP.deg, fov: 5 });
    } catch (err) {
      if (mine !== ticket) return;
      els.status.textContent = `The search failed: ${err.message} Nothing is drawn in its place.`;
    } finally { if (mine === ticket) els.button.disabled = !hasBackend; }
  }

  els.form.addEventListener("submit", search);
  els.fieldBtn.addEventListener("click", () => {
    const f = currentField();
    if (!f) { els.error.textContent = "No data is loaded: type a position instead."; return; }
    els.error.textContent = "";
    els.ra.value = f.ra.toFixed(4); els.dec.value = f.dec.toFixed(4);
  });
  if (!hasBackend) { els.button.disabled = true; els.status.textContent = NO_BACKEND_TEXT; }
  return { search, get ticket() { return ticket; } };
}
