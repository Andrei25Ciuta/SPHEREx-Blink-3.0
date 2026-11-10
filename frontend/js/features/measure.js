// measure.js – "click a source, get its spectrum and light curve".
//
// 1. The user clicks the image. We turn the click into RA/Dec (canvasToSky).
// 2. getPhotometry() measures the brightness at that RA/Dec in EVERY frame.
// 3. Two charts (Plotly, loaded from the CDN only when first needed):
//      spectrum    = flux vs wavelength, one colour per survey pass (≈ every 6 months)
//      light curve = flux vs date,       one colour per detector
//    plus a plain table (accessibility: same data without colour or a mouse).

import { getPhotometry } from "../data/getCutouts.js";
import { formatRA, formatDec } from "../coords.js";
import { canvasToSky } from "../geometry.js";
import { DATA_SOURCE } from "../config.js";
import { fluxColumn } from "./spectrum.js";
import { bandSeries, missingSummary, withAlpha } from "./spectral.js";

const PLOTLY_URL = "https://cdn.jsdelivr.net/npm/plotly.js-basic-dist-min@2.35.2/plotly-basic.min.js";

// Categorical colours (dark mode), validated for colour-blind separation on our
// chart surface #0F2027 (dataviz validate_palette.js: all checks pass).
// Colour follows the ENTITY: detector Dn always gets slot n, whatever is on screen.
const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300"];
const PASS_SYMBOLS = ["circle", "square", "diamond"];     // second cue besides colour
const MAX_PASSES = 3;      // > 3 colours in a scatter are not reliably distinguishable
const TEXT = "#FBE9D0", TEXT_MUTED = "#90AEAD", GRID = "rgba(251,233,208,0.12)", SURFACE = "#0F2027";
export const APERTURE_RADIUS_PX = 2;

let plotlyPromise = null;
/** Load Plotly once, on demand. Resolves to window.Plotly. */
function loadPlotly() {
  if (window.Plotly) return Promise.resolve(window.Plotly);
  plotlyPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PLOTLY_URL;
    s.async = true;
    s.onload = () => resolve(window.Plotly);
    s.onerror = () => { plotlyPromise = null; reject(new Error("Could not load the chart library (offline?).")); };
    document.head.appendChild(s);
  });
  return plotlyPromise;
}

// Click -> sky conversion lives in geometry.js (shared with the predicted-track overlay).
export { canvasToSky };

/** Split points into survey passes: a gap of > gapDays starts a new pass. */
export function groupIntoPasses(points, gapDays = 30) {
  const passes = [];
  for (const p of [...points].sort((a, b) => a.mjd - b.mjd)) {
    const last = passes.at(-1);
    if (!last || p.mjd - last.endMjd > gapDays) passes.push({ points: [p], startMjd: p.mjd, endMjd: p.mjd });
    else { last.points.push(p); last.endMjd = p.mjd; }
  }
  passes.forEach((ps, i) => { ps.label = `Pass ${i + 1} · ${ps.points[0].dateISO.slice(0, 7)}`; });
  return passes;
}

const detIndex = (det) => Math.max(0, (parseInt(String(det).replace(/\D/g, ""), 10) || 1) - 1) % SERIES.length;

function baseLayout(xTitle, yTitle, xType) {
  const axis = (title) => ({
    title: { text: title, font: { size: 12, color: TEXT_MUTED } },
    color: TEXT_MUTED, gridcolor: GRID, zerolinecolor: "rgba(251,233,208,0.3)", linecolor: GRID,
    tickfont: { size: 11, color: TEXT_MUTED },
  });
  return {
    paper_bgcolor: SURFACE, plot_bgcolor: SURFACE,
    font: { family: "Inter, system-ui, sans-serif", color: TEXT },
    margin: { l: 56, r: 12, t: 8, b: 44 },
    xaxis: { ...axis(xTitle), type: xType },
    yaxis: axis(yTitle),
    legend: { orientation: "h", y: 1.02, yanchor: "bottom", x: 0, font: { size: 11, color: TEXT } },
    hoverlabel: { bgcolor: "#0E1C22", bordercolor: "#2C4A57", font: { color: TEXT, size: 12 } },
    showlegend: true,
  };
}
const PLOT_CONFIG = {
  responsive: true, displaylogo: false,
  modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toggleSpikelines"],
};

