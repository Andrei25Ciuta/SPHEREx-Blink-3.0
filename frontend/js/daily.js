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
const target = { x: source.x0 + source.vx, y: source.y0 + source.vy };
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
const round = saved.round?.day === day ? saved.round : { day, attempts: 0, won: false };
const canvas = $("daily-image");
const context = canvas.getContext("2d");
const scale = canvas.width / size;
let frame = 0;
let marker = null;
const done = () => round.won || round.attempts >= limit;
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

function draw() {
  context.putImageData(images[frame], 0, 0);
  const point = frame === 1 && (done() ? target : marker);
  if (point) {
    context.beginPath();
    context.arc(point.x * scale, point.y * scale, 3 * scale, 0, 2 * Math.PI);
    context.strokeStyle = "#77e9ff";
    context.lineWidth = 2;
    context.stroke();
  }
  $("frame-a").setAttribute("aria-pressed", String(frame === 0));
  $("frame-b").setAttribute("aria-pressed", String(frame === 1));
  $("daily-submit").disabled = frame !== 1 || !marker || done();
}

function updateResult() {
  const remaining = limit - round.attempts;
  $("daily-status").textContent = round.won
    ? `Found in ${round.attempts}/${limit} attempts.`
    : remaining ? `${remaining} attempt${remaining === 1 ? "" : "s"} left.` : "Out of attempts. Frame B shows the solution.";
  $("daily-share").hidden = !done();
  const streak = saved.lastSolved >= day - 1 ? saved.streak ?? 0 : 0;
  $("daily-streak").textContent = `Streak: ${streak} day${streak === 1 ? "" : "s"}`;
}

$("frame-a").addEventListener("click", () => { frame = 0; draw(); });
$("frame-b").addEventListener("click", () => { frame = 1; draw(); });
canvas.addEventListener("click", (event) => {
  if (frame !== 1 || done()) return;
  const rect = canvas.getBoundingClientRect();
  marker = { x: (event.clientX - rect.left) / rect.width * size, y: (event.clientY - rect.top) / rect.height * size };
  draw();
});
canvas.addEventListener("keydown", (event) => {
  const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (!move || frame !== 1 || done()) return;
  event.preventDefault();
  marker ??= { x: size / 2, y: size / 2 };
  marker.x = Math.max(0, Math.min(size, marker.x + move[0]));
  marker.y = Math.max(0, Math.min(size, marker.y + move[1]));
  draw();
});
$("daily-submit").addEventListener("click", () => {
  if (frame !== 1 || !marker || done()) return;
  round.attempts++;
  round.won = Math.hypot(marker.x - target.x, marker.y - target.y) <= 3;
  if (round.won) {
    saved.streak = saved.lastSolved === day - 1 ? (saved.streak ?? 0) + 1 : 1;
    saved.lastSolved = day;
  }
  saved.round = round;
  try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* keep this round in memory */ }
  marker = null;
  updateResult();
  draw();
});
$("daily-share").addEventListener("click", async () => {
  const score = round.won ? round.attempts : "×";
  const result = `SPHEREx Blink · Field of the Day · ${date} UTC\n${score}/${limit}\n${new URL("daily.html", location.href)}`;
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
if (done()) frame = 1;
updateResult();
draw();
