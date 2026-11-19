import { mulberry32, renderPixels, stretchAsinh } from "./data/mockSource.js";

const $ = (id) => document.getElementById(id);
const day = Math.floor(Date.now() / 86400000);
const date = new Date(day * 86400000).toISOString().slice(0, 10);
const limit = 3;
const size = 64;
const rng = mulberry32(day);
const source = { x0: 14 + rng() * 36, y0: 14 + rng() * 36, vx: 5 + rng() * 5, vy: 3 + rng() * 5, flux: 220 };
if (rng() < .5) source.vx *= -1;
if (rng() < .5) source.vy *= -1;
const targets = [{ x: source.x0, y: source.y0 }, { x: source.x0 + source.vx, y: source.y0 + source.vy }];
const tolerance = 3;
const field = {
  stars: Array.from({ length: 32 }, () => ({ x: rng() * size, y: rng() * size, flux: 30 + rng() * 125 })),
  variable: { x: 0, y: 0, flux: 0, periodDays: 1 },
  mover: source,
};
const frames = [0, 1].map((epoch) =>
  stretchAsinh(renderPixels(field, size, 61000 + epoch * 365.25, epoch, 4, mulberry32(day))));
const storageKey = "spherex-daily-v1";
let saved = {};
try { saved = JSON.parse(localStorage.getItem(storageKey)) ?? {}; } catch { /* play without storage */ }
if (!saved || typeof saved !== "object" || Array.isArray(saved)) saved = {};
let attempts = [];
const canvas = $("daily-image");
const context = canvas.getContext("2d");
const scale = canvas.width / size;
let frame = 0;
const markers = [null, null];
const latest = () => attempts.at(-1);
const done = () => latest()?.hit || attempts.length >= limit;
$("daily-date").textContent = `${date} UTC · Synthetic challenge`;

const images = frames.map((grey) => {
  const pixels = context.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const intensity = grey[Math.floor(y / scale) * size + Math.floor(x / scale)];
      const offset = (y * canvas.width + x) * 4;
      pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = intensity;
      pixels.data[offset + 3] = 255;
    }
  }
  return pixels;
});

function drawPreview() {
  const preview = $("daily-preview");
  const previewContext = preview.getContext("2d");
  const { x, y } = targets[frame];
  const half = 5 * scale;
  previewContext.clearRect(0, 0, preview.width, preview.height);
  previewContext.imageSmoothingEnabled = false;
  previewContext.drawImage(canvas, x * scale - half, y * scale - half,
    half * 2, half * 2, 0, 0, preview.width, preview.height);
  $("daily-preview-caption").textContent = `Frame ${frame === 0 ? "A" : "B"} · Synthetic source`;
}

function celebrate() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const overlay = $("daily-celebration");
  const meteors = Array.from({ length: 12 }, (_, index) => {
    const star = document.createElement("span");
    star.style.setProperty("--start", `${-9 + (index * 43) % 101}%`);
    star.style.setProperty("--height", `${-15 + (index * 23) % 96}%`);
    star.style.setProperty("--delay", `${index * 105}ms`);
    star.addEventListener("animationend", () => star.remove(), { once: true });
    return star;
  });
  overlay.replaceChildren(...meteors);
}

function draw() {
  context.putImageData(images[frame], 0, 0);
  if (latest()?.hit) drawPreview();
  const point = done() ? targets[frame] : markers[frame];
  if (point) {
    context.beginPath();
    context.arc(point.x * scale, point.y * scale, 3 * scale, 0, 2 * Math.PI);
    context.strokeStyle = "#77e9ff";
    context.lineWidth = 2;
    context.stroke();
  }
  $("frame-a").setAttribute("aria-pressed", String(frame === 0));
  $("frame-b").setAttribute("aria-pressed", String(frame === 1));
  $("daily-submit").disabled = !markers.every(Boolean) || done();
}

function measureMotion([start, end]) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const speed = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  const direction = ["right", "down-right", "down", "down-left", "left", "up-left", "up", "up-right"][Math.round(angle / 45) % 8];
  return {
    speed: `${speed.toFixed(1)} px/year`,
    direction: speed < 0.05 ? "no measurable direction" : direction,
  };
}

const solution = measureMotion(targets);
const formatPosition = ({ x, y }) => `X ${x.toFixed(1)} · Y ${y.toFixed(1)} px`;