// Real files are in MJy/sr, so the backend also sends Jansky; the mock and old files only have image units.
const fluxOf = (p, col) => p[col];
// The error bar: the calibrated error the backend gives for real cutouts (fluxErrCal: robust ring scatter x the measured noise factor), else the plain one (the mock).
export const errOf = (p, col) => (col === "fluxJy" ? (p.fluxJyErrCal ?? p.fluxJyErr) : (p.fluxErrCal ?? p.fluxErr)) ?? 0;
const fluxLabel = (col) => (col === "fluxJy" ? "Flux (Jy)" : "Flux (image units)");
const hoverFormat = (col) => (col === "fluxJy" ? ".3g" : ".1f");
const showFlux = (v, col) => (v === null || v === undefined ? "—" : col === "fluxJy" ? v.toPrecision(3) : v.toFixed(1));

/**
 * The traces of the spectrum. style = "bars" (an error bar on every point, as always) or "band": for every survey pass a shaded band between flux - error and flux + error,
 * which BREAKS where no image covers a stretch of wavelength (a gap is drawn as a gap, never bridged), and the points on top.
 */
export function spectrumTraces(points, col = "flux", style = "bars") {
  const passes = groupIntoPasses(points.filter((p) => p.flux !== null));
  // Keep the passes with the most points if there are more than we can colour safely.
  const shown = passes.length > MAX_PASSES
    ? [...passes].sort((a, b) => b.points.length - a.points.length).slice(0, MAX_PASSES).sort((a, b) => a.startMjd - b.startMjd)
    : passes;
  const band = style === "band";
  return shown.flatMap((pass, i) => {
    const markers = {
      type: "scatter", mode: "markers", name: pass.label,
      x: pass.points.map((p) => p.wavelengthUm),
      y: pass.points.map((p) => fluxOf(p, col)),
      ...(band ? {} : { error_y: { type: "data", array: pass.points.map((p) => errOf(p, col)), color: SERIES[i], thickness: 1.5, width: 0 } }),
      error_x: { type: "data", array: pass.points.map((p) => (p.wavelengthMaxUm - p.wavelengthMinUm) / 2), color: SERIES[i], thickness: 1, width: 0 },
      marker: { color: SERIES[i], size: 9, symbol: PASS_SYMBOLS[i], line: { color: SURFACE, width: 2 } },
      customdata: pass.points.map((p) => [p.detector, p.dateISO.slice(0, 10), p.flagged ? " ⚠ flagged" : ""]),
      hovertemplate: `%{x:.3f} µm · %{customdata[0]}<br>%{customdata[1]}<br>flux %{y:${hoverFormat(col)}}${col === "fluxJy" ? " Jy" : ""}%{customdata[2]}<extra>%{fullData.name}</extra>`,
    };
    if (!band) return [markers];
    const s = bandSeries(pass.points.map((p) => ({ wavelengthUm: p.wavelengthUm, y: fluxOf(p, col), err: errOf(p, col) })));
    const edge = { type: "scatter", mode: "lines", x: s.x, connectgaps: false, hoverinfo: "skip", showlegend: false, legendgroup: pass.label, line: { width: 0, color: SERIES[i] } };
    return [{ ...edge, y: s.upper, name: `${pass.label} upper edge` },
      { ...edge, y: s.lower, name: `${pass.label} ± error`, fill: "tonexty", fillcolor: withAlpha(SERIES[i], 0.28) }, markers];
  });
}

// How the uncertainty of the spectrum is drawn, and what was drawn last (so that switching the style redraws the same measurement).
let spectrumStyle = "bars", lastSpectrum = null;
/** "bars" | "band": redraws the spectrum on screen, if there is one. */
export async function setSpectrumStyle(style) {
  spectrumStyle = style === "band" ? "band" : "bars";
  if (lastSpectrum && window.Plotly) {
    const { points, col, els } = lastSpectrum;
    await window.Plotly.react(els.spectrum, spectrumTraces(points, col, spectrumStyle), baseLayout("Wavelength (µm)", fluxLabel(col), "linear"), PLOT_CONFIG);
  }
}

