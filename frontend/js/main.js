// main.js – entry point of the app. It wires the UI to the other modules.
//
//   form + quick picks  -> getCutouts()  -> detector select + overview
//                                         -> BlinkPlayer (blink / difference / stack / trail)
//   click on the image  -> measure.js    -> spectrum + light curve
//   "Show sky map"      -> skyContext.js -> Aladin Lite + SIMBAD
//   save / record / copy link -> exporters.js

import { parseRA, parseDec, formatRA, formatDec } from "./coords.js";
import { TARGETS, positionAtEpoch, SPHEREX_REF_EPOCH, targetsInField, totalProperMotion } from "./targets.js";
import { skyToCanvas, tanCanvasToSky, mjdToYear } from "./geometry.js";
import { readUrlState, writeUrlState } from "./urlState.js";
import { getCutouts, listDetectors } from "./data/getCutouts.js";
import { DATA_SOURCE, API_BASE, CAN_USE_LOCAL_BACKEND } from "./config.js";
import { BlinkPlayer, MODES, loadImage, meanImageData } from "./player.js?v=5";
import { canvasToSky, measureAndPlot, clearMeasurement, setSpectrumStyle, APERTURE_RADIUS_PX } from "./features/measure.js";
import { setupViewer } from "./features/viewerControls.js";
import { setupWorkspace } from "./features/workspaceView.js";
import { setupPlanetLab } from "./features/planetLabView.js";
import { setupSkyExplorer } from "./features/skyExplorerView.js";
import { setupSurveySearch } from "./features/surveyView.js";
import { setupTextAnalysis } from "./features/textAnalysisView.js";
import { setupBundle } from "./features/bundleView.js";
import { fetchSurvey as askSurvey } from "./features/surveyCoverage.js";
import { setupSolarSystem } from "./features/solarSystemView.js";
import { setupAssistant } from "./features/assistantView.js";
import { runTask, isCancelled } from "./features/workerClient.js";
import { estimateSearch, describeEstimate } from "./features/searchCost.js";
import { runSearchTask } from "./features/searchTasks.js";
import { MARK_IDLE, markText } from "./features/workspace.js";
import { detectorCoverage, coverageText } from "./features/spectral.js";
import { setupTooltips } from "./features/tooltip.js";
import { applyIcons } from "./features/ui.js";
import { openDialog, shortcutsHtml } from "./features/dialog.js";
import { colourSequences } from "./features/colourBlink.js?v=3";
import { setupTimeline } from "./features/timelineView.js";
import { FLAGGED_LIMIT } from "./features/timeline.js";
import { SkyContext } from "./features/skyContext.js";
import { setupFullscreen } from "./features/fullscreen.js";
import { detectSources, describeMover, matchKnownObject, moverPositionAtMjd, passIndices, trackSupport, blendWarning, VERSION as MOVERS_VERSION, DEFAULTS as MOVER_DEFAULTS, ERROR_MODEL } from "./features/movers.js";
import { buildProvenance, provenanceText, pictureCaption } from "./features/provenance.js";
import { colourHint } from "./features/spectrum.js";
import { describeDistant, classifyApparentMotion, VERSION as PARALLAX_VERSION, DISTANT_DEFAULTS } from "./features/parallax.js";
import { candidatesToCsv, candidatesToJson, exportFileName } from "./features/export.js";
import { startTour, WORKSPACE_STEPS } from "./features/tour.js";
import { PLANET_X_DEMO } from "./data/mockSource.js";
import { compareChoices, membersFor, defaultChoice, shortLabel, OPERATIONS } from "./features/compare.js";
import { fetchCatalogue, catalogueTracks } from "./features/catalogue.js";
import { fetchSkybotForFrames, asteroidPoints, matchAsteroids } from "./features/skybot.js";
import { setComparisonFrames } from "./features/detectorPair.js";
import { savePng, recordBlink, canRecord, copyLink } from "./features/exporters.js";
import { setupDiscoverPanel } from "./features/discoverPanel.js";

// Small helper: document.getElementById is long, so we alias it.
const $ = (id) => document.getElementById(id);

const form = $("search-form");
const raInput = $("ra-input");
const decInput = $("dec-input");
const fovInput = $("fov-input");
const speedInput = $("speed-input");
const detSelect = $("det-select");
const canvas = $("blink-canvas");
const observations = $("observation-select");        // a plain list of the images, beside the timeline (from the other Blink 2.0 line)
$("data-source").value = DATA_SOURCE;
$("data-source").querySelector('option[value="api"]').disabled = !CAN_USE_LOCAL_BACKEND;
$("data-source-help").hidden = CAN_USE_LOCAL_BACKEND;
$("data-source").addEventListener("change", event => {
  const url = new URL(location.href);
  url.searchParams.set("data", event.target.value);
  location.assign(url.href);
});

// Detector asked for in the URL. The <select> is only filled once data arrives,
// so we remember the wish here and apply it then.
let requestedDetector = null;

// FOV limits – must match min/max of the slider in index.html.
const FOV_MIN = 1, FOV_MAX = 30;
// "Skip flagged frames" threshold.
const MAX_FLAGGED_FRACTION = FLAGGED_LIMIT;       // "Skip frames with > 1 % flagged pixels": the same limit marks a diamond on the timeline

// ---------------------------------------------------------------
// Data state
// ---------------------------------------------------------------
let allFrames = [];       // every frame returned for the current position
let currentFrames = [];   // frames of the selected detector only (time-ordered)
let currentDetector = null;
let currentQuery = null;  // { ra, dec, fov } of the loaded data
let loadToken = 0;        // increases on every load; protects against out-of-order responses
let lastQuery = null;     // remembered so "Try again" can repeat the failed request
let discoverPanel = null; // the "Find everything" panel (set up further down)

// ---------------------------------------------------------------
// Slider labels
// ---------------------------------------------------------------
fovInput.addEventListener("input", () => { $("fov-value").textContent = fovInput.value; });
speedInput.addEventListener("input", () => {
  $("speed-value").textContent = speedInput.value;
  player.setFps(speedInput.value);
});

// "change" fires when the user RELEASES the slider (not on every pixel of movement),
// so we don't rewrite the URL dozens of times per second.
fovInput.addEventListener("change", () => {
  writeUrlState({ fov: fovInput.value });
  if (allFrames.length) form.requestSubmit();          // reload with the new FOV
});
detSelect.addEventListener("change", () => selectDetector(detSelect.value));

/** Switch detector without a new search. Images can still fail to load -> catch. */
function selectDetector(det) {
  requestedDetector = det;
  detSelect.value = det;
  writeUrlState({ det });
  showDetector(det).catch((err) => {
    console.error(err);
    showOverlay("Could not load images", err.message, { error: true });
  });
}

// ---------------------------------------------------------------
// Field validation helpers
// ---------------------------------------------------------------
// Remember the original help texts so we can restore them.
const defaultHelp = { ra: $("ra-help").textContent, dec: $("dec-help").textContent };

/** Show or clear an error under one input (and mark it invalid for screen readers). */
function setFieldError(input, errorEl, message) {
  errorEl.textContent = message || "";
  if (message) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

/** Live preview under the field: shows how we understood the input, in both formats. */
function updatePreview(which) {
  const input = which === "ra" ? raInput : decInput;
  const helpEl = $(`${which}-help`);
  const result = which === "ra" ? parseRA(input.value) : parseDec(input.value);

  if (input.value.trim() && result.ok) {
    const sexa = which === "ra" ? formatRA(result.deg) : formatDec(result.deg);
    helpEl.textContent = `→ ${result.deg.toFixed(5)}°  =  ${sexa}`;
  } else {
    helpEl.textContent = defaultHelp[which];
  }
  // While the user types we clear old errors; they reappear on submit if still wrong.
  setFieldError(input, $(`${which}-error`), "");
}
raInput.addEventListener("input", () => updatePreview("ra"));
decInput.addEventListener("input", () => updatePreview("dec"));

/**
 * Read + validate the whole form.
 * Returns { ra, dec, fov } in degrees/arcmin, or null if something is invalid.
 */
function readForm() {
  const ra = parseRA(raInput.value);
  const dec = parseDec(decInput.value);
  setFieldError(raInput, $("ra-error"), ra.ok ? "" : ra.error);
  setFieldError(decInput, $("dec-error"), dec.ok ? "" : dec.error);

  if (!ra.ok) { raInput.focus(); return null; }      // move focus to the first bad field
  if (!dec.ok) { decInput.focus(); return null; }

  return { ra: ra.deg, dec: dec.deg, fov: Number(fovInput.value) };
}

// ---------------------------------------------------------------
// Quick-pick buttons for the test objects
// ---------------------------------------------------------------
function renderQuickPicks() {
  const list = $("quick-pick-list");
  for (const target of TARGETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = target.label;
    btn.title = `${target.kind} – position propagated to ${SPHEREX_REF_EPOCH} (SIMBAD J2000 + proper motion)`;
    btn.dataset.targetId = target.id;
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => selectTarget(target));
    list.appendChild(btn);
  }
}

/** Fill RA/Dec with the target's position at the SPHEREx epoch, then submit. */
function selectTarget(target) {
  const { ra, dec } = positionAtEpoch(target);
  raInput.value = ra.toFixed(5);
  decInput.value = dec.toFixed(5);
  updatePreview("ra");
  updatePreview("dec");

  // Visually mark which chip is active.
  document.querySelectorAll("#quick-pick-list .chip").forEach((chip) => {
    chip.setAttribute("aria-pressed", String(chip.dataset.targetId === target.id));
  });

  // requestSubmit() triggers the same "submit" handler as clicking the button.
  form.requestSubmit();
}