function updateResult() {
  const remaining = limit - attempts.length;
  const result = latest();
  const hit = Boolean(result?.hit);
  const finished = done();
  $("daily-results").classList.toggle("is-open", hit);
  $("daily-results-icon").textContent = hit ? "✓" : "✦";
  $("daily-results-title").textContent = hit ? "Object found" : finished ? "Round complete" : "Results";
  $("daily-status").textContent = hit
    ? `Found in ${attempts.length}/${limit} · ${result.score}/100 points.`
    : remaining ? `${remaining} attempt${remaining === 1 ? "" : "s"} left.` : "Out of attempts · 0/100 points.";
  $("daily-measurement").textContent = result
    ? `Your estimate: ${result.motion.speed} · ${result.motion.direction}` : "";
  $("daily-speed").hidden = !finished;
  $("daily-direction").hidden = !finished;
  $("daily-speed").textContent = finished ? solution.speed : "";
  $("daily-direction").textContent = finished ? `Toward ${solution.direction}` : "";
  $("daily-found").hidden = !hit;
  $("daily-position-a").textContent = hit ? formatPosition(targets[0]) : "";
  $("daily-position-b").textContent = hit ? formatPosition(targets[1]) : "";
  $("daily-result-actions").hidden = !finished;
  const lastDay = saved.lastPlayed ?? saved.lastSolved;
  const gap = day - lastDay;
  const streak = gap <= 1 || (gap === 2 && !saved.freezeUsed) ? saved.streak ?? 0 : 0;
  $("daily-streak").textContent = `Streak: ${streak} day${streak === 1 ? "" : "s"} · ${streak && (saved.freezeUsed || gap === 2) ? "Freeze used" : "1 freeze available"}`;
}

function recordPlay() {
  const lastDay = saved.lastPlayed ?? saved.lastSolved;
  if (lastDay === day) return;
  const gap = day - lastDay;
  const usedFreeze = gap === 2 && !saved.freezeUsed;
  const continued = gap === 1 || usedFreeze;
  saved = {
    lastPlayed: day,
    streak: continued ? (saved.streak ?? 0) + 1 : 1,
    freezeUsed: continued && (usedFreeze || !!saved.freezeUsed),
  };
  try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* keep streak in memory */ }
}

$("frame-a").addEventListener("click", () => { frame = 0; draw(); });
$("frame-b").addEventListener("click", () => { frame = 1; draw(); });
canvas.addEventListener("click", (event) => {
  if (done()) return;
  const rect = canvas.getBoundingClientRect();
  markers[frame] = { x: (event.clientX - rect.left) / rect.width * size, y: (event.clientY - rect.top) / rect.height * size };
  draw();
});
canvas.addEventListener("keydown", (event) => {
  const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (!move || done()) return;
  event.preventDefault();
  const marker = markers[frame] ??= { x: size / 2, y: size / 2 };
  marker.x = Math.max(0, Math.min(size, marker.x + move[0]));
  marker.y = Math.max(0, Math.min(size, marker.y + move[1]));
  draw();
});
$("daily-submit").addEventListener("click", () => {
  if (!markers.every(Boolean) || done()) return;
  const error = Math.max(...markers.map((point, index) =>
    Math.hypot(point.x - targets[index].x, point.y - targets[index].y)));
  const hit = error <= tolerance;
  const accuracy = Math.max(0, 1 - error / tolerance);
  const score = hit ? Math.round(50 + 30 * accuracy + 10 * (limit - 1 - attempts.length)) : 0;
  attempts.push({ hit, score, motion: measureMotion(markers) });
  if (done()) recordPlay();
  markers.fill(null);
  updateResult();
  draw();
  if (hit) celebrate();
});
$("daily-share").addEventListener("click", async () => {
  const squares = attempts.map(({ hit }) => hit ? "🟩" : "🟥").join("");
  const result = `SPHEREx Blink · Field of the Day · ${date} UTC\n${squares}${"⬜".repeat(limit - attempts.length)} · ${latest().score}/100\n${new URL("daily.html", location.href)}`;
  try {
    await navigator.clipboard.writeText(result);
    $("daily-copy-status").textContent = "Result copied.";
  } catch {
    const fallback = $("daily-share-text");
    fallback.value = result;
    fallback.hidden = false;
    fallback.focus();
    fallback.select();
  }
});
$("daily-replay").addEventListener("click", () => {
  $("daily-celebration").replaceChildren();
  attempts = [];
  frame = 0;
  markers.fill(null);
  $("daily-copy-status").textContent = "";
  $("daily-share-text").hidden = true;
  updateResult();
  draw();
  $("frame-a").focus();
});
updateResult();
draw();