function lightCurveTraces(points, col = "flux") {
  const byDet = new Map();
  for (const p of points) if (p.flux !== null) {
    if (!byDet.has(p.detector)) byDet.set(p.detector, []);
    byDet.get(p.detector).push(p);
  }
  return [...byDet.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([det, pts]) => {
      const c = SERIES[detIndex(det)];
      return {
        type: "scatter", mode: "lines+markers", name: det,
        x: pts.map((p) => p.dateISO), y: pts.map((p) => fluxOf(p, col)),
        error_y: { type: "data", array: pts.map((p) => errOf(p, col)), color: c, thickness: 1.5, width: 0 },
        line: { color: c, width: 2 },
        marker: { color: c, size: 8, line: { color: SURFACE, width: 2 } },
        customdata: pts.map((p) => [p.wavelengthUm, p.flagged ? " ⚠ flagged" : ""]),
        hovertemplate: `%{x|%Y-%m-%d}<br>%{customdata[0]:.3f} µm<br>flux %{y:${hoverFormat(col)}}${col === "fluxJy" ? " Jy" : ""}%{customdata[1]}<extra>${det}</extra>`,
      };
    });
}

function renderTable(table, points, col = "flux") {
  const unit = col === "fluxJy" ? " (Jy)" : "";
  const nominalError = points.some((p) => p.errorModel === "resampled_sky_scatter");
  table.replaceChildren();
  const head = table.createTHead();
  const labels = ["Date (UTC)", "Detector", "λ (µm)", "Flux" + unit,
    nominalError ? "± Sky scatter" : "± Error", nominalError ? "Nominal S/N" : "Flux / error", "Flag"];
  const header = head.insertRow();
  for (const label of labels) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = label;
    header.append(th);
  }
  const body = table.createTBody();
  for (const p of points) {
    const flux = fluxOf(p, col), error = errOf(p, col);
    const snr = Number.isFinite(flux) && error > 0 ? (flux / error).toFixed(1) : "—";
    const row = body.insertRow();
    for (const value of [p.dateISO.slice(0, 16).replace("T", " "), p.detector,
      showFlux(p.wavelengthUm, "fluxJy"), showFlux(flux, col), showFlux(error, col),
      snr, p.flagged ? "Flagged" : "—"]) row.insertCell().textContent = value;
  }
}

/**
 * Measure at one position and draw everything.
 * els: { pos, charts, note, tableWrap, table, spectrum, lightcurve }
 */