// If the user edits coordinates by hand, no chip is "active" anymore.
[raInput, decInput].forEach((el) => el.addEventListener("input", () => {
  document.querySelectorAll("#quick-pick-list .chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
}));

// ---------------------------------------------------------------
// Stage overlay + status helpers (empty / loading / error states)
// ---------------------------------------------------------------
const overlay = $("stage-overlay");
const overlayProgress = $("overlay-progress");
const retryBtn = $("retry-btn");

/**
 * Show the overlay on top of the image.
 *  - error: red title + "Try again" button (focused, so keyboard users land on it)
 *  - progress: number 0..1 shows a progress bar; null hides it
 */
function showOverlay(title, sub = "", { error = false, progress = null } = {}) {
  overlay.querySelector(".overlay-title").textContent = title;
  overlay.querySelector(".overlay-sub").textContent = sub;
  overlay.classList.toggle("error", error);
  overlayProgress.hidden = progress === null;
  if (progress !== null) overlayProgress.value = progress;
  retryBtn.hidden = !(error && lastQuery);
  overlay.classList.remove("hidden");
  overlay.removeAttribute("aria-hidden");
  if (error && lastQuery) retryBtn.focus();
}
const hideOverlay = () => {
  overlay.classList.add("hidden");
  // Invisible (opacity 0) is not enough: screen readers would still read the old text.
  overlay.setAttribute("aria-hidden", "true");
};
retryBtn.addEventListener("click", () => { if (lastQuery) loadData(lastQuery); });

const setStatus = (text) => { $("status-msg").textContent = text || ""; };

function setLoading(isLoading) {
  const btn = $("load-btn");
  btn.disabled = isLoading;
  btn.classList.toggle("is-loading", isLoading);
  btn.querySelector(".btn-label").textContent = isLoading ? "Loading…" : "Load images";
  $("stage").setAttribute("aria-busy", String(isLoading));
}

/** Fill the detector <select> from the data, and pick which one to show. */
function populateDetectors(frames) {
  const detectors = listDetectors(frames);
  detSelect.innerHTML = "";
  for (const d of detectors) {
    const opt = document.createElement("option");
    opt.value = d.detector;
    opt.textContent = `${d.detector} · ${d.wlMin.toFixed(2)}–${d.wlMax.toFixed(2)} µm · ${d.count} frame${d.count === 1 ? "" : "s"}`;
    detSelect.appendChild(opt);
  }
  detSelect.disabled = detectors.length === 0;

  // Prefer the detector from the URL; otherwise the one with the most frames.
  const wanted = detectors.find((d) => d.detector === requestedDetector);
  const best = [...detectors].sort((a, b) => b.count - a.count)[0];
  if (requestedDetector && !wanted && best) {
    setStatus(`Detector ${requestedDetector} has no images here – showing ${best.detector} instead.`);
  }
  return (wanted || best)?.detector ?? null;
}

// ---------------------------------------------------------------
// Blink player + its controls
// ---------------------------------------------------------------
const playBtn = $("play-btn");
const frameSlider = $("frame-slider");

const player = new BlinkPlayer(canvas, {
  onFrameChange: updateFrameInfo,
  onPlayStateChange: (playing) => {
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    playBtn.querySelector("span").className = playing ? "icon-pause" : "icon-play";
  },
});
player.setFps(speedInput.value);
player.onLightCentre = ({ kind, measurement } = {}) => {
  const status = $("colour-centre-status");
  const message = kind === "measured" ? "Halo · estimated light centre"
    : kind === "predicted" ? "Faint halo · predicted position"
      : "No halo in this frame";
  if (status.textContent !== message) status.textContent = message;

  const frame = player.frames[player.index];
  const values = {
    "colour-wavelength": ((frame.wavelengthMinUm + frame.wavelengthMaxUm) / 2).toFixed(3) + " µm",
    "colour-peak": measurement ? String(measurement.peak) : "—",
    "colour-background": measurement ? String(measurement.background) : "—",
    "colour-offset": measurement ? measurement.offsetPx.toFixed(2) + " px" : "—",
  };
  for (const [id, value] of Object.entries(values)) {
    const field = $(id);
    if (field.textContent !== value) field.textContent = value;
  }
};

// Zoom, pan, the readout under the pointer and the layer list (features/viewerControls.js). Set up BEFORE the click handler that measures:
// a click that ends a drag must stop in the viewer's own handler and never reach the measuring.
/** The pixel values of one frame as real numbers (backend `dataUrl`, float32), for the readout. Rejects when they cannot be had. */
async function loadFloatFrame(frame) {
  const response = await fetch(frame.dataUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Float32Array(await response.arrayBuffer());
}
const viewer = setupViewer({
  player, canvas, crosshair: $("crosshair"),
  zoomEls: { inBtn: $("zoom-in-btn"), outBtn: $("zoom-out-btn"), fitBtn: $("zoom-fit-btn"), level: $("zoom-level") },
  skyFn: DATA_SOURCE === "api" ? tanCanvasToSky : canvasToSky,           // real data: the north-up TAN grid of the backend (the same mapping as the click that measures)
  readoutEls: { root: $("readout"), pixel: $("ro-pixel"), sky: $("ro-sky"), offset: $("ro-offset"), value: $("ro-value"), announce: $("readout-announce") },
  layersRoot: $("layers"),
  getGeo: () => (currentQuery && currentFrames.length && player.naturalSize ? currentGeo() : null),
  loadFloat: loadFloatFrame,
});

// The inspector (features/workspaceView.js): the side panels that close, the description of a selected candidate beside its list on a wide screen,
// and the marked position, which follows the measuring circle wherever it is set or cleared.
const markEl = $("insp-mark");
function updateMarkedPosition() {
  const m = player.marker;
  const parts = m ? viewer.describeAt(m.fx, m.fy) : null;
  markEl.textContent = parts ? markText(parts) : MARK_IDLE;
  markEl.classList.toggle("has-mark", Boolean(parts));
}
player.onMarkerChange = updateMarkedPosition;
updateMarkedPosition();
setupWorkspace({
  root: $("workspace"), leftBtn: $("panel-left-btn"), rightBtn: $("panel-right-btn"),
  slot: $("inspector-slot"), empty: $("inspector-empty"), details: [$("mover-detail"), $("discover-detail")],
});

// Shared interface pieces (features/tooltip.js, ui.js, dialog.js): tooltips for the keyboard too, the icons, and the list of keyboard shortcuts.
setupTooltips();
applyIcons();
function showShortcuts() { openDialog({ title: "Keyboard shortcuts", html: shortcutsHtml(), opener: $("shortcuts-btn") }); }
$("shortcuts-btn").addEventListener("click", showShortcuts);
document.addEventListener("keydown", (e) => {
  if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  if (e.target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? "")) return;      // typing a question mark is not a command
  if (document.querySelector("dialog[open]")) return;
  e.preventDefault();
  showShortcuts();
});

// The timeline (features/timelineView.js): one button per image by time and wavelength, survey-pass switches and a wavelength window. Its filter tells the
// player which images the blink visits and which ones Stack, Trail and Difference use; the searches always use all of them.
const timeline = setupTimeline({
  root: $("timeline"), player,
  onFilterChange: () => {
    if (!player.length) return;
    updateColourPlayback();
    setPlayerEnabled(true);                                  // Play needs two images that pass the filter
    updateFrameInfo(player.index, player.frames[player.index]);
  },
});

const fmtDate = (iso) => iso.slice(0, 16).replace("T", " ") + " UTC";

/** Tell a screen reader which image is now shown (a live region), unless the blink is playing: then the user chose to watch it change, and speech every half second would be noise. */
let announceTimer = 0;
function announceFrame(text) {
  if (player.playing) return;
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { $("frame-announce").textContent = text; }, 250);          // the last of a quick run of key presses is the one said
}

/** Update counter, date, slider and metadata for the frame being shown. */
function updateFrameInfo(i, frame) {
  timeline.setCurrent(i);
  observations.value = String(i);
  frameSlider.value = String(i);
  frameSlider.setAttribute("aria-valuetext", `Frame ${i + 1} of ${player.length}, ${frame.dateISO.slice(0, 10)}`);
  $("meta-det").textContent = frame.detector;
  $("meta-mjd").textContent = frame.mjd.toFixed(3);

  if (player.isAnimated) {
    const colourIndex = player.mode === "colour" ? player.colourOrder.indexOf(i) : -1;
    $("frame-counter").textContent = colourIndex >= 0
      ? `Band ${colourIndex + 1} / ${player.playbackCount}`
      : `Frame ${i + 1} / ${player.length}`;
    $("frame-date").textContent = fmtDate(frame.dateISO);
    $("meta-wl").textContent = `${frame.wavelengthMinUm.toFixed(2)}–${frame.wavelengthMaxUm.toFixed(2)} µm`;
    $("meta-flags").textContent = !frame.flags ? "n/a"
      : frame.flags.anyFlagged ? `⚠ ${(frame.flags.fractionFlagged * 100).toFixed(1)} % px` : "Clean";
    canvas.setAttribute("aria-label",
      `SPHEREx ${frame.detector} ${player.mode === "diff" ? "difference image" : "image"} taken ${frame.dateISO.slice(0, 10)}, frame ${i + 1} of ${player.length}`);
    announceFrame(`Frame ${i + 1} of ${player.length}: ${frame.detector}, ${frame.dateISO.slice(0, 10)}, ${frame.wavelengthMinUm.toFixed(2)} to ${frame.wavelengthMaxUm.toFixed(2)} micrometres`
      + `${frame.flags?.anyFlagged ? `, ${(frame.flags.fractionFlagged * 100).toFixed(1)} percent of pixels flagged` : ""}.`);
  } else if (player.mode === "compare" && compareState) {
    // Compare: A − B or A + B of the images / passes you picked.
    const { a, b, op } = compareState;
    const used = [...new Set([...compareMembers(a), ...compareMembers(b)])].map((k) => player.frames[k]);
    const sign = op === "sub" ? "−" : "+";
    $("frame-counter").textContent = OPERATIONS[op];
    $("frame-date").textContent = `${shortLabel(a, player.frames)} ${sign} ${shortLabel(b, player.frames)}`;
    $("meta-wl").textContent = `${Math.min(...used.map((f) => f.wavelengthMinUm)).toFixed(2)}–${Math.max(...used.map((f) => f.wavelengthMaxUm)).toFixed(2)} µm`;
    const flagged = used.filter((f) => f.flags?.anyFlagged).length;
    $("meta-flags").textContent = flagged ? `⚠ ${flagged} of ${used.length} images` : "Clean";
    $("meta-mjd").textContent = `${Math.min(...used.map((f) => f.mjd)).toFixed(1)}–${Math.max(...used.map((f) => f.mjd)).toFixed(1)}`;
    canvas.setAttribute("aria-label",
      `SPHEREx ${frame.detector} ${op === "sub" ? "difference" : "sum"} image: ${shortLabel(a, player.frames)} ${sign} ${shortLabel(b, player.frames)}`);
  } else {
    // Stack / trail: one image made from the images the timeline filter lets through (all of them without a filter).
    const used = player.activeIndices.map((k) => player.frames[k]);
    const total = player.length, of = used.length === total ? `${total}` : `${used.length} of ${total}`;
    const name = player.mode === "mean" ? "Stack" : "Trail";
    if (!used.length) {
      $("frame-counter").textContent = `${name}: no image passes the timeline filter`;
      $("frame-date").textContent = "—";
      canvas.setAttribute("aria-label", `SPHEREx ${frame.detector} ${name.toLowerCase()}: no image passes the timeline filter, showing the plain image`);
      return;
    }
    const f0 = used[0], f1 = used.at(-1);
    const wlMin = Math.min(...used.map((f) => f.wavelengthMinUm));
    const wlMax = Math.max(...used.map((f) => f.wavelengthMaxUm));
    $("frame-counter").textContent = `${name} of ${of}`;
    $("frame-date").textContent = `${f0.dateISO.slice(0, 10)} → ${f1.dateISO.slice(0, 10)}`;
    $("meta-wl").textContent = `${wlMin.toFixed(2)}–${wlMax.toFixed(2)} µm`;
    const flagged = used.filter((f) => f.flags?.anyFlagged).length;
    $("meta-flags").textContent = flagged ? `⚠ ${flagged} of ${used.length} frames` : "Clean";
    $("meta-mjd").textContent = `${f0.mjd.toFixed(1)}–${f1.mjd.toFixed(1)}`;
    canvas.setAttribute("aria-label",
      `SPHEREx ${f0.detector} ${player.mode === "mean" ? "average" : "maximum (trail)"} of ${of} images, ${f0.dateISO.slice(0, 10)} to ${f1.dateISO.slice(0, 10)}`);
  }
}

/** Enable/disable the player controls according to frames + mode. */
function setPlayerEnabled(enabled) {
  const animated = enabled && player.isAnimated && player.length > 1;
  playBtn.disabled = !animated || player.playbackCount < 2;     // the timeline filter may leave fewer than two images to step through
  if (playBtn.disabled && player.playing) player.pause();
  frameSlider.disabled = !animated;
  observations.disabled = !enabled || !player.isAnimated;
  speedInput.disabled = !animated;
  $("save-png-btn").disabled = !enabled;
  $("record-btn").disabled = !animated || player.playbackCount < 2 || !canRecord();
  // Modes that combine frames need at least 2 of them.
  document.querySelectorAll('#mode-switch input:not([value="blink"])')
    .forEach((r) => { r.disabled = !enabled || player.length < 2; });
  $("show-flags").disabled = !enabled || !player.hasFlagMasks;
  viewer.refresh();                                  // the zoom buttons follow whether there is a picture
  $("find-movers-btn").disabled = !enabled || !canFindMovers();
  $("find-distant-btn").disabled = !enabled || !canFindMovers();
  planetLab?.refresh();
  if (discoverPanel) { if (enabled) discoverPanel.refresh(); else $("discover-btn").disabled = true; }
}

observations.addEventListener("change", () => {
  player.pause();
  player.goTo(Number(observations.value));
});
playBtn.addEventListener("click", () => player.toggle());

// Dragging the slider = manual control, so we pause the animation.
frameSlider.addEventListener("input", () => {
  player.pause();
  player.goTo(Number(frameSlider.value));
});

// Keyboard shortcuts: Space = play/pause, ←/→ = previous/next frame.
// Ignored while typing in a field / using a select or slider (they need these keys).
// On a focused button, Space already "clicks" it, so we only take over the arrows there.
document.addEventListener("keydown", (e) => {
  if (!(e.target instanceof Element) || e.target.closest("input, select, textarea, summary, .skymap") || !player.length) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;    // leave browser shortcuts alone
  if (e.shiftKey && e.key.startsWith("Arrow")) return;   // Shift + arrows move a zoomed picture (viewerControls.js)
  if (e.key === "Escape" && player.marker) { clearMarker(); return; }
  if (!player.isAnimated) return;
  const onButton = !!e.target.closest("button, a");
  if (e.key === " " && !onButton) { e.preventDefault(); player.toggle(); }
  else if (e.key === "ArrowRight") { player.pause(); player.next(); }
  else if (e.key === "ArrowLeft") { player.pause(); player.prev(); }
});

