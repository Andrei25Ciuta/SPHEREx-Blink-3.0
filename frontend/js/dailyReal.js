import { modelComparison, observationsOf } from "./features/planetLab.js";
import { renderComparison } from "./features/planetLabView.js";
import { showShootingStars } from "./dailyCelebration.js";
import { getCutoutsApi } from "./data/apiSource.js?v=1";
import { IS_REMOTE_BACKEND } from "./config.js?v=1";

const field = { ra: 269.4462, dec: 4.769, fovArcmin: 5, detector: "D2" };
const requestId = "fr-9fe8d9f503e9ccca9f2964e5a9bba0ad";
const $ = (id) => document.getElementById(`daily-${id}`);
const image = $("real-image");
const epoch = $("real-epoch");
const marks = new Map();
let frames = [];
let index = 0;
let timer;
let loading = false;
let imageReady = false;
let submitted = false;

function stop() {
  clearInterval(timer);
  timer = undefined;
  $("real-blink").textContent = "Blink";
  $("real-blink").setAttribute("aria-pressed", "false");
}

function show(frameIndex) {
  index = frameIndex;
  epoch.value = String(index);
  imageReady = false;
  $("real-track").style.visibility = "hidden";
  image.src = frames[index].imageUrl;
  if (image.complete && image.naturalWidth > 0) showLoadedImage();
  updateMarks();
}

function updateMarks() {
  const points = [...marks].sort(([a], [b]) => a - b);
  const mark = marks.get(index);
  $("real-path").setAttribute("points", points.map(([, { x, y }]) => `${x * 100},${y * 100}`).join(" "));
  $("real-marker").setAttribute("visibility", mark ? "visible" : "hidden");
  if (mark) {
    $("real-marker").setAttribute("cx", mark.x * 100);
    $("real-marker").setAttribute("cy", mark.y * 100);
  }
  const summary = `${points.length} marked frame${points.length === 1 ? "" : "s"}.`;
  $("real-marks").textContent = summary;
  const span = points.length < 2 ? 0 : frames[points.at(-1)[0]].mjd - frames[points[0][0]].mjd;
  $("real-submit").disabled = !(span > 0);
  $("real-motion").textContent = "";
  $("real-details").hidden = !submitted;
  $("real-rating").hidden = !submitted;
  if (!submitted || !(span > 0)) return;
  const [, a] = points[0];
  const [, b] = points.at(-1);
  const years = span / 365.25;
  const dx = (b.x - a.x) * a.width;
  const dy = (b.y - a.y) * a.height;
  const scale = frames[points[0][0]].pixelScaleArcsec;
  const speed = Math.hypot(dx, dy) / years;
  const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  const direction = ["right", "down-right", "down", "down-left", "left", "up-left", "up", "up-right"][Math.round(angle / 45) % 8];
  const rate = scale > 0 ? `${(speed * scale).toFixed(1)} arcsec/year` : `${speed.toFixed(1)} px/year`;
  $("real-motion").textContent = `Apparent motion between first and last marks: ${rate}${speed > 0 ? ` · ${direction}` : ""}.`;
  const bearing = (Math.atan2(-dx, -dy) * 180 / Math.PI + 360) % 360;
  const compass = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(bearing / 45) % 8];
  $("real-sky-motion").textContent = speed > 0 && scale > 0
    ? `${rate} toward ${compass}`
    : speed === 0 ? "No displacement between endpoint marks." : "Image scale unavailable.";
  $("real-coverage").textContent = `Marked observations: ${points.length}/${frames.length}`;
  $("real-coverage-bar").max = frames.length;
  $("real-coverage-bar").value = points.length;
  const firstFrame = frames[points[0][0]];
  const lastFrame = frames[points.at(-1)[0]];
  $("real-span").textContent = `${firstFrame.dateISO.slice(0, 10)} → ${lastFrame.dateISO.slice(0, 10)} · ${span.toFixed(1)} days`;
  $("real-displacement").textContent = `${Math.hypot(dx, dy).toFixed(1)} px`;
  const coords = ({ x, y, width, height }) => `(${(x * width).toFixed(1)}, ${(y * height).toFixed(1)})`;
  $("real-positions").textContent = `${coords(a)} → ${coords(b)} px`;
  const intermediate = points.slice(1, -1).filter(([i]) =>
    frames[i].mjd > firstFrame.mjd && frames[i].mjd < lastFrame.mjd);
  if (!intermediate.length) {
    $("real-rating").textContent = "Consistency score needs 3 distinct observation times.";
    $("real-fit").textContent = "Mark an intermediate observation to check the estimated motion.";
    return;
  }

  const squaredError = intermediate.reduce((sum, [i, mark]) => {
    const fraction = (frames[i].mjd - firstFrame.mjd) / span;
    const errorX = (mark.x - a.x) * a.width - dx * fraction;
    const errorY = (mark.y - a.y) * a.height - dy * fraction;
    return sum + errorX ** 2 + errorY ** 2;
  }, 0);
  const rms = Math.sqrt(squaredError / intermediate.length);
  const score = Math.round(100 / (1 + rms));
  const stars = Math.round(score / 20);
  $("real-rating").textContent = `${"★".repeat(stars)}${"☆".repeat(5 - stars)} · ${score}/100 consistency`;
  $("real-fit").textContent = `${rms.toFixed(2)} px RMS deviation across ${intermediate.length} intermediate mark(s). Score = 100 ÷ (1 + deviation in px).`;
}

