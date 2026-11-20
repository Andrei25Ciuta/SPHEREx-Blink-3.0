import { mulberry32, renderPixels, stretchAsinh } from "./data/mockSource.js";

const size = 48;
const frameCount = 3;
const roundMs = 10000;
const blinkMs = 650;
const questionCount = 10;
const pool = ["star", "asteroid", "artefact", "star", "artefact", "asteroid", "artefact", "star", "artefact", "artefact"];
const categories = {
  star: ["Star", "The signal has the soft shape of the other stars and stays in place across the three observations."],
  asteroid: ["Asteroid", "The point of light has a star-like shape but shifts in the same direction from one observation to the next."],
  artefact: ["Artefact", "A sharp pixel or streak appears in just one frame. Its shape differs from the soft light of nearby stars."],
};

export function makeCandidate(kind, seed) {
  const rng = mulberry32(seed);
  const center = { x: 19 + rng() * 10, y: 19 + rng() * 10 };
  const angle = rng() * Math.PI * 2;
  const shift = { x: Math.cos(angle) * 3.2, y: Math.sin(angle) * 3.2 };
  const flux = 108 + rng() * 35;
  const artifactFrame = Math.floor(rng() * frameCount);
  const streak = rng() < .5;
  const stars = Array.from({ length: 22 }, () => ({
    x: rng() * size, y: rng() * size, flux: 26 + rng() * 95,
  })).filter(({ x, y }) => Math.hypot(x - center.x, y - center.y) > 6.5);
  const mover = {
    x0: center.x, y0: center.y,
    vx: kind === "asteroid" ? shift.x : 0,
    vy: kind === "asteroid" ? shift.y : 0,
    flux: kind === "artefact" ? 0 : flux,
  };
  const field = { stars, mover, variable: { x: 0, y: 0, flux: 0, periodDays: 1 } };
  const frames = Array.from({ length: frameCount }, (_, index) => {
    const pixels = renderPixels(field, size, 61000 + index, index - 1, 2, mulberry32(seed + index + 1));
    if (kind === "artefact" && index === artifactFrame) {
      const location = Math.floor(center.y) * size + Math.floor(center.x);
      pixels[location] += flux / 6;
      if (streak) {
        pixels[location - size] += flux / 8;
        pixels[location + size] += flux / 8;
      }
    }
    return stretchAsinh(pixels);
  });
  return { center, frames };
}