// Users who asked their OS for less motion don't get auto-play.
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------
// View modes
// ---------------------------------------------------------------
const MODE_HELP = {
  blink: "Images from different dates, one after another. Most stars stay put – look for a dot that <strong>jumps</strong>.",
  diff: 'Each image minus the median of the images from <em>other</em> dates: still stars vanish. <span class="swatch" style="background:#ff9e33"></span> brighter than usual – the object is here now · <span class="swatch" style="background:#409eff"></span> fainter than usual.',
  mean: "Average of all images: deeper and less noisy. Moving objects get smeared or fade out.",
  max: "Brightest value of every pixel over all dates: a moving object leaves a <strong>trail of dots</strong>, a still star stays one dot.",
  colour: "Blink from shorter to longer wavelengths within one survey pass. The coloured halo marks the local brightness centre near the selected candidate, a marked position, a single test target, or the field centre. A faint halo marks the predicted position when the light centre is unavailable.",
  compare: 'Pick two images, or whole survey passes. <strong>A − B</strong>: <span class="swatch" style="background:#ff9e33"></span> brighter in A · <span class="swatch" style="background:#409eff"></span> fainter in A – a mover is an orange dot next to a blue one, still stars vanish. <strong>A + B</strong>: the average of both, a deeper picture. Other dates are also other wavelengths, so bright stars can leave a faint leftover even if they did not move.',
};

const colourPass = $("colour-pass");

function updateColourPlayback({ restart = false } = {}) {
  const enabled = player.mode === "colour";
  $("colour-controls").hidden = !enabled;
  $("colour-measurements").hidden = !enabled;
  if (!enabled) return;
  const sequences = colourSequences(player.frames, player.activeIndices);
  const previous = colourPass.value;
  const selected = sequences.find(pass => String(pass.id) === previous)
    ?? sequences.find(pass => pass.indices.includes(player.index)) ?? sequences[0];
  colourPass.replaceChildren(...sequences.map(pass => new Option(`${pass.label} · ${pass.when}`, pass.id)));
  colourPass.disabled = !selected;
  if (selected) colourPass.value = String(selected.id);
  player.setColourOrder(selected?.indices ?? [], { restart });
  $("colour-status").textContent = selected
    ? `${selected.indices.length} frames · short to long wavelength. Dates can differ within a pass.`
    : "No pass has two distinct wavelengths in the current filters. Try another detector or show all frames.";
}
colourPass.addEventListener("change", () => {
  updateColourPlayback({ restart: true });
  setPlayerEnabled(Boolean(player.length));
});

function setMode(mode, { updateUrl = true } = {}) {
  if (!MODES.includes(mode)) mode = "blink";
  const radio = document.querySelector(`#mode-switch input[value="${mode}"]`);
  if (radio.disabled) mode = "blink";
  document.querySelector(`#mode-switch input[value="${mode}"]`).checked = true;
  player.setMode(mode);
  updateColourPlayback();
  $("mode-help").innerHTML = MODE_HELP[mode];
  $("compare-controls").hidden = mode !== "compare";
  if (updateUrl) writeUrlState({ mode: mode === "blink" ? null : mode });
  if (player.length) {
    setPlayerEnabled(true);
    updateFrameInfo(player.index, player.frames[player.index]);
    if (player.isAnimated && !player.playing && !prefersReducedMotion && player.length > 1) player.play();
  }
}
document.querySelectorAll('#mode-switch input').forEach((r) =>
  r.addEventListener("change", () => setMode(r.value)));

// ---------------------------------------------------------------
// Compare mode: A − B / A + B of images or survey passes you pick (features/compare.js)
// ---------------------------------------------------------------
let compareState = null;           // { choices, a, b, op } for the frames on screen

const compareMembers = (value) => (compareState ? membersFor(value, compareState.choices) : []);

/** Fill the A and B menus from the frames on screen; start with "latest pass − earliest pass". */
function setupCompare() {
  const choices = compareChoices(player.frames);
  const start = defaultChoice(choices);
  const fill = (select, value) => {
    const group = (label, items) => {
      const g = document.createElement("optgroup");
      g.label = label;
      g.append(...items.map((c) => new Option(c.label, c.value)));
      return g;
    };
    select.replaceChildren();
    if (choices.passes.length > 1) select.append(group("Survey passes (average of their images)", choices.passes));
    select.append(group("Single images", choices.singles));
    select.value = value;
  };
  fill($("cmp-a"), start.a);
  fill($("cmp-b"), start.b);
  compareState = { choices, a: start.a, b: start.b, op: $("cmp-op").value };
  applyCompare();
}

/** Read the three menus, tell the player, refresh the info line. */
function applyCompare() {
  if (!compareState) return;
  compareState.a = $("cmp-a").value;
  compareState.b = $("cmp-b").value;
  compareState.op = $("cmp-op").value;
  player.setCompare({ a: compareMembers(compareState.a), b: compareMembers(compareState.b), op: compareState.op });
  if (player.mode === "compare" && player.length) updateFrameInfo(player.index, player.frames[player.index]);
}
["cmp-a", "cmp-b", "cmp-op"].forEach((id) => $(id).addEventListener("change", applyCompare));

// ---------------------------------------------------------------
// Flags
// ---------------------------------------------------------------
$("show-flags").addEventListener("change", (e) => {
  player.setShowFlags(e.target.checked);
  $("flags-legend").hidden = !e.target.checked;          // say what the red means
});
$("skip-flagged").addEventListener("change", () => { if (currentDetector) selectDetector(currentDetector); });

/** Frames of one detector, without the badly flagged ones if the user asked so. */
function framesFor(detector) {
  const frames = allFrames.filter((f) => f.detector === detector);
  if (!$("skip-flagged").checked) return { frames, skipped: 0 };
  const kept = frames.filter((f) => !f.flags || f.flags.fractionFlagged <= MAX_FLAGGED_FRACTION);
  return { frames: kept, skipped: frames.length - kept.length };
}

// ---------------------------------------------------------------
// Predicted track of known objects (SIMBAD position + proper motion, per frame date)
// ---------------------------------------------------------------
$("show-track").addEventListener("change", (e) => player.setShowTracks(e.target.checked));

/**
 * For every known test object inside the field: where SHOULD it be on each frame's date?
 * If the object sits on the green ticks in every frame, the whole chain (archive query,
 * cutout, orientation, timing) is right. It also tells how far it moves – in pixels.
 */
function updateTracks() {
  const info = $("track-info");
  const box = $("show-track");
  if (!currentQuery || !currentFrames.length || !player.naturalSize) {
    player.setTracks([]); info.textContent = ""; box.disabled = true; return;
  }
  const n = player.naturalSize;
  const scaleArcsec = currentFrames[0].pixelScaleArcsec ?? (currentQuery.fov * 60) / n;
  const geo = { ra: currentQuery.ra, dec: currentQuery.dec, n, scaleArcsec };
  const midYear = mjdToYear((currentFrames[0].mjd + currentFrames.at(-1).mjd) / 2);
  const found = targetsInField(currentQuery.ra, currentQuery.dec, currentQuery.fov, midYear);

  player.setTracks(found.map((t) => ({
    label: t.label,
    points: currentFrames.map((f) => {
      const p = positionAtEpoch(t, mjdToYear(f.mjd));
      return skyToCanvas(p.ra, p.dec, geo);
    }),
  })));
  box.disabled = found.length === 0;

  info.textContent = found.map((t) => {
    const pm = totalProperMotion(t);
    const years = (currentFrames.at(-1).mjd - currentFrames[0].mjd) / 365.25;
    const spanPx = (pm * years) / scaleArcsec;
    let line = `${t.label}: catalogue motion ${pm.toFixed(2)}″/yr = ${(pm / scaleArcsec).toFixed(2)} px/yr ` +
      `→ ${spanPx.toFixed(1)} px between the first and last ${currentDetector} frame (${years.toFixed(1)} yr).`;
    if (spanPx < 0.3) line += " Practically still – look for brightness changes instead.";
    else if (spanPx < 2) line += " Less than 2 pixels: use Difference and step with ← → to see it.";
    return line;
  }).join(" ");
}

/** Show only the frames of one detector in the player. */
async function showDetector(detector) {
  const token = loadToken;
  const current = () => token === loadToken && frames === currentFrames;
  currentDetector = detector;
  const { frames, skipped } = framesFor(detector);
  currentFrames = frames;
  observations.replaceChildren(...frames.map((f, i) =>
    new Option(`${fmtDate(f.dateISO)} · ${f.detector} · ${f.wavelengthMinUm.toFixed(2)}–${f.wavelengthMaxUm.toFixed(2)} µm`, i)));
  player.setTracks([]);                  // old track has the wrong number of points
  clearMovers();                         // so do the movers found in the old frames
  discoverPanel?.clear();                // and the sources listed by "Find everything"
  compareState = null;                   // and the A / B choices of the Compare mode
  player.pause();
  setPlayerEnabled(false);
  timeline.setFrames([]);                // the old images are gone: hide the timeline until the new ones are in
  markOverview(detector);
  setStatus(skipped ? `${skipped} ${detector} frame(s) hidden because more than 1 % of their pixels are flagged.` : "");

  if (currentFrames.length === 0) {
    showOverlay("No frames for this combination",
      skipped ? `All ${detector} images here are flagged – untick “Skip frames…”.` : `There are no ${detector} images at this position.`);
    return;
  }
  const n = currentFrames.length;
  // Preload all images; the bar shows how many are ready.
  solarSystem?.refresh();                                  // the dates of the survey passes and the direction of the field
  await player.setFrames(currentFrames, (done) => {
    if (current()) showOverlay("Preparing frames…", `${done} / ${n} ${detector} images ready`, { progress: done / n });
  }, current);
  if (!current()) return;

  setupCompare();
  colourPass.replaceChildren();
  timeline.setFrames(currentFrames);     // the timeline of the images now in the player
  frameSlider.max = String(currentFrames.length - 1);
  player.setField({ ra: currentQuery.ra, dec: currentQuery.dec,                                              // for the scale bar and the grid
    scaleArcsec: currentFrames[0].pixelScaleArcsec ?? (currentQuery.fov * 60) / player.naturalSize });
  hideOverlay();
  setPlayerEnabled(true);
  updateTracks();
  updateCatalogue();                     // SIMBAD objects at these images' dates, if the box is ticked
  updateAsteroids();                     // known asteroids at these images' dates, if the box is ticked
  // Re-apply the mode: it may need ≥ 2 frames, and the info line depends on it.
  setMode(player.mode, { updateUrl: false });
  $("movers-all-det").closest("label").hidden = !hasSeveralDetectors();       // nothing to choose with one detector
  $("movers-status").textContent = moversHint();
  $("find-movers-btn").disabled = !canFindMovers();
  $("find-distant-btn").disabled = !canFindMovers();
  discoverPanel?.refresh();

  if (currentFrames.length === 1) {
    setStatus(`Only one ${detector} image here – nothing to blink. Try another detector.`);
    return;
  }
  if (player.isAnimated && !prefersReducedMotion) player.play();
  else if (prefersReducedMotion) setStatus("Auto-play is off because your system asks for reduced motion – press Play or use ← →.");
}