function updateResultFrames() {
  const list = $("real-results-frames");
  list.replaceChildren();
  list.hidden = marks.size === 0;
  for (const [frameIndex, mark] of [...marks].sort(([a], [b]) => a - b)) {
    const frame = frames[frameIndex];
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "daily-marked-frame";
    const preview = document.createElement("img");
    preview.src = frame.imageUrl;
    preview.alt = "";
    preview.loading = "lazy";
    const marker = document.createElement("span");
    marker.className = "daily-marked-dot";
    marker.style.left = `${mark.x * 100}%`;
    marker.style.top = `${mark.y * 100}%`;
    marker.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = `Frame ${frameIndex + 1} · ${frame.dateISO.slice(0, 10)}`;
    const thumbnail = document.createElement("span");
    thumbnail.append(preview, marker);
    button.append(thumbnail, label);
    button.addEventListener("click", () => show(frameIndex));
    item.append(button);
    list.append(item);
  }
}

async function loadFrames() {
  if (loading || frames.length) return;
  loading = true;
  $("real-retry").hidden = true;
  $("real-status").textContent = "Loading prepared SPHEREx observations…";
  try {
    let available = IS_REMOTE_BACKEND ? await getCutoutsApi({ ...field, requestId }) : [];
    if (!available.length) available = await getCutoutsApi(field);
    frames = available.filter((frame) => frame.detector === field.detector &&
      Number.isFinite(frame.mjd) && frame.imageUrl).sort((a, b) => a.mjd - b.mjd);
    if (!frames.length) throw new Error("No prepared observations were returned for this field.");
    frames.forEach((frame, i) => {
      const date = frame.dateISO.replace("T", " ").slice(0, 16);
      const band = [frame.wavelengthMinUm, frame.wavelengthMaxUm].map((value) => value.toFixed(2)).join("–");
      epoch.add(new Option(`${date} UTC · ${band} µm`, i));
    });
    $("real-status").textContent = `${frames.length} real observations`;
    $("real-viewer").hidden = false;
    $("real-blink").disabled = frames.length < 2;
    show(0);
  } catch (error) {
    frames = [];
    epoch.replaceChildren();
    $("real-status").textContent = error.message;
    $("real-retry").hidden = false;
  } finally {
    loading = false;
  }
}

function switchMode(real) {
  stop();
  const syntheticBlink = $("blink");
  if (real && syntheticBlink.getAttribute("aria-pressed") === "true") syntheticBlink.click();
  $("synthetic").hidden = real;
  $("real").hidden = !real;
  $("synthetic-mode").setAttribute("aria-pressed", String(!real));
  $("real-mode").setAttribute("aria-pressed", String(real));
  if (real) loadFrames();
}

$("real-mode").addEventListener("click", () => switchMode(true));
$("synthetic-mode").addEventListener("click", () => switchMode(false));
$("real-retry").addEventListener("click", loadFrames);
$("real-submit").addEventListener("click", () => {
  if ($("real-submit").disabled) return;
  stop();
  submitted = true;
  updateMarks();
  showShootingStars();
});
$("real-compare").addEventListener("click", () => {
  const out = $("real-models");
  out.replaceChildren();
  if (!submitted) return;
  const byTime = new Map();
  for (const [index, mark] of marks) {
    if (!byTime.has(frames[index].mjd)) byTime.set(frames[index].mjd, { index, ...mark });
  }
  const distinct = [...byTime.values()];
  const scale = frames[distinct[0]?.index]?.pixelScaleArcsec;
  if (distinct.length < 3 || !(scale > 0)) {
    out.textContent = distinct.length < 3
      ? "Mark at least three distinct observation times to compare motion models."
      : "The image scale is needed to compare motion models.";
    return;
  }
  const sigmaPx = 1;
  const mjds = frames.map(({ mjd }) => mjd);
  const points = distinct.map(({ index, x, y, width, height }) =>
    ({ frame: index, x: (x - .5) * width, y: (y - .5) * height }));
  const comparison = modelComparison(observationsOf(points, mjds, scale, { sigmaPx }), field);
  renderComparison(out, comparison, { sigmaPx, manualMarks: true });
});

$("real-clear").addEventListener("click", () => {
  marks.clear();
  $("real-models").replaceChildren();
  submitted = false;
  updateMarks();
  updateResultFrames();
});
epoch.addEventListener("change", () => show(Number(epoch.value)));
$("real-blink").addEventListener("click", () => {
  if (timer !== undefined) return stop();
  if (frames.length < 2) return;
  $("real-blink").textContent = "Pause";
  $("real-blink").setAttribute("aria-pressed", "true");
  timer = setInterval(() => {
    if (imageReady) show((index + 1) % frames.length);
  }, 750);
});
function showLoadedImage() {
  imageReady = true;
  $("real-track").style.visibility = "";
  $("real-status").textContent = `${frames.length} real observations`;
  updateMarks();
}
image.addEventListener("load", showLoadedImage);
image.addEventListener("error", () => { stop(); $("real-status").textContent = "This observation could not be displayed. Try another frame."; });
image.addEventListener("click", (event) => {
  if (!imageReady) return;
  const rect = image.getBoundingClientRect();
  saveMark((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
});
image.addEventListener("keydown", (event) => {
  const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (!move || !imageReady) return;
  event.preventDefault();
  const mark = marks.get(index) ?? { x: .5, y: .5 };
  saveMark(mark.x + move[0] / image.naturalWidth, mark.y + move[1] / image.naturalHeight);
});

function saveMark(x, y) {
  const clamp = (value) => Math.max(0, Math.min(1, value));
  if (submitted) $("real-models").replaceChildren();
  submitted = false;
  marks.set(index, { x: clamp(x), y: clamp(y), width: image.naturalWidth, height: image.naturalHeight });
  updateMarks();
  updateResultFrames();
}