export async function measureAndPlot({ query, sky, els, isCurrent, motion = null, title = null }) {
  clearMeasurement(els);
  // motion = { epochMjd, pmEast, pmNorth } (arcsec/yr): follow a MOVING object, i.e. measure each image
  // where the object is on THAT image's date. Without it: one fixed sky position (a star).
  els.pos.textContent = motion ? `Measuring ${title ?? "the candidate"} along its path …`
    : `Measuring at RA ${formatRA(sky.ra)}  Dec ${formatDec(sky.dec)} …`;
  const points = await getPhotometry({
    centerRa: query.ra, centerDec: query.dec, fovArcmin: query.fov,
    ra: sky.ra, dec: sky.dec, radiusPx: APERTURE_RADIUS_PX, motion,
  });
  if (!isCurrent()) return;

  const col = fluxColumn(points);
  const valid = points.filter((p) => p.flux !== null);
  if (motion) {
    els.pos.textContent = `${title ?? "Candidate"}: measured along its path (${motion.pmEast.toFixed(2)}″/yr east, ${motion.pmNorth.toFixed(2)}″/yr north) · ${valid.length} measurements`;
  } else {
    const offset = `${Math.abs(sky.eastArcsec).toFixed(1)}″ ${sky.eastArcsec >= 0 ? "E" : "W"}, ` +
                   `${Math.abs(sky.northArcsec).toFixed(1)}″ ${sky.northArcsec >= 0 ? "N" : "S"} of centre`;
    els.pos.textContent = `Marked: RA ${formatRA(sky.ra)}  Dec ${formatDec(sky.dec)}  (${offset}) · ${valid.length} measurements`;
  }
  if (els.spectrumCaption) els.spectrumCaption.textContent = motion ? "Spectrum along the candidate's path" : "Spectrum at the marked position";
  if (els.lightcurveCaption) els.lightcurveCaption.textContent = motion ? "Light curve along the candidate's path" : "Light curve at the marked position";
  if (els.note) {
    els.noteHtml ??= els.note.innerHTML;                                // the text written in index.html
    if (motion) els.note.textContent = `Flux = background-subtracted sum in a ${APERTURE_RADIUS_PX}-pixel aperture placed where the candidate is on each image's date` +
      (col === "fluxJy" ? ", converted from MJy/sr to Jansky with the pixel size. A quick aperture sum, not SPHEREx's own calibrated photometry: treat the absolute values as approximate." : ", in image units (not calibrated).") +
      " The 1–2 µm and 4–5 µm points come from different detectors, so compare the shape of the spectrum, not single points.";
    else els.note.textContent = `Flux is the background-subtracted sum in a ${APERTURE_RADIUS_PX}-pixel aperture at a fixed sky position. ${col === "fluxJy" ? "Flux density is in Jy, with approximate aperture calibration." : "Flux is in image units."} Detector visits can fall on different dates. A moving source can leave the aperture.`;
    if (points.some((p) => p.errorModel === "resampled_sky_scatter"))
      els.note.textContent += " The listed error is sky scatter measured after image resampling; interpolation correlates pixels, so the shown S/N is nominal and may be too high. It excludes calibration and source-noise terms.";
  }

  const visible = () => points.filter(p => !els.detector?.value || p.detector === els.detector.value);
  if (els.detector) {
    const detectors = [...new Set(points.map(p => p.detector))].sort();
    els.detector.replaceChildren(new Option("All detectors", ""), ...detectors.map(d => new Option(d, d)));
    els.detector.onchange = () => renderTable(els.table, visible(), col);
    els.download.onclick = () => {
      const sources = new Set(points.map(p => p.provenance ?? "unverified"));
      const provenance = DATA_SOURCE === "api"
        ? sources.size === 1 ? [...sources][0] : "mixed" : "synthetic demo";
      const report = { data: provenance,
        center: query, position: sky, motion, apertureRadiusPx: APERTURE_RADIUS_PX,
        detector: els.detector.value || "all", displayedFluxColumn: col, generated: new Date().toISOString(),
        measurements: visible() };
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `spherex-${DATA_SOURCE}-photometry.json` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  }
  renderTable(els.table, points, col);
  if (els.missing) els.missing.textContent = missingSummary(points).text;          // what is there and what is missing, said in words
  if (els.tools) els.tools.hidden = false;
  els.tableWrap.hidden = false;
  els.note.hidden = false;
  els.charts.hidden = false;

  if (!valid.length) {
    els.charts.hidden = true;
    els.pos.textContent += " – too close to the edge, nothing measured.";
    return points;
  }

  let Plotly;
  try { Plotly = await loadPlotly(); }
  catch (err) {
    if (!isCurrent()) return;
    els.charts.hidden = true;
    els.pos.textContent += ` (${err.message} The table below has the same numbers.)`;
    els.tableWrap.open = true;
    return points;
  }
  if (!isCurrent()) return points;
  lastSpectrum = { points, col, els };
  await Plotly.react(els.spectrum, spectrumTraces(points, col, spectrumStyle), baseLayout("Wavelength (µm)", fluxLabel(col), "linear"), PLOT_CONFIG);
  if (!isCurrent()) return;
  await Plotly.react(els.lightcurve, lightCurveTraces(points, col), baseLayout("Date", fluxLabel(col), "date"), PLOT_CONFIG);
  return points;
}

/** Remove charts (e.g. new position loaded). */
export function clearMeasurement(els) {
  els.pos.textContent = "";
  lastSpectrum = null;
  if (els.missing) els.missing.textContent = "";
  if (els.tools) els.tools.hidden = true;
  els.charts.hidden = true;
  els.note.hidden = true;
  els.tableWrap.hidden = true;
  els.table.innerHTML = "";
  if (window.Plotly) { window.Plotly.purge(els.spectrum); window.Plotly.purge(els.lightcurve); }
}