function runGame() {
  const $ = (id) => document.getElementById(`classification-${id}`);
  const image = $("image");
  const context = image.getContext("2d");
  if (!context) {
    $("start").disabled = true;
    $("result").textContent = "This browser could not open the image viewer.";
    return;
  }
  const observations = [...document.querySelectorAll("[data-classification-frame]")];
  const answers = [...document.querySelectorAll("[data-classification-answer]")];
  let candidate;
  let kind;
  let frame = 0;
  let deadline;
  let nextFrameAt;
  let timer;
  let blinking = false;
  let running = false;
  let questions = [];
  let question = 0;
  let score = 0;
  const identify = new URLSearchParams(window.location?.search).get("game") === "identify";
  const title = identify ? "Identify the object" : "Real or Fake?";
  $("title").textContent = title;
  document.title = `${title} · SPHEREx Blink`;
  $("mode-help").textContent = identify
    ? "Choose Star, Asteroid, or Artefact for the marked signal."
    : "Real means a star or asteroid. Fake means an image artefact.";
  answers.forEach((button) => {
    const answer = button.dataset.classificationAnswer;
    const binaryAnswer = answer === "real" || answer === "fake";
    button.hidden = identify === binaryAnswer;
  });

  function newQuiz() {
    questions = [...pool];
    for (let i = questions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [questions[i], questions[j]] = [questions[j], questions[i]];
    }
    question = 0;
    score = 0;
    start();
  }

  function showFrame(index) {
    frame = index;
    const pixels = context.createImageData(size, size);
    for (const [i, grey] of candidate.frames[index].entries()) {
      const offset = i * 4;
      pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = grey;
      pixels.data[offset + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const { x, y } = candidate.center;
    context.beginPath();
    context.arc(x, y, 5.5, 0, 2 * Math.PI);
    context.strokeStyle = "#f5c16f";
    context.lineWidth = .35;
    context.stroke();
    observations.forEach((button, i) => button.setAttribute("aria-pressed", String(i === index)));
  }

  function setBlink(enabled) {
    blinking = enabled;
    nextFrameAt = performance.now() + blinkMs;
    $("blink").setAttribute("aria-pressed", String(enabled));
    $("blink").textContent = enabled ? "Pause" : "Blink";
  }

  function finish(answer) {
    if (!running) return;
    if (performance.now() >= deadline) answer = null;
    running = false;
    clearInterval(timer);
    setBlink(false);
    $("blink").disabled = true;
    const expected = identify ? kind : (kind === "artefact" ? "fake" : "real");
    if (answer === expected) score++;
    answers.forEach((button) => {
      button.disabled = true;
      button.toggleAttribute("data-correct", button.dataset.classificationAnswer === expected);
      button.toggleAttribute("data-incorrect", Boolean(answer) && answer === button.dataset.classificationAnswer && answer !== expected);
    });
    if (!answer) {
      $("time").value = 0;
      $("seconds").textContent = "0";
    }
    const title = document.createElement("strong");
    const [label, explanation] = categories[kind];
    title.textContent = `${answer === expected ? "Correct" : answer ? "Incorrect" : "Time’s up"} · ${label}`;
    const detail = document.createElement("p");
    detail.textContent = explanation;
    $("result").replaceChildren(title, detail);
    $("next").textContent = "Next question";
    if (question === questionCount - 1) {
      const total = document.createElement("p");
      total.textContent = `Final score: ${score}/${questionCount}`;
      $("result").append(total);
      $("next").textContent = "Play again";
    }
    $("next").hidden = false;
    $("next").focus({ preventScroll: true });
  }

  function tick() {
    const now = performance.now();
    if (now >= deadline) return finish(null);
    $("time").value = (deadline - now) / 1000;
    $("seconds").textContent = String(Math.ceil((deadline - now) / 1000));
    if (blinking && now >= nextFrameAt) {
      showFrame((frame + 1) % frameCount);
      nextFrameAt = now + blinkMs;
    }
  }

  function start() {
    clearInterval(timer);
    kind = questions[question];
    $("question").textContent = `Question ${question + 1} of ${questionCount}`;
    candidate = makeCandidate(kind, Math.floor(Math.random() * 2 ** 31));
    running = true;
    deadline = performance.now() + roundMs;
    $("ready").hidden = true;
    $("next").hidden = true;
    $("result").replaceChildren();
    $("time").value = 10;
    $("seconds").textContent = "10";
    $("blink").disabled = false;
    observations.forEach((button) => { button.disabled = false; });
    answers.forEach((button) => {
      button.disabled = button.hidden;
      button.removeAttribute("data-correct");
      button.removeAttribute("data-incorrect");
    });
    showFrame(0);
    setBlink(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    timer = setInterval(tick, 100);
    observations[0].focus({ preventScroll: true });
  }

  observations.forEach((button, i) => button.addEventListener("click", () => {
    setBlink(false);
    showFrame(i);
  }));
  answers.forEach((button) => button.addEventListener("click", () => finish(button.dataset.classificationAnswer)));
  $("blink").addEventListener("click", () => setBlink(!blinking));
  $("start").addEventListener("click", newQuiz);
  $("next").addEventListener("click", () => {
    if (question + 1 < questionCount) {
      question++;
      start();
      return;
    }
    $("ready").hidden = false;
    $("next").hidden = true;
    $("result").replaceChildren();
    $("question").textContent = `Question 1 of ${questionCount}`;
    $("seconds").textContent = "10";
    $("time").value = 10;
    observations.forEach((button) => { button.disabled = true; });
    $("start").focus({ preventScroll: true });
  });
}

if (typeof document !== "undefined") runGame();