// ---------------------------------------------------------------
// Detector overview ("All"): one averaged thumbnail per detector
// ---------------------------------------------------------------
async function renderOverview(frames, token) {
  const box = $("overview"), grid = $("overview-grid");
  grid.innerHTML = "";
  if (!frames.length) { box.hidden = true; return; }
  box.hidden = false;

  // All six detectors side by side (features/spectral.js): the ones that have images here show their average; the others are shown as MISSING, with the band they would cover.
  for (const row of detectorCoverage(frames)) {
    const words = coverageText(row);
    if (row.status === "none") {
      const tile = document.createElement("div");
      tile.className = "overview-item is-missing";
      tile.dataset.det = row.id;
      tile.setAttribute("role", "group");
      tile.setAttribute("aria-label", `${row.id}: no images of this field. ${words.line2}.`);
      tile.innerHTML = `<span class="ov-blank" aria-hidden="true"></span><span class="ov-name">${row.id}</span><span class="ov-sub">${words.line1}</span><span class="ov-sub">${words.line2}</span>`;
      grid.appendChild(tile);
      continue;
    }
    const d = { detector: row.id };
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "overview-item";
    btn.dataset.det = d.detector;
    btn.setAttribute("aria-pressed", String(d.detector === currentDetector));
    btn.setAttribute("aria-label", `${row.id}, ${row.wlMin.toFixed(2)} to ${row.wlMax.toFixed(2)} micrometres, ${row.count} images, ${words.line2}. Show in the player.`);
    btn.innerHTML = `<canvas width="1" height="1" aria-hidden="true"></canvas>
      <span class="ov-name">${row.id}</span>
      <span class="ov-sub">${words.line1}</span><span class="ov-sub">${words.line2}</span>`;
    btn.addEventListener("click", () => selectDetector(d.detector));
    grid.appendChild(btn);

    // Draw the average image (async; a failure just leaves the thumbnail black).
    const images = await Promise.all(frames.filter((f) => f.detector === d.detector)
      .map((f) => loadImage(f.imageUrl, f).catch(() => null)));
    if (token !== loadToken) return;
    const data = meanImageData(images.filter(Boolean));
    if (data) {
      const c = btn.querySelector("canvas");
      c.width = data.width; c.height = data.height;
      c.getContext("2d").putImageData(data, 0, 0);
    }
  }
}
function markOverview(detector) {
  document.querySelectorAll(".overview-item").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.det === detector)));
}

// ---------------------------------------------------------------
// Measure: click on the image -> spectrum + light curve
// ---------------------------------------------------------------
const measureEls = {
  pos: $("measure-pos"), charts: $("charts"), note: $("measure-note"),
  detector: $("measurement-detector"), download: $("download-measurements"),
  tableWrap: $("measure-table-wrap"), table: $("measure-table"),
  spectrum: $("spectrum-chart"), lightcurve: $("lightcurve-chart"),
  spectrumCaption: $("spectrum-caption"), lightcurveCaption: $("lightcurve-caption"),
  tools: $("measure-tools"), missing: $("measure-missing"),
};
// how the uncertainty of the spectrum is drawn (features/measure.js, spectral.js): error bars, or a band that breaks where no image covers a wavelength
document.querySelectorAll('input[name="measure-style"]').forEach((r) => r.addEventListener("change", () => { if (r.checked) setSpectrumStyle(r.value); }));
let measureToken = 0;

const inspectionPosition = DATA_SOURCE === "api" ? tanCanvasToSky : canvasToSky;       // the mapping the click that measures uses
// Image display (from the other Blink 2.0 line): brightness and contrast of the picture on screen and the centre crosshair. Screen only: the saved PNG and every measurement use the pixels as they are.
function adjustDisplay() {
  canvas.style.filter = `brightness(${Number($("image-brightness").value) / 100}) contrast(${Number($("image-contrast").value) / 100})`;
  $("crosshair").hidden = !$("centre-crosshair").checked;
}
for (const id of ["image-brightness", "image-contrast", "centre-crosshair"]) $(id).addEventListener("input", adjustDisplay);
$("reset-view").addEventListener("click", () => {
  $("image-brightness").value = $("image-contrast").value = "100";
  $("centre-crosshair").checked = true;
  adjustDisplay();
});
canvas.addEventListener("click", async (e) => {
  if (!player.length || !currentQuery) return;
  const { fx, fy } = player.pointToFrac(e.clientX, e.clientY);       // image fractions, whatever the zoom and pan
  if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return;
  const n = player.naturalSize;
  const scaleArcsec = currentFrames[0].pixelScaleArcsec ?? (currentQuery.fov * 60) / n;
  const sky = inspectionPosition(fx, fy, { ra: currentQuery.ra, dec: currentQuery.dec, n, scaleArcsec });

  player.setMarker({ fx, fy, rPx: APERTURE_RADIUS_PX });
  const token = ++measureToken;
  try {
    await measureAndPlot({ query: currentQuery, sky, els: measureEls, isCurrent: () => token === measureToken });
  } catch (err) {
    console.error(err);
    if (token === measureToken) measureEls.pos.textContent = `Could not measure: ${err.message}`;
  }
});

function clearMarker() {
  measureToken++;
  player.setMarker(null);
  clearMeasurement(measureEls);
}

// ---------------------------------------------------------------
// Sky context (Aladin Lite)
// ---------------------------------------------------------------
const sky = new SkyContext($("aladin-box"), $("aladin-status"), $("sky-geo-note"));
setupFullscreen($("sky-frame"), $("sky-full-btn"));   // map + its controls fill the screen
/** Open (or re-centre) the sky map on a position { ra, dec, fov }. */
async function openSkyMap(q) {
  $("aladin-btn").disabled = true;
  await sky.open(q, $("survey-select").value);
  $("aladin-btn").disabled = false;
  $("aladin-btn").textContent = "Re-centre sky map";
  $("sky-full-btn").hidden = !sky.isOpen;             // nothing to enlarge until the map is open
}
$("aladin-btn").addEventListener("click", async () => {
  const q = currentQuery || readForm();
  if (!q) { $("aladin-status").textContent = "Enter coordinates first."; return; }
  await openSkyMap(q);
});
$("survey-select").addEventListener("change", (e) => sky.setSurvey(e.target.value));

// ---------------------------------------------------------------
// Catalogue (SIMBAD): overlay on the blink image, and the "known object" check of Find movers
// (features/catalogue.js). Only with real data: the synthetic sky has no real objects to match.
// ---------------------------------------------------------------
let catalogueCache = null;         // { key, objects } for the field on screen (successful answers only)
let catalogueError = "";

const catalogueKey = () => `${currentQuery.ra.toFixed(4)},${currentQuery.dec.toFixed(4)},${currentQuery.fov}`;

/** SIMBAD objects for the field on screen, or null (synthetic data, offline, SIMBAD error). Never throws. */
async function ensureCatalogue() {
  if (dataProvenance() !== "spherex_header" || !currentQuery) return null;
  const key = catalogueKey();
  if (catalogueCache?.key === key) return catalogueCache.objects;
  try {
    const objects = await fetchCatalogue(currentQuery.ra, currentQuery.dec, currentQuery.fov);
    if (!currentQuery || key !== catalogueKey()) return null;        // another field was loaded meanwhile
    catalogueError = "";
    catalogueCache = { key, objects };
    return objects;
  } catch (err) {
    console.warn(err);
    catalogueError = err.message;
    return null;
  }
}

/** Draw (or clear) the catalogue overlay for the frames on screen. */
async function updateCatalogue() {
  const box = $("show-catalogue"), info = $("catalogue-info");
  if (!box.checked || !currentQuery || !currentFrames.length || !player.naturalSize) {
    player.setCatalogue([]);
    if (!box.checked) info.textContent = "";
    return;
  }
  const token = loadToken;
  info.textContent = "Asking SIMBAD…";
  const objects = await ensureCatalogue();
  if (token !== loadToken || !box.checked) return;
  if (!objects) {
    player.setCatalogue([]);
    info.textContent = `Could not get the SIMBAD objects${catalogueError ? ` (${catalogueError})` : ""}.`;
    return;
  }
  const n = player.naturalSize;
  const geo = { ra: currentQuery.ra, dec: currentQuery.dec, n, scaleArcsec: currentFrames[0].pixelScaleArcsec ?? (currentQuery.fov * 60) / n };
  // The test objects already have their own cream "predicted" tracks: do not draw them twice.
  const isTestObject = (o) => TARGETS.some((t) => Math.hypot((t.ra - o.ra) * Math.cos((o.dec * Math.PI) / 180), t.dec - o.dec) * 3600 < 1);
  const tracks = catalogueTracks(objects.filter((o) => !isTestObject(o)), currentFrames, geo);
  player.setCatalogue(tracks);
  const moving = tracks.filter((t) => t.moving).length;
  info.textContent = tracks.length
    ? `SIMBAD: ${tracks.length} object${tracks.length === 1 ? "" : "s"} in this field${moving ? `, ${moving} moving more than 1″/yr (with name and path)` : ""}. ` +
      "Each is moved to the date of the image with its catalogue proper motion."
    : "SIMBAD lists no other object in this field (faint infrared stars are often missing from it).";
}
$("show-catalogue").addEventListener("change", updateCatalogue);

// ---------------------------------------------------------------
// Known asteroids (SkyBoT): a body crosses a 5′ field in about half a day, so it is a different dot in every
// image. They are looked up at the exact date of each image (features/skybot.js). Real data only.
// ---------------------------------------------------------------
const skybotCache = new Map();             // answers by field and date (successful ones only)
let asteroidState = null;                  // { key, perFrame, failures, firstError } for the frames on screen
let asteroidError = "";
const asteroidKey = () => `${catalogueKey()}|${currentDetector}|${currentFrames.length}`;

/** SkyBoT answers for the images on screen, or null (synthetic data, offline, blocked). Never throws. */
async function ensureAsteroids(onProgress = () => {}) {
  if (dataProvenance() !== "spherex_header" || !currentQuery || !currentFrames.length) return null;
  const key = asteroidKey();
  if (asteroidState?.key === key) return asteroidState;
  const token = loadToken;
  try {
    const res = await fetchSkybotForFrames(currentFrames,
      { ra: currentQuery.ra, dec: currentQuery.dec, fovArcmin: currentQuery.fov },
      { cache: skybotCache, onProgress, shouldStop: () => token !== loadToken });
    if (token !== loadToken || !currentQuery || key !== asteroidKey()) return null;        // another field was loaded meanwhile
    asteroidError = "";
    asteroidState = { key, ...res };
    return asteroidState;
  } catch (err) {
    console.warn(err);
    asteroidError = err.message;
    return null;
  }
}

/** Draw (or clear) the asteroid overlay for the images on screen. */
async function updateAsteroids() {
  const box = $("show-asteroids"), info = $("asteroid-info");
  if (!box.checked || !currentQuery || !currentFrames.length || !player.naturalSize) {
    player.setAsteroids([]);
    if (!box.checked) info.textContent = "";
    return;
  }
  const token = loadToken;
  info.textContent = "Asking SkyBoT for each image date…";
  const state = await ensureAsteroids((done, total) => { if (box.checked && token === loadToken) info.textContent = `Asking SkyBoT… ${done} of ${total} dates`; });
  if (token !== loadToken || !box.checked) return;
  if (!state) {
    player.setAsteroids([]);
    info.textContent = `Could not get the known asteroids${asteroidError ? ` (${asteroidError})` : ""}.`;
    return;
  }
  const points = asteroidPoints(state.perFrame, currentGeo());
  player.setAsteroids(points);
  const names = new Set(points.flatMap((list) => (list ?? []).map((a) => a.name)));
  const note = state.failures ? ` ${state.failures} date${state.failures === 1 ? "" : "s"} could not be checked.` : "";
  info.textContent = names.size
    ? `SkyBoT: ${names.size} known asteroid${names.size === 1 ? "" : "s"} or comet${names.size === 1 ? "" : "s"} cross${names.size === 1 ? "es" : ""} this field on these dates (amber diamonds). ` +
      `A body moves hundreds of arcsec per day, so it is a different dot in every image.${note}`
    : state.failures
      ? `SkyBoT lists no known asteroid or comet inside this field on the checked dates.${note}`
      : "SkyBoT lists no known asteroid or comet inside this field on any of these dates.";
}
$("show-asteroids").addEventListener("change", updateAsteroids);

// ---------------------------------------------------------------
// Find movers: which dots changed position between the dates? (features/movers.js)
// ---------------------------------------------------------------
const MOVERS_HINT = "Compares the dots in all images and lists the ones that moved.";
const MIN_PASSES = 3;                      // same rule as in movers.js: a third pass proves a line
let textAnalysis = null;                   // the text analysis (section 9), set up below; its candidate table is refreshed when the list changes
let movers = [];                           // candidates for the detector on screen, best first
let selectedMover = -1;
let assistant = null;                      // the explainer (features/assistantView.js), set up further down
let planetLab = null;                      // the Planet X Lab (features/planetLabView.js), set up further down
let moversCatalogueChecked = false;        // was SIMBAD consulted for the list on screen?
let moversRun = null;                      // how the list on screen was made (features/provenance.js): input, settings, algorithm version, time of the run

const countPasses = (frames) => (frames.length ? passIndices(frames.map((f) => f.mjd)).at(-1) + 1 : 0);

