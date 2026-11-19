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
  $("real-motion").textContent = summary;
  if (points.length < 2 || !imageReady) return;
  const [[first, a], [last, b]] = [points[0], points.at(-1)];
  const years = (frames[last].mjd - frames[first].mjd) / 365.25;
  if (!(years > 0)) return;
  const dx = (b.x - a.x) * image.naturalWidth;
  const dy = (b.y - a.y) * image.naturalHeight;
  const scale = frames[index].pixelScaleArcsec;
  const speed = Math.hypot(dx, dy) / years;
  const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  const direction = ["right", "down-right", "down", "down-left", "left", "up-left", "up", "up-right"][Math.round(angle / 45) % 8];
  const rate = scale > 0 ? `${(speed * scale).toFixed(1)} arcsec/year` : `${speed.toFixed(1)} px/year`;
  $("real-motion").textContent = `${summary} Apparent motion between first and last marks: ${rate}${speed > 0 ? ` · ${direction}` : ""}.`;
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
$("real-clear").addEventListener("click", () => { marks.clear(); updateMarks(); });
epoch.addEventListener("change", () => { stop(); show(Number(epoch.value)); });
$("real-blink").addEventListener("click", () => {
  if (timer !== undefined) return stop();
  if (frames.length < 2) return;
  $("real-blink").textContent = "Pause";
  $("real-blink").setAttribute("aria-pressed", "true");
  timer = setInterval(() => show((index + 1) % frames.length), 750);
});
image.addEventListener("load", () => {
  imageReady = true;
  $("real-track").style.visibility = "";
  $("real-status").textContent = `${frames.length} real observations`;
  updateMarks();
});
image.addEventListener("error", () => { stop(); $("real-status").textContent = "This observation could not be displayed. Try another frame."; });
image.addEventListener("click", (event) => {
  if (!imageReady) return;
  stop();
  const rect = image.getBoundingClientRect();
  marks.set(index, { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
  updateMarks();
});
image.addEventListener("keydown", (event) => {
  const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (!move || !imageReady) return;
  event.preventDefault();
  stop();
  const mark = marks.get(index) ?? { x: .5, y: .5 };
  const clamp = (value) => Math.max(0, Math.min(1, value));
  marks.set(index, { x: clamp(mark.x + move[0] / image.naturalWidth), y: clamp(mark.y + move[1] / image.naturalHeight) });
  updateMarks();
});
