import { updateRealStreak, recordRealCompletion } from "./dailyRealStreak.js";
import { getPreparedSequenceApi } from "./data/apiSource.js?v=real-challenge";
import { TARGETS, positionAtEpoch } from "./targets.js";
import { showChallengeCompletion, showShootingStars } from "./dailyCelebration.js?v=shared-feedback";

const byId = (id) => document.getElementById(id);
const retry = byId("real-game-retry");
const panel = byId("daily-real-game");
const image = byId("real-game-image");
const status = byId("real-game-status");
const submit = byId("real-game-submit");
const frameButtons = [byId("real-game-a"), byId("real-game-b")];
const day = Math.floor(Date.now() / 86400000);
const date = new Date(day * 86400000).toISOString().slice(0, 10);
const earlier = [60908.981929, 60911.493589, 60912.717131, 60914.279255, 60916.657572, 60917.67394];
const later = [61114.03648, 61114.10404, 61116.681643, 61121.228205];
const epochs = [earlier[day % earlier.length], later[Math.floor(day / earlier.length) % later.length]];
const barnard = TARGETS.find(({ id }) => id === "barnard");
let frames = [];
let active = 0;
let ready = false;
let attempt = 0;
let finished = false;
let score = 0;
const marks = [null, null];
const blink = byId("real-game-blink");
let timer;

function stopBlink() {
  clearInterval(timer);
  timer = undefined;
  blink.setAttribute("aria-pressed", "false");
  blink.textContent = "Blink";
}

blink.addEventListener("click", () => {
  if (timer !== undefined) return stopBlink();
  if (!frames.length) return;
  blink.setAttribute("aria-pressed", "true");
  blink.textContent = "Pause";
  timer = setInterval(() => {
    if (ready) show(1 - active);
  }, 850);
});
byId("daily-synthetic-mode").addEventListener("click", stopBlink);

function draw() {
  const mark = marks[active];
  const marker = byId("real-game-marker");
  marker.setAttribute("visibility", ready && mark ? "visible" : "hidden");
  if (mark) {
    marker.setAttribute("cx", mark.x * 100);
    marker.setAttribute("cy", mark.y * 100);
  }
  frameButtons.forEach((button, i) => button.setAttribute("aria-pressed", String(i === active)));
  submit.disabled = finished || !marks.every(Boolean);
}

function show(i) {
  if (!frames.length) return;
  active = i;
  ready = false;
  image.src = frames[i].imageUrl;
  ready = image.complete && image.naturalWidth > 0;
  image.hidden = !ready;
  draw();
}

async function loadChallenge() {
  retry.hidden = true;
  status.textContent = "Loading prepared observations…";
  try {
    const sequence = await getPreparedSequenceApi("barnard-d2");
    if (sequence.dataKind !== "real" || sequence.revision !== "a75a1f6eaba54cba997233319b47bd3e") {
      throw new Error("The reference sequence is unavailable.");
    }
    const selected = epochs.map((mjd) => sequence.frames.find((frame) => frame.mjd === mjd));
    if (selected.some((frame) => !frame?.imageUrl || !(frame.pixelScaleArcsec > 0))) {
      throw new Error("The daily reference pair could not be loaded.");
    }
    frames = selected;
    frameButtons.forEach((button, i) => {
      button.textContent = `Frame ${i ? "B" : "A"} · ${frames[i].dateISO.slice(0, 10)}`;
    });
    status.textContent = `${date} UTC · 3 attempts left.`;
    updateRealStreak();
    show(0);
  } catch (error) {
    status.textContent = error.message;
    retry.hidden = false;
  }
}
retry.addEventListener("click", loadChallenge);

frameButtons.forEach((button, i) => button.addEventListener("click", () => show(i)));
image.addEventListener("load", () => {
  ready = true;
  image.hidden = false;
  draw();
});
image.addEventListener("error", () => {
  stopBlink();
  ready = false;
  image.hidden = true;
  status.textContent = "Image unavailable. Select the frame again to retry.";
  draw();
});
function mark(x, y) {
  const clamp = (value) => Math.max(0, Math.min(1, value));
  marks[active] = { x: clamp(x), y: clamp(y), width: image.naturalWidth, height: image.naturalHeight };
  draw();
}
image.addEventListener("click", (event) => {
  if (!ready || finished) return;
  const bounds = image.getBoundingClientRect();
  mark((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
});
image.addEventListener("keydown", (event) => {
  const offset = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (!ready || finished || !offset) return;
  event.preventDefault();
  const point = marks[active] ?? { x: .5, y: .5 };
  mark(point.x + offset[0] / image.naturalWidth, point.y + offset[1] / image.naturalHeight);
});

submit.addEventListener("click", () => {
  if (submit.disabled) return;
  stopBlink();
  const tolerance = 1.5;
  attempt++;
  const errors = marks.map(({ x, y, width, height }, i) => {
    const frame = frames[i];
    const reference = positionAtEpoch(barnard, 2000 + (frame.mjd - 51544.5) / 365.25);
    const scale = frame.pixelScaleArcsec;
    const east = (reference.ra - 269.4462) * 3600 * Math.cos(4.769 * Math.PI / 180);
    const north = (reference.dec - 4.769) * 3600;
    return Math.hypot((x - .5) * width + east / scale, (y - .5) * height + north / scale);
  });
  const error = Math.max(...errors);
  const hit = error <= tolerance;
  finished = hit || attempt === 3;
  if (finished) {
    score = hit ? Math.round(50 + 30 * (1 - error / tolerance) + 10 * (3 - attempt)) : 0;
    status.textContent = hit
      ? `Barnard’s Star found · ${score}/100 · catalogue position match.`
      : "Out of attempts. The target was Barnard’s Star.";
    showChallengeCompletion(recordRealCompletion());
    byId("real-game-share").hidden = false;
    if (hit) showShootingStars();
  } else {
    marks.fill(null);
    status.textContent = `${3 - attempt} attempts left.`;
  }
  draw();
});

byId("real-game-share").addEventListener("click", async () => {
  const squares = "🟥".repeat(score ? attempt - 1 : attempt) + (score ? "🟩" : "") + "⬜".repeat(3 - attempt);
  const message = `SPHEREx Blink · Real daily challenge · ${date} UTC\n${squares} · ${score}/100\n${new URL("daily.html?challenge=real-pair", location.href)}`;
  try { await navigator.clipboard.writeText(message); }
  catch {
    const field = byId("real-game-share-text");
    field.value = message;
    field.hidden = false;
    field.select();
  }
});


if (new URLSearchParams(window.location?.search).get("challenge") === "real-pair") {
  byId("daily-title").textContent = "Real Daily Challenge";
  for (const id of ["daily-synthetic", "daily-synthetic-streak", "daily-date", "daily-mode-controls"]) {
    byId(id).hidden = true;
  }
  byId("daily-real-streak").hidden = false;
  panel.hidden = false;
  await loadChallenge();
}