// The search uses only positions, never brightness, so the images of ALL detectors of the field can be linked together
// (different wavelengths do not matter): 3-6 times more images and passes than one detector has. On real data the
// blind test went from 0.62 to 0.52 arcsec/yr (Epsilon Indi B) and 0.80 to 0.28 (Barnard) off the catalogue.
const frameId = (f) => `${f.detector}@${f.mjd}`;

/**
 * A search that can keep the page busy for seconds runs in a worker (js/searchWorker.js), so that the page stays usable; with no worker it runs here and gives the same answer
 * (features/workerClient.js, searchTasks.js). The worker gets a copy of the data.
 */
async function searchInWorker(kind, payload, { signal = null, onStart = null } = {}) {
  const { result, inWorker } = await runTask(kind, payload, {
    makeWorker: () => new Worker(new URL("./searchWorker.js", import.meta.url), { type: "module" }),
    fallback: () => runSearchTask(kind, payload),
    signal, onStart,
  });
  $("movers").dataset.lastSearch = `${kind}:${inWorker ? "worker" : "page"}`;       // where the last search really ran (the end-to-end test reads it: a worker that failed to load must not pass as one that ran)
  return result;
}

// Cancel and elapsed time for the long searches. The Cancel button is shown only while a worker runs the search (a search on the page is one call that cannot be stopped; the status line says so).
let searchAbort = null, searchTicker = null;
function beginSearch(text) {
  searchAbort = new AbortController();
  const status = $("movers-status"), t0 = performance.now();
  status.textContent = text;
  clearInterval(searchTicker);
  searchTicker = setInterval(() => { const s = Math.round((performance.now() - t0) / 1000); if (s >= 2) status.textContent = `${text} (${s} s)`; }, 1000);
  return { signal: searchAbort.signal, onStart: ({ cancellable }) => { $("cancel-search-btn").hidden = !cancellable; if (!cancellable) status.textContent = `${text} This runs on the page itself and cannot be cancelled.`; } };
}
function endSearch() { clearInterval(searchTicker); searchTicker = null; searchAbort = null; $("cancel-search-btn").hidden = true; }
$("cancel-search-btn").addEventListener("click", () => { searchAbort?.abort(); });

/** The date of every dot of every candidate (for the Planet X Lab's comparison of motions): a dot says which image of the search it is in, a candidate of several detectors says which image by its frameIds. */
function attachDotDates(candidates, frames) {
  const mjdById = new Map(frames.map((f) => [frameId(f), f.mjd]));
  for (const c of candidates) c.dotDates = (c.points ?? []).map((p) => (c.frameIds ? mjdById.get(c.frameIds[p.frame]) : frames[p.frame]?.mjd) ?? null);
}
const hasSeveralDetectors = () => new Set(allFrames.map((f) => f.detector)).size > 1;
const useAllDetectors = () => $("movers-all-det").checked && hasSeveralDetectors();
const searchFrames = () => (useAllDetectors() ? allFrames : player.frames);
const canFindMovers = () => { const fr = searchFrames(); return player.length >= 1 && fr.length >= 3 && countPasses(fr) >= MIN_PASSES; };

/** What the status line says before a search: the hint, or why the search is not possible. */
function moversHint() {
  const fr = searchFrames(), n = fr.length, det = useAllDetectors() ? "all detectors together" : `detector ${currentDetector}`;
  if (n < 3) return `Needs at least 3 images (${det} has ${n}).`;
  const passes = countPasses(fr);
  if (passes < MIN_PASSES) {
    return `Needs images from at least ${MIN_PASSES} survey passes, about 6 months apart (${det} has ${passes}).${useAllDetectors() ? "" : " Try another detector, or all detectors together."}`;
  }
  return MOVERS_HINT;
}
$("movers-all-det").addEventListener("change", () => {
  clearMovers();
  discoverPanel?.clear();
  $("movers-status").textContent = moversHint();
  $("find-movers-btn").disabled = !player.length || !canFindMovers();
  $("find-distant-btn").disabled = !player.length || !canFindMovers();
  discoverPanel?.refresh();
});

function clearMovers() {
  movers = [];
  moversRun = null;
  $("movers-provenance").hidden = true;
  selectedMover = -1;
  player.setCandidates([]);
  $("mover-list").hidden = true;
  $("mover-list").replaceChildren();
  $("mover-export").hidden = true;
  $("mover-detail").hidden = true;
  $("movers-status").textContent = MOVERS_HINT;
  planetLab?.refresh();
}

/** Grey values (0..255) of one image from its PNG URL (for images the player does not hold), or null if the browser refuses. */
async function greyOfImage(url, n) {
  try {
    const img = await new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = url; });
    const c = document.createElement("canvas");
    c.width = c.height = n;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, n, n);
    const d = ctx.getImageData(0, 0, n, n).data;
    const g = new Uint8ClampedArray(n * n);
    for (let i = 0; i < g.length; i++) g[i] = d[4 * i];
    return g;
  } catch { return null; }
}

/**
 * The pixels the detector works on, for the given frames (the player's or, with "all detectors", every frame of the field).
 * Real data: the backend also serves every cutout as float32 (`dataUrl`), with no 8-bit clipping and finer positions.
 * Otherwise the 8-bit pictures: the player's own, and the other detectors' decoded from their image URLs.
 */
async function detectionPixels(frames = player.frames) {
  const n = player.naturalSize;
  if (frames.length && frames.every((f) => f.dataUrl)) {
    try {
      const arrays = await Promise.all(frames.map(async (f) => {
        const response = await fetch(f.dataUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const values = new Float32Array(await response.arrayBuffer());
        if (values.length !== n * n) throw new Error("unexpected size");
        return values;
      }));
      // Bad-pixel masks (a saturated star's flagged core): optional, a missing one just means the plain centroid is used.
      const masks = await Promise.all(frames.map(async (f) => {
        if (!f.maskUrl) return null;
        try {
          const response = await fetch(f.maskUrl);
          const bytes = response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
          return bytes && bytes.length === n * n ? bytes : null;
        } catch { return null; }
      }));
      return { arrays, masks, isFloat: true };
    } catch (err) {
      console.warn("Float pixels unavailable, using the 8-bit pictures:", err);
    }
  }
  const own = player.greyFrames();
  const arrays = await Promise.all(frames.map(async (f) => {
    const i = player.frames.indexOf(f);
    return i >= 0 && own ? own[i] : greyOfImage(f.imageUrl, n);
  }));
  return { arrays: arrays.every(Boolean) ? arrays : null, masks: null, isFloat: false };
}

/**
 * Measure every candidate at its predicted position in EVERY image of its own set, also where no dot was found
 * (features/movers.js trackSupport). A real mover is there nearly everywhere; a chance line only where it caught its dots.
 */
function addSupport(candidates, frames, arrays, n, detectOptions = {}) {
  const dotsCache = new Map();                                      // the dots of each image, found once
  const dotsOf = (fi) => { if (!dotsCache.has(fi)) dotsCache.set(fi, detectSources(arrays[fi], n, detectOptions)); return dotsCache.get(fi); };
  for (const c of candidates) {
    const idx = c.frameIds ? c.frameIds.map((id) => frames.findIndex((f) => frameId(f) === id)) : frames.map((_, k) => k);
    const positions = idx.map((fi, j) => {
      const p = moverPositionAtMjd(c, frames[fi].mjd), s = c.shifts?.[j];
      return { x: p.x + (s?.dx ?? 0), y: p.y + (s?.dy ?? 0) };
    });
    c.support = trackSupport(idx.map((fi) => arrays[fi]), n, positions);
    // another source in or next to the measuring circle: its light goes into the spectrum along the path
    c.blend = blendWarning(positions, idx.map(dotsOf));
  }
}

/** What the path check says (empty if it was not run). */
function supportSentence(m) {
  const s = m.support;
  if (!s || !s.measurable) return "";
  const text = `On its path it is present in ${s.supported} of ${s.measurable} images (flux at the predicted spot, also where no dot was found)`;
  return s.fraction >= 0.8 ? ` ${text}: that is what a real object does.`
    : s.fraction >= 0.5 ? ` ${text}: only some images, so it may be faint in some wavelengths, or a chance alignment.`
      : ` ${text}: that is typical of a chance alignment of unrelated dots, so be sceptical.`;
}

/** "1 detector" / "3 detectors" for the search messages. */
const describeSearchSet = (frames) => {
  const dets = new Set(frames.map((f) => f.detector)).size;
  return `${frames.length} images${dets > 1 ? ` from ${dets} detectors` : ""}`;
};

$("find-movers-btn").addEventListener("click", async () => {
  if (!player.length || !currentQuery) return;
  const token = loadToken;
  const status = $("movers-status");
  const frames = searchFrames();
  const startedAt = performance.now();
  $("find-movers-btn").disabled = true;
  clearMovers();
  status.textContent = `Searching… comparing the dots in ${describeSearchSet(frames)}.`;
  await new Promise((resolve) => setTimeout(resolve, 30));      // let the browser show that message first
  if (token !== loadToken) return;                               // new data arrived meanwhile
  try {
    const { arrays, masks, isFloat } = await detectionPixels(frames);
    if (!arrays) {
      status.textContent = "Cannot read the image pixels in this browser (images from another site), so the search cannot run.";
      return;
    }
    if (token !== loadToken) return;
    // every detector together AND each alone, merged (a candidate knows which image each entry of its shifts belongs to)
    const run = beginSearch(`Searching… ${describeEstimate(estimateSearch(frames.length, player.naturalSize))}`);
    const result = await searchInWorker("movers", { frames: frames.map((f, i) => ({ mjd: f.mjd, detector: f.detector, id: frameId(f), grey: arrays[i], mask: masks?.[i] ?? null })),
      n: player.naturalSize, options: isFloat ? { sigmaFloor: 1e-9 } : {} }, run);
    endSearch();
    if (token !== loadToken) return;
    addSupport(result.candidates, frames, arrays, player.naturalSize, { ...(isFloat ? { sigmaFloor: 1e-9 } : {}) });
    attachDotDates(result.candidates, frames);
    // Known objects: the test list always, and real SIMBAD objects too when we have real data.
    if (DATA_SOURCE === "api") status.textContent = "Checking SIMBAD and SkyBoT for known objects…";
    const [objects] = await Promise.all([ensureCatalogue(), ensureAsteroids()]);        // each answers null if it cannot: never blocks
    if (token !== loadToken) return;
    showMovers(result, objects);
    // the options the search ran with: the defaults of movers.js, with the noise floor of real (float) pixels when it was used
    moversRun = recordRun("find-movers", MOVERS_VERSION, frames, { ...MOVER_DEFAULTS, ...ERROR_MODEL, ...(isFloat ? { sigmaFloor: 1e-9 } : {}), allDetectors: useAllDetectors() }, startedAt, isFloat);
  } catch (err) {
    endSearch();
    if (isCancelled(err)) { status.textContent = "The search was cancelled. No candidate was kept (the list was cleared when the search started); the images are unchanged."; return; }
    console.error(err);
    status.textContent = `The search failed: ${err.message}`;
  } finally {
    endSearch();
    $("find-movers-btn").disabled = !canFindMovers();
    $("find-distant-btn").disabled = !canFindMovers();
  }
});

/** The record of a search that has just finished (features/provenance.js): its input, its settings, the algorithm version, the time it finished and how long it took. */
function recordRun(analysis, version, frames, settings, startedAt, isFloat) {
  const record = buildProvenance({
    analysis, algorithm: { version }, frames, settings, ranAt: new Date(), durationMs: performance.now() - startedAt,
    ctx: { ...exportContext(), detector: useAllDetectors() ? "all" : currentDetector },
    pixels: isFloat ? "float32 pixels in the file's own unit (backend)" : "8-bit pictures (no float pixels: synthetic data)",
  });
  $("movers-provenance-text").textContent = provenanceText(record);          // the same sentence as in the files, for the page
  $("movers-provenance").hidden = false;
  return record;
}

/** The cutout the pixels belong to: centre, size and pixel scale. */
const currentGeo = () => {
  const n = player.naturalSize;
  return { ra: currentQuery.ra, dec: currentQuery.dec, n, scaleArcsec: currentFrames[0].pixelScaleArcsec ?? (currentQuery.fov * 60) / n };
};

// Planet X mode: a body of the outer Solar System swings with the Earth's parallax, so its path is a loop-like
// curve that "Find movers" (straight lines) cannot link. This tries every distance at once (features/parallax.js).
$("find-distant-btn").addEventListener("click", async () => {
  if (!player.length || !currentQuery) return;
  const token = loadToken;
  const status = $("movers-status");
  const frames = searchFrames();
  const startedAt = performance.now();
  $("find-movers-btn").disabled = true;
  $("find-distant-btn").disabled = true;
  clearMovers();
  status.textContent = `Searching for a distant body… testing which dots follow Earth's parallax in ${describeSearchSet(frames)}.`;
  await new Promise((resolve) => setTimeout(resolve, 30));
  if (token !== loadToken) return;
  try {
    const { arrays, masks, isFloat } = await detectionPixels(frames);
    if (!arrays) {
      status.textContent = "Cannot read the image pixels in this browser (images from another site), so the search cannot run.";
      return;
    }
    if (token !== loadToken) return;
    const n = player.naturalSize;
    const detected = frames.map((f, i) => ({ mjd: f.mjd, sources: detectSources(arrays[i], n, { ...(isFloat ? { sigmaFloor: 1e-9 } : {}), mask: masks?.[i] ?? null }) }));
    await ensureAsteroids();                                                              // (a swinging body could also be a known one)
    if (token !== loadToken) return;
    const run = beginSearch(`Searching for a distant body… ${describeEstimate(estimateSearch(frames.length, n))}`);
    const result = await searchInWorker("distant", { detected, geo: currentGeo() }, run);
    endSearch();
    if (token !== loadToken) return;
    const ids = frames.map(frameId);
    for (const c of result.candidates) c.frameIds = ids;
    attachDotDates(result.candidates, frames);
    addSupport(result.candidates, frames, arrays, n, isFloat ? { sigmaFloor: 1e-9 } : {});
    showMovers(result, null, { distant: true });
    moversRun = recordRun("find-distant", PARALLAX_VERSION, frames, { ...DISTANT_DEFAULTS, ...MOVER_DEFAULTS, ...(isFloat ? { sigmaFloor: 1e-9 } : {}), allDetectors: useAllDetectors() }, startedAt, isFloat);
  } catch (err) {
    endSearch();
    if (isCancelled(err)) { status.textContent = "The search was cancelled. No candidate was kept (the list was cleared when the search started); the images are unchanged."; return; }
    console.error(err);
    status.textContent = `The search failed: ${err.message}`;
  } finally {
    endSearch();
    $("find-movers-btn").disabled = !canFindMovers();
    $("find-distant-btn").disabled = !canFindMovers();
  }
});

function showMovers({ candidates, stats, reason }, catalogueObjects = null, { distant = false } = {}) {
  moversCatalogueChecked = Boolean(catalogueObjects);
  const status = $("movers-status"), list = $("mover-list");
  if (reason) { status.textContent = `Cannot search: ${reason}.`; return; }

  const n = player.naturalSize;
  const geo = currentGeo();
  const pool = catalogueObjects ? [...TARGETS, ...catalogueObjects] : TARGETS;     // test objects first: their motions are the best
  movers = candidates.map((c, k) => ({
    ...c, ...describeMover(c, geo),
    fitPoints: c.points,
    dots: c.points,                                   // the raw dots of the fit, before `points` below becomes the places on the images (the Planet X Lab compares motions on them)
    dotDates: c.dotDates ?? null,                     // the date of each dot (attachDotDates)
    label: `#${k + 1}`,
    known: distant ? null : matchKnownObject(c, geo, pool)?.target.label ?? null,
    distant: distant ? describeDistant(c, geo) : null,
    // where it is on each frame's date, as image fractions (what the player draws)
    // (the search works on image-registered positions: add each image's own shift back to hit its pixel)
    points: player.frames.map((f, k) => {
      const p = moverPositionAtMjd(c, f.mjd), s = c.shifts?.[c.frameIds ? c.frameIds.indexOf(frameId(f)) : k];
      return { fx: (p.x + (s?.dx ?? 0)) / n, fy: (p.y + (s?.dy ?? 0)) / n };
    }),
  }));
  // Known asteroids (SkyBoT) on the image dates, when they were asked for: is a candidate sitting on one?
  if (asteroidState?.key === asteroidKey()) {
    const pts = asteroidPoints(asteroidState.perFrame, geo);
    for (const m of movers) {
      m.asteroids = matchAsteroids(m.points, pts, geo);
      m.asteroidUncheckedDates = asteroidState.failures;
    }
  }

  const dots = Math.round(stats.dotsPerFrame.reduce((a, b) => a + b, 0) / stats.frames);
  const summary = distant
    ? `Compared ${stats.frames} images (about ${dots} dots each; ${Math.round(stats.movingDots / stats.frames)} per image are not fixed stars).`
    : `Compared ${stats.frames} images (about ${dots} dots each; ${stats.stillDots} stayed put).`;
  const other = detSelect.options.length > 1 ? " Try another detector: a dot can be too faint in one wavelength band." : "";
  if (!movers.length) {
    status.textContent = distant
      ? `No distant body found. ${summary} A body 500 AU away swings about 800″ (130 pixels) between survey passes, so the field must be wide (30′), and the search only accepts bodies bound to the Sun.${other}`
      : `No movers found. ${summary} Nothing shifted by more than about 1 pixel (${geo.scaleArcsec.toFixed(0)}″).${other}`;
    return;
  }
  status.textContent = `${movers.length} candidate${movers.length === 1 ? "" : "s"} found, best first. ${summary} Click one to see its path.`;

  list.replaceChildren(...movers.map((m, k) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mover-item";
    btn.setAttribute("aria-pressed", "false");
    btn.dataset.index = String(k);
    const rank = Object.assign(document.createElement("span"), { className: "mover-rank", textContent: m.label });
    const main = Object.assign(document.createElement("span"), { className: "mover-main",
      textContent: m.distant
        ? `about ${Math.round(m.distanceAU)} AU away (${m.distant.rangeText}) · own drift ${m.speedArcsecPerYear.toFixed(0)}″/yr toward ${m.compass}`
        : `${m.speedArcsecPerYear.toFixed(1)}″/yr toward ${m.compass}${m.known ? ` · ${m.known} (known)` : ""}` });
    const sub = Object.assign(document.createElement("span"), { className: "mover-sub",
      textContent: `RA ${formatRA(m.ra)}  Dec ${formatDec(m.dec)} · seen in ${m.nDet} of ${m.nFrames} images · ${m.significance > 100 ? ">100" : Math.round(m.significance)}σ` +
        (Number.isFinite(m.falseAlarm) ? ` · chance: ${chanceText(m.falseAlarm)}` : "") +
        (m.support?.measurable ? ` · on its path in ${m.support.supported}/${m.support.measurable}` : "") +
        (m.foundIn && hasSeveralDetectors() ? ` · found with ${m.foundIn === "all detectors" ? "all detectors together" : m.foundIn + " alone"}` : "") });
    btn.append(rank, main, sub);
    btn.addEventListener("click", () => selectMover(selectedMover === k ? -1 : k));
    li.append(btn);
    return li;
  }));
  list.hidden = false;
  $("mover-export").hidden = false;
  player.setCandidates(movers, -1);
  textAnalysis?.refreshCandidates();
}

// Save the candidates as CSV / JSON. Every file says what the data is and links back to this view.
function downloadText(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportContext() {
  const link = new URL(location.href);
  link.searchParams.set("data", DATA_SOURCE);                // a link must not carry the address of a backend on this computer
  link.searchParams.delete("api");
  link.hash = "";
  return { isReal: DATA_SOURCE === "api", dataSource: dataProvenance(), detector: currentDetector, query: currentQuery, permalink: link.href };
}

function dataProvenance() {
  if (DATA_SOURCE !== "api") return false;
  const sources = new Set(allFrames.map(f => f.provenance ?? "unverified"));
  return sources.size === 1 ? [...sources][0] : "mixed";
}

function updateSourceLabels() {
  const source = dataProvenance();
  const label = source === false ? "Synthetic demo data" : source === "synthetic"
    ? "Synthetic FITS test data" : source === "spherex_header"
      ? "SPHEREx-format FITS" : "FITS provenance unverified";
  badge.textContent = label;
  badge.title = source === "spherex_header" ? "SPHEREx product headers present; confirm input archive provenance" : label;
  badge.classList.toggle("real", source === "spherex_header");
  $("embed-note").textContent = `SPHEREx Blink · ${label}`;
  for (const id of ["show-catalogue", "show-asteroids"]) {
    const box = $(id);
    box.disabled = source !== "spherex_header";
    if (box.disabled && box.checked) { box.checked = false; box.dispatchEvent(new Event("change")); }
  }
}
$("export-csv-btn").addEventListener("click", () => {
  if (!movers.length || !currentQuery) return;
  const ctx = { ...exportContext(), provenance: moversRun };
  downloadText("﻿" + candidatesToCsv(movers, ctx), exportFileName(ctx, "csv"), "text/csv;charset=utf-8");   // BOM: Excel reads UTF-8
});
$("export-json-btn").addEventListener("click", () => {
  if (!movers.length || !currentQuery) return;
  const ctx = { ...exportContext(), provenance: moversRun };
  downloadText(candidatesToJson(movers, ctx), exportFileName(ctx, "json"), "application/json");
});

/** Highlight one candidate on the image (ring + path) and describe it; -1 = none. */
function selectMover(k) {
  player.stopFollow();                              // the view followed the one selected before
  selectedMover = k;
  planetLab?.refresh();                             // the lab compares the motions of the one selected
  assistant?.refresh();
  document.querySelectorAll("#mover-list .mover-item").forEach((b) =>
    b.setAttribute("aria-pressed", String(Number(b.dataset.index) === k)));
  player.setCandidates(movers, k);
  const detail = $("mover-detail");
  detail.hidden = k < 0;
  $("mover-colour").hidden = true;                  // belongs to the candidate that was selected before
  if (k < 0) return;
  const m = movers[k];
  $("mover-spectrum-btn").hidden = Boolean(m.distant);          // the measurement follows a straight path: not for a swinging body
  if (m.distant) {
    $("mover-detail-text").textContent =
      `${m.label}: ${m.distant.text} Its apparent path (drawn on the image) is the Earth's parallax swing plus that drift; ` +
      `${m.parallaxSigma > 100 ? "over 100" : m.parallaxSigma.toFixed(0)}σ better than any straight line, seen in ${m.nDet} of ${m.nFrames} images. ` +
      `Middle of the observations: RA ${formatRA(m.ra)}, Dec ${formatDec(m.dec)}. ` +
      (DATA_SOURCE === "api" ? "" : "This is the simulated body of the demo (synthetic data), not a discovery. ") +
      (asteroidSentence(m) ? asteroidSentence(m).trimStart() + " " : "") +
      (supportSentence(m) ? supportSentence(m).trimStart() + " " : "") +
      parallaxCaution(m) +
      "Approximations: the Earth's position comes from a simple formula, the body's own motion is taken as a straight line, and it is assumed to be bound to the Sun.";
    return;
  }
  $("mover-detail-text").textContent =
    `${m.label}: ${m.speedArcsecPerYear.toFixed(1)}″/yr (${m.speedPx.toFixed(2)} px/yr) toward ${m.compass}, ` +
    `position angle ${m.positionAngleDeg.toFixed(0)}°. Middle of the observations: RA ${formatRA(m.ra)}, Dec ${formatDec(m.dec)}. ` +
    (m.known ? `This is ${m.known}, a known object: the search found it on its own. `
      : moversCatalogueChecked
        ? "No SIMBAD object or test object sits within 18″ of it (catalogue positions moved to this date). It may be an asteroid, a faint star SIMBAD lacks, or something new: check the sky map and the other detectors. "
        : "Not one of the five test objects (SIMBAD was not consulted: synthetic data, or it did not answer). Catalogues list year-2000 positions, so a fast mover can sit a little away from where it is catalogued. ") +
    (m.known ? "" : classifyApparentMotion(m.speedArcsecPerYear) + asteroidSentence(m)) + supportSentence(m);
}

/**
 * A swinging-body candidate has 5 free parameters (position, drift east/north, distance) and 2 numbers per dot, so with 4 or 5
 * dots only 3 to 5 degrees of freedom are left to test the model. On real SPHEREx cutouts of Makemake the search returned only
 * chance combinations of dots (docs/VALIDATION.md), and the sigma figure was in the thousands for them: say so.
 */
function parallaxCaution(m) {
  if (!(m.nDet <= 5)) return "";
  const dof = 2 * m.nDet - 5;
  return `Caution: only ${m.nDet} dots fix 5 parameters (${dof} degrees of freedom left), so a chance alignment of dots can fit as well and the σ figure does not say how likely it is real. ` +
    "Look for the same path in the other detectors and in more images before believing it. ";
}

/** The expected number of chance lines like this one in the field, in words a reader can use. */
function chanceText(expected) {
  if (expected < 1e-6) return "far below 1 in a million";
  if (expected < 0.01) return `about 1 in ${Math.round(1 / expected).toLocaleString("en-US")}`;
  return `${expected.toFixed(2)} expected`;
}

/** What the SkyBoT check says about a candidate (empty when it was not run). */
function asteroidSentence(m) {
  if (!m.asteroids) return "";
  if (!m.asteroids.length) return m.asteroidUncheckedDates
    ? ` SkyBoT: no known asteroid or comet within 20″ of it on the checked dates; ${m.asteroidUncheckedDates} date${m.asteroidUncheckedDates === 1 ? "" : "s"} could not be checked. This does not make it new.`
    : " SkyBoT: no known asteroid or comet within 20″ of it on any date (it lists known bodies only: that does not make this one new).";
  const a = m.asteroids[0];
  return ` SkyBoT: ${a.name}${a.vmag !== null ? ` (V ${a.vmag})` : ""}, a known ${a.cls ? a.cls : "Solar System body"}, lies within 20″ of it on ${a.hits} of ${m.nFrames} dates (closest ${a.nearestArcsec.toFixed(0)}″): ` +
    (a.hits >= 2 ? "very likely this object." : "a single date can be chance: look at the other dates.");
}

// The simulated Planet X: a field that contains the body of js/data/mockSource.js (synthetic data only).
$("planetx-block").hidden = DATA_SOURCE === "api";
$("planetx-demo-btn").addEventListener("click", () => {
  raInput.value = PLANET_X_DEMO.ra.toFixed(5);
  decInput.value = PLANET_X_DEMO.dec.toFixed(5);
  fovInput.value = "30";
  $("fov-value").textContent = "30";
  updatePreview("ra");
  updatePreview("dec");
  document.querySelectorAll("#quick-pick-list .chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
  requestedDetector = "D5";                           // the simulated body is bright at long wavelengths
  form.requestSubmit();
});

/** Bring the picture to a candidate: zoom in on it, centred, and make sure the picture is on screen (the button may be far below it). */
function centrePictureOn(candidateIndex) {
  if (!player.centreOnCandidate(candidateIndex)) return false;
  $("stage").scrollIntoView({ block: "nearest", behavior: prefersReducedMotion ? "auto" : "smooth" });
  return true;
}
$("mover-centre-btn").addEventListener("click", () => {
  if (!centrePictureOn(selectedMover)) $("mover-detail-text").textContent += " (It has no position on these images to centre on.)";
});

// The co-moving view: the candidate stays in the middle of the picture while the images change (player.setFollow). Moving the picture by hand, or Fit, stops it.
$("mover-follow-btn").addEventListener("click", () => {
  if (player.following !== null) { player.stopFollow(); return; }
  if (!player.setFollow(selectedMover)) $("mover-detail-text").textContent += " (It has no position on these images to follow.)";
});
player.onFollowChange = (i) => {
  const b = $("mover-follow-btn");
  b.setAttribute("aria-pressed", String(i !== null));
  b.textContent = i !== null ? "Stop following" : "Follow it";
};

$("mover-map-btn").addEventListener("click", async () => {
  const m = movers[selectedMover];
  if (!m || !currentQuery) return;
  await openSkyMap({ ra: m.ra, dec: m.dec, fov: currentQuery.fov });
  $("sky-frame").scrollIntoView({ block: "center", behavior: prefersReducedMotion ? "auto" : "smooth" });
});

// "Spectrum along its path": measure the candidate where it is on every image's date, plot it,
// and say in words what its colour suggests (features/spectrum.js).
$("mover-spectrum-btn").addEventListener("click", async () => {
  const m = movers[selectedMover];
  if (!m || !currentQuery) return;
  const btn = $("mover-spectrum-btn"), colour = $("mover-colour");
  btn.disabled = true;
  colour.hidden = false;
  colour.textContent = "Measuring the candidate in every image…";
  player.setMarker(null);
  const token = ++measureToken;
  try {
    const points = await measureAndPlot({
      query: currentQuery, els: measureEls, isCurrent: () => token === measureToken,
      sky: { ra: m.ra, dec: m.dec, eastArcsec: 0, northArcsec: 0 },
      motion: { epochMjd: m.mjdRef, pmEast: m.pmEastArcsecPerYear, pmNorth: m.pmNorthArcsecPerYear },
      title: m.label,
    });
    if (token !== measureToken) return;
    const blend = m.blend && m.blend.blended >= Math.max(2, Math.ceil(0.3 * m.blend.distances.length))
      ? ` Warning: another source lies within ${(m.blend.nearestPx * currentGeo().scaleArcsec).toFixed(0)}″ of its path in ${m.blend.blended} of ${m.blend.distances.length} images, so these measurements include its light (the colour above may be that neighbour's, not the candidate's).`
      : "";
    colour.textContent = colourHint(points ?? []).text + blend +
      (DATA_SOURCE === "api" ? "" : " (Synthetic demo data: this colour comes from the simulation, not from the sky.)");
    $("measure-title").scrollIntoView({ block: "start", behavior: prefersReducedMotion ? "auto" : "smooth" });
  } catch (err) {
    console.error(err);
    if (token === measureToken) colour.textContent = `Could not measure the candidate: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

// Colour theme (features/theme.js): the choice is kept in this browser; ?theme=light overrides it for one visit

// ---------------------------------------------------------------
// Find everything: every source in the images, checked against the catalogues (features/discoverPanel.js)
// ---------------------------------------------------------------
discoverPanel = setupDiscoverPanel({
  $, player, isReal: DATA_SOURCE === "api", apiBase: DATA_SOURCE === "api" ? API_BASE : "", skybotCache, prefersReducedMotion,
  getField: () => {
    if (!player.length || !currentQuery || !currentFrames.length) return null;
    return { token: loadToken, query: currentQuery, geo: currentGeo(), detector: useAllDetectors() ? "all" : currentDetector, frames: searchFrames(), n: player.naturalSize, playerFrames: player.frames };
  },
  isCurrent: (token) => token === loadToken,
  loadPixels: detectionPixels, frameId,
  plotSpectrum: async (c) => {
    player.setMarker(null);
    const token = ++measureToken;
    try {
      await measureAndPlot({ query: currentQuery, els: measureEls, isCurrent: () => token === measureToken, sky: { ra: c.ra, dec: c.dec, eastArcsec: 0, northArcsec: 0 },
        motion: { epochMjd: c.epochMjd, pmEast: c.motionIsReal ? c.pmEast : 0, pmNorth: c.motionIsReal ? c.pmNorth : 0 }, title: c.id });
      if (token === measureToken) $("measure-title").scrollIntoView({ block: "start", behavior: prefersReducedMotion ? "auto" : "smooth" });
    } catch (err) {
      if (token === measureToken) measureEls.pos.textContent = `Could not measure: ${err.message}`;
      throw err;
    }
  },
  centre: () => centrePictureOn(0),                    // the dossier's source is the one candidate the player holds (index 0)
  openMap: async (c) => {
    await openSkyMap({ ra: c.ra, dec: c.dec, fov: currentQuery.fov });
    $("sky-frame").scrollIntoView({ block: "center", behavior: prefersReducedMotion ? "auto" : "smooth" });
  },
  download: downloadText, exportContext,
});
discoverPanel.refresh();

// ---------------------------------------------------------------
// Save / record / share
// ---------------------------------------------------------------
const fileBase = () => {
  const f = player.frames[player.index];
  const tag = player.isAnimated ? `${player.mode}_${f.dateISO.slice(0, 10)}` : player.mode;
  return `spherex-blink_${currentQuery.ra.toFixed(4)}_${currentQuery.dec.toFixed(4)}_${f.detector}_${tag}`;
};
/** The lines printed into a saved picture or video (features/provenance.js pictureCaption). */
const exportCaption = () => pictureCaption({ isReal: DATA_SOURCE === "api", query: currentQuery, frame: player.frames[player.index], mode: player.mode });
$("save-png-btn").addEventListener("click", () => { if (player.length) savePng(player, fileBase(), exportCaption()); });

$("record-btn").addEventListener("click", async () => {
  const btn = $("record-btn");
  if (!player.length || btn.classList.contains("recording")) return;
  btn.classList.add("recording");
  btn.disabled = true;
  try {
    await recordBlink(player, fileBase().replace(/_\d{4}-\d{2}-\d{2}$/, ""), {
      onTick: (s) => { btn.textContent = `Recording… ${s}s`; }, caption: exportCaption(),
    });
    setStatus("Video saved to your downloads.");
  } catch (err) {
    setStatus(`Recording failed: ${err.message}`);
  } finally {
    btn.classList.remove("recording");
    btn.textContent = "Record video";
    btn.disabled = false;
  }
});

// Native modal panels keep the viewer in place and return focus to the opener.
for (const button of document.querySelectorAll("[data-open-panel]")) {
  const panel = $(button.dataset.openPanel);
  button.addEventListener("click", () => panel.showModal());
  panel.addEventListener("click", event => {
    if (event.target !== panel) return;
    const { left, right, top, bottom } = panel.getBoundingClientRect();
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) panel.close();
  });
  panel.addEventListener("keydown", event => event.stopPropagation());
}

// Guided tour: points at the parts of the page, changes nothing, needs no data or network.
let activeTour = null;
$("tour-btn").addEventListener("click", () => {
  activeTour?.close();
  activeTour = startTour(WORKSPACE_STEPS, { onClose: () => { activeTour = null; } });
});

// Embed: the same view inside an <iframe> on another page (?embed=1 hides the banner and the info sections).
$("copy-embed-btn").addEventListener("click", async () => {
  const url = new URL(location.href);
  url.searchParams.set("embed", "1");
  url.searchParams.delete("data");               // a public page cannot reach a backend on this computer
  url.searchParams.delete("api");
  url.hash = "";
  const code = `<iframe src="${url.href}" title="SPHEREx Blink" width="100%" height="900" style="border:0" loading="lazy" allow="fullscreen"></iframe>`;
  const btn = $("copy-embed-btn");
  try {
    await navigator.clipboard.writeText(code);
    btn.textContent = "Embed code copied ✓";
    setTimeout(() => { btn.textContent = "Embed code"; }, 1800);
  } catch {
    window.prompt("Copy this HTML:", code);       // clipboard blocked: let the user copy by hand
  }
});

$("copy-link-btn").addEventListener("click", async () => {
  const ok = await copyLink();
  const btn = $("copy-link-btn");
  if (ok) { btn.textContent = "Link copied ✓"; setTimeout(() => { btn.textContent = "Copy link"; }, 1800); }
});

// ---------------------------------------------------------------
// Planet X Lab (features/planetLab.js, planetLabView.js, planetLabWorker.js): which motion fits the selected candidate, and how likely a distant body is to be found
// ---------------------------------------------------------------
planetLab = setupPlanetLab({
  els: {
    compareBtn: $("lab-compare-btn"), modelsHint: $("lab-models-hint"), modelsOut: $("lab-models-out"), form: $("lab-form"), distances: $("lab-distances"), fluxes: $("lab-fluxes"),
    trials: $("lab-trials"), runBtn: $("lab-run-btn"), cancelBtn: $("lab-cancel-btn"), inputError: $("lab-input-error"), progress: $("lab-progress"), status: $("lab-status"),
    mapWrap: $("lab-map-wrap"), map: $("lab-map"), mapNote: $("lab-map-note"), csvBtn: $("lab-csv-btn"), provenance: $("lab-provenance"),
  },
  canRun: () => canFindMovers(),
  getContext: async () => {
    if (!player.length || !currentQuery) return null;
    const frames = searchFrames();
    const { arrays, masks, isFloat } = await detectionPixels(frames);
    if (!arrays) return null;
    const dets = [...new Set(frames.map((f) => f.detector))].join(", ");
    return { arrays, masks, isFloat, mjds: frames.map((f) => f.mjd), geo: currentGeo(), dataText: `${isFloat ? "REAL SPHEREx pixels (float, MJy/sr)" : "8-bit pictures"}, detector${dets.includes(",") ? "s" : ""} ${dets}, the same flux in every image` };
  },
  getSelection: () => {
    const m = movers[selectedMover];
    if (!m || !m.dots?.length || !m.dotDates || !currentQuery) return null;
    const usable = m.dots.map((p, i) => ({ frame: i, x: p.x, y: p.y, mjd: m.dotDates[i] })).filter((p) => Number.isFinite(p.mjd));
    return { candidate: m, dots: usable.map((p, i) => ({ frame: i, x: p.x, y: p.y })), mjds: usable.map((p) => p.mjd), geo: currentGeo() };
  },
  download: downloadText,
});

// ---------------------------------------------------------------
// Sky explorer (features/skyExplorer.js, skyExplorerView.js; the backend's /api/footprints): where the image files are on the sky
// ---------------------------------------------------------------
setupSkyExplorer({
  els: { refreshBtn: $("sky-refresh-btn"), status: $("sky-status"), mapWrap: $("sky-map-wrap"), map: $("sky-map"), list: $("sky-list"), detail: $("sky-detail") },
  fetchFootprints: async () => {
    if (DATA_SOURCE !== "api") throw new Error("these images are synthetic: there are no files, so no footprints.");
    const response = await fetch(`${API_BASE}/api/footprints`);
    if (!response.ok) throw new Error(`the backend answered HTTP ${response.status}.`);
    return response.json();
  },
  // open a field: the form is filled in and sent, as if the author had typed it (so the address, the history and the checks are the usual ones)
  openField: ({ ra, dec, fov }) => {
    $("ra-input").value = ra.toFixed(4);
    $("dec-input").value = dec.toFixed(4);
    $("fov-input").value = String(fov);
    $("fov-input").dispatchEvent(new Event("input", { bubbles: true }));
    $("search-form").requestSubmit();
    $("workspace").scrollIntoView({ block: "start", behavior: prefersReducedMotion ? "auto" : "smooth" });
  },
});

// Text analysis (features/textAnalysis.js, textAnalysisView.js): the images, the dots and the candidates as tables, no picture
textAnalysis = setupTextAnalysis({
  els: { button: $("ta-build-btn"), error: $("ta-error"), status: $("ta-status"), out: $("ta-out"), prov: $("ta-prov"), provTitle: $("ta-prov-title"), frames: $("ta-frames"), filter: $("ta-frame-filter"),
    sources: $("ta-sources"), sourcesNote: $("ta-sources-note"), cands: $("ta-cands"), candsNote: $("ta-cands-note"), framesCsv: $("ta-frames-csv"), sourcesCsv: $("ta-sources-csv"), candsCsv: $("ta-cands-csv") },
  getContext: () => (currentQuery && currentFrames.length && player.length
    ? { isReal: DATA_SOURCE === "api", query: currentQuery, detector: currentDetector, frames: currentFrames, geo: currentGeo(), unit: currentFrames[0].unit ?? null, n: player.naturalSize } : null),
  getPixels: (frames) => detectionPixels(frames),
  getCandidates: () => movers,
  download: downloadText,
});

// Reproducibility bundle (features/bundle.js, bundleView.js): the field, the versions, the settings, the hash of every image, the candidates, how to replay.
// Its images are the ones the searches use (every detector with "Use all detectors"): a replay must find exactly these.
setupBundle({
  els: { button: $("bundle-btn"), error: $("bundle-error"), status: $("bundle-status"), replay: $("bundle-replay") },
  getContext: () => (currentQuery && currentFrames.length && player.length
    ? { isReal: DATA_SOURCE === "api", query: currentQuery, detector: useAllDetectors() ? "all" : currentDetector, frames: searchFrames(), geo: currentGeo(), unit: currentFrames[0].unit ?? null, n: player.naturalSize, href: location.href, mode: player.mode } : null),
  getPixels: (frames) => detectionPixels(frames),
  getCandidates: () => movers,
  getRun: () => moversRun,
  versions: { movers: MOVERS_VERSION, parallax: PARALLAX_VERSION },
  download: downloadText,
});

// Which survey images cover a place (features/surveyCoverage.js, surveyView.js; the backend's /api/survey = a live query of IRSA's table spherex.plane)
setupSurveySearch({
  els: { form: $("survey-form"), ra: $("survey-ra"), dec: $("survey-dec"), radius: $("survey-radius"), det: $("survey-det"), limit: $("survey-limit"), button: $("survey-btn"), fieldBtn: $("survey-field-btn"),
    error: $("survey-error"), status: $("survey-status"), result: $("survey-result"), summary: $("survey-summary"), plot: $("survey-plot"), table: $("survey-table"), openBtn: $("survey-open-btn") },
  hasBackend: DATA_SOURCE === "api",
  fetchSurvey: (params) => askSurvey(API_BASE, params),
  currentField: () => currentQuery,
  openField: ({ ra, dec, fov }) => {
    $("ra-input").value = ra.toFixed(4);
    $("dec-input").value = dec.toFixed(4);
    $("fov-input").value = String(fov);
    $("fov-input").dispatchEvent(new Event("input", { bubbles: true }));
    $("search-form").requestSubmit();
    $("workspace").scrollIntoView({ block: "start", behavior: prefersReducedMotion ? "auto" : "smooth" });
  },
});

// ---------------------------------------------------------------
// Solar System simulator (features/solarSystem.js, solarSystemView.js): the planets, and why a distant body seems to swing
// ---------------------------------------------------------------
const solarSystem = setupSolarSystem({
  els: {
    modes: [...document.querySelectorAll('input[name="ss-mode"]')], range: $("ss-range"), date: $("ss-date"), dateLabel: $("ss-date-label"), speed: $("ss-speed"), playBtn: $("ss-play"),
    body: $("ss-body"), distance: $("ss-distance"), swing: $("ss-swing"), map: $("ss-map"), table: $("ss-table"), modeNote: $("ss-mode-note"),
  },
  getField: () => (currentQuery && currentFrames.length ? { ra: currentQuery.ra, dec: currentQuery.dec, mjds: currentFrames.map((f) => f.mjd) } : null),
});

// ---------------------------------------------------------------
// Explainer (features/assistant.js, assistantView.js): the selected candidate in words, every sentence citing the measured values it is made of
// ---------------------------------------------------------------
assistant = setupAssistant({
  els: { buttons: [...document.querySelectorAll("#assistant [data-kind]")], status: $("assistant-status"), out: $("assistant-out"), wrap: $("assistant-evidence-wrap"), table: $("assistant-evidence"), details: $("assistant-evidence-wrap") },
  getContext: () => {
    const m = movers[selectedMover];
    if (!m || !currentQuery) return null;
    const fr = searchFrames();
    return { candidate: m, ctx: {
      scaleArcsec: currentGeo().scaleArcsec, fieldRa: currentQuery.ra, fieldDec: currentQuery.dec, fovArcmin: currentQuery.fov, images: fr.length, passes: countPasses(fr),
      runVersion: moversRun?.algorithm?.version, ranAt: moversRun?.ranAt, realData: DATA_SOURCE === "api",
      catalogues: moversCatalogueChecked ? "SIMBAD, SkyBoT" : "not consulted", models: planetLab?.comparisonFor(m.label) ?? null,
    } };
  },
});

// ---------------------------------------------------------------
// Loading data
// ---------------------------------------------------------------
/** Fetch frames for a query and show them. */
async function loadData(query) {
  const token = ++loadToken;
  setComparisonFrames([]);
  allFrames = [];
  updateSourceLabels();
  currentFrames = [];
  currentDetector = null;
  currentQuery = null;
  detSelect.disabled = true;
  lastQuery = query;
  setLoading(true);
  setStatus("");
  player.pause();
  setPlayerEnabled(false);
  clearMarker();
  player.setTracks([]);
  clearMovers();
  discoverPanel?.clear();
  $("track-info").textContent = "";
  if (!$("show-catalogue").checked) $("catalogue-info").textContent = "";
  $("overview").hidden = true;
  showOverlay("Loading images…", `RA ${formatRA(query.ra)}  Dec ${formatDec(query.dec)}  ·  ${query.fov}′ field`);

  try {
    const frames = await getCutouts({ ra: query.ra, dec: query.dec, fovArcmin: query.fov, detector: "all" });
    if (token !== loadToken) return;                   // a newer request started meanwhile – ignore this one

    allFrames = frames;
    updateSourceLabels();
    setComparisonFrames(frames);
    currentQuery = query;
    if (sky.isOpen) sky.update(query);
    if (frames.length === 0) {
      detSelect.innerHTML = '<option value="">No data</option>';
      detSelect.disabled = true;
      showOverlay("No SPHEREx images found here", "Try another position or a test object.");
      return;
    }
    const det = populateDetectors(frames);
    detSelect.value = det;
    writeUrlState({ det });
    currentDetector = det;
    renderOverview(frames, token);                     // runs in the background
    await showDetector(det);
    console.log(`Loaded ${frames.length} frames`, listDetectors(frames));
  } catch (err) {
    if (token !== loadToken) return;
    console.error(err);
    allFrames = [];
    detSelect.innerHTML = '<option value="">No data</option>';
    detSelect.disabled = true;
    showOverlay("Could not load images", err.message || "Unknown error.", { error: true });
  } finally {
    if (token === loadToken) setLoading(false);
  }
}

// ---------------------------------------------------------------
// Submit
// ---------------------------------------------------------------
form.addEventListener("submit", (event) => {
  event.preventDefault();            // a <form> would otherwise reload the page
  const query = readForm();
  if (!query) return;

  // Save the VALID query in the URL. We always store degrees (5 decimals ≈ 0.04″),
  // even if the user typed sexagesimal – one canonical format is easier to share/parse.
  writeUrlState({ ra: query.ra.toFixed(5), dec: query.dec.toFixed(5), fov: query.fov });

  loadData(query);
});

// ---------------------------------------------------------------
// Startup: restore state from the URL
// ---------------------------------------------------------------
function applyUrlState() {
  const state = readUrlState();

  // FOV: must be a number; clamp it into the slider range.
  if (state.fov !== undefined) {
    const fov = Number(state.fov);
    if (Number.isFinite(fov)) {
      fovInput.value = String(Math.min(FOV_MAX, Math.max(FOV_MIN, Math.round(fov))));
      $("fov-value").textContent = fovInput.value;
    }
  }

  if (state.det) requestedDetector = state.det;
  if (state.mode && MODES.includes(state.mode)) {
    player.setMode(state.mode);
    document.querySelector(`#mode-switch input[value="${state.mode}"]`).checked = true;
  }
  $("mode-help").innerHTML = MODE_HELP[player.mode];

  // RA/Dec: put the raw text in the inputs. If both are present, load right away.
  // If they are invalid, readForm() will show the normal error messages – no crash.
  if (state.ra !== undefined) { raInput.value = state.ra; updatePreview("ra"); }
  if (state.dec !== undefined) { decInput.value = state.dec; updatePreview("dec"); }
  if (state.ra !== undefined && state.dec !== undefined) form.requestSubmit();
}

// Show which data source is active in the header badge.
const badge = $("data-source-badge");
updateSourceLabels();

// With ?embed=1 the banner (and its badge) is hidden: keep saying what the data is.

// The SIMBAD overlay needs real data: SIMBAD's stars do not match the invented sky of the demo.
$("show-catalogue").disabled = DATA_SOURCE !== "api";
$("show-catalogue").closest("label").title = DATA_SOURCE === "api"
  ? "Catalogue objects around the field, moved to the date of each image"
  : "Only with real data: the synthetic demo sky is invented, SIMBAD's stars would not match it.";
$("show-asteroids").disabled = DATA_SOURCE !== "api";
$("show-asteroids").closest("label").title = DATA_SOURCE === "api"
  ? "Known asteroids and comets (SkyBoT, IMCCE) at the date of each image: a body moves hundreds of arcsec per day"
  : "Only with real data: the synthetic demo sky is invented, real asteroids would not match it.";

if (!canRecord()) $("record-btn").title = "Your browser cannot record canvas video.";
renderQuickPicks();
applyUrlState();
console.log("SPHEREx Blink: loaded OK");
