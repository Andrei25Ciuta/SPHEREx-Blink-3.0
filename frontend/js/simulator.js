import { earthPositionAU } from "./features/parallax.js";
import { orbitScene, cameraPoint } from "./features/orbitScene.js";
import { FRAME_WIDTH, FRAME_HEIGHT, MONTH_PRESETS, syntheticStars, exposureGeometry, easeTargetShift } from "./features/simulatorFrames.js";

const $ = id => document.getElementById(id);
const svg = $("scene-bodies"), controls = $("controls");
let timer, lastEpoch, orbit;

const stars = syntheticStars();
const referenceExposure = { stars: {x: 0, y: 0}, target: {x: 160, y: 100} };
let registered = false;
const reducedTargetMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
let displayedTargetShift = null;
let desiredTargetShift = null;
let exposurePair = null;
let targetMotionFrame = null;
let lastMotionFrameTime = null;

function stopTargetMotion() {
  if (targetMotionFrame !== null) window.cancelAnimationFrame?.(targetMotionFrame);
  targetMotionFrame = null;
  lastMotionFrameTime = null;
}

function paintBackground(ctx) {
  ctx.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
  ctx.fillStyle = "#071321";
  ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
  ctx.strokeStyle = "rgba(114,163,187,.15)";
  ctx.strokeRect(8.5, 8.5, FRAME_WIDTH - 17, FRAME_HEIGHT - 17);
}

function paintExposure(ctx, exposure, strength, showLabel = false) {
  if (strength <= 0) return;
  for (const star of stars) {
    const x = star.x + exposure.stars.x, y = star.y + exposure.stars.y;
    const halo = ctx.createRadialGradient(x, y, 0, x, y, 5 + star.radius * 2);
    halo.addColorStop(0, "rgba(231,245,255," + (star.brightness * strength) + ")");
    halo.addColorStop(.2, "rgba(157,208,240," + (.5 * star.brightness * strength) + ")");
    halo.addColorStop(1, "rgba(116,173,225,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, 5 + star.radius * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  const x = exposure.target.x, y = exposure.target.y;
  const glow = ctx.createRadialGradient(x, y, 0, x, y, 16);
  glow.addColorStop(0, "rgba(255,238,183," + (.95 * strength) + ")");
  glow.addColorStop(.25, "rgba(255,185,84," + (.6 * strength) + ")");
  glow.addColorStop(1, "rgba(255,150,47,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,225,148," + strength + ")";
  ctx.beginPath();
  ctx.arc(x, y, 2.8, 0, Math.PI * 2);
  ctx.fill();
  if (showLabel) {
    ctx.font = "bold 10px sans-serif";
    ctx.fillStyle = "#fbd18b";
    ctx.fillText("TARGET", Math.min(x + 12, FRAME_WIDTH - 59), Math.max(14, y - 10));
  }
}

function paintCanvas(id, layers) {
  const canvas = $(id), ctx = canvas.getContext("2d");
  if (!ctx) return;
  paintBackground(ctx);
  for (const [exposure, fraction, label] of layers) paintExposure(ctx, exposure, fraction, label);
}

function redrawSyntheticExposures() {
  if (!exposurePair) return;
  const shifted = exposure => ({
    ...exposure,
    target: {
      x: 160 + exposure.stars.x + displayedTargetShift.x,
      y: 100 + exposure.stars.y + displayedTargetShift.y
    }
  });
  const currentRaw = shifted(exposurePair.raw);
  const currentAligned = shifted(exposurePair.aligned);
  const mix = $("sim-blend").valueAsNumber / 100;
  paintCanvas("sim-frame-reference", [[referenceExposure, 1, true]]);
  paintCanvas("sim-frame-current", [[currentRaw, 1, true]]);
  paintCanvas("sim-frame-overlay", [
    [referenceExposure, 1 - mix, false],
    [registered ? currentAligned : currentRaw, mix, false]
  ]);
}

function animateTarget(time) {
  targetMotionFrame = null;
  if (document.hidden || !exposurePair) return;
  const deltaMs = lastMotionFrameTime === null ? 16 : Math.max(0, time - lastMotionFrameTime);
  lastMotionFrameTime = time;
  displayedTargetShift = easeTargetShift(displayedTargetShift, desiredTargetShift, deltaMs);
  if (Math.hypot(displayedTargetShift.x - desiredTargetShift.x,
                 displayedTargetShift.y - desiredTargetShift.y) < 0.06) {
    displayedTargetShift = { ...desiredTargetShift };
    lastMotionFrameTime = null;
  } else {
    targetMotionFrame = window.requestAnimationFrame(animateTarget);
  }
  redrawSyntheticExposures();
}

function paintSyntheticFrames(model, day) {
  const currentRaw = exposureGeometry(model.offset, $("distance").valueAsNumber, false);
  const currentAligned = exposureGeometry(model.offset, $("distance").valueAsNumber, true);
  exposurePair = { raw: currentRaw, aligned: currentAligned };
  desiredTargetShift = currentAligned.relativeTargetShift;
  if (displayedTargetShift === null || reducedTargetMotion ||
      typeof window.requestAnimationFrame !== "function") {
    stopTargetMotion();
    displayedTargetShift = { ...desiredTargetShift };
  } else if (targetMotionFrame === null &&
      Math.hypot(displayedTargetShift.x - desiredTargetShift.x,
                 displayedTargetShift.y - desiredTargetShift.y) > 0.06) {
    lastMotionFrameTime = null;
    targetMotionFrame = window.requestAnimationFrame(animateTarget);
  }
  redrawSyntheticExposures();
  const months = Math.round(day * 12 / 365);
  $("sim-frame-date").textContent = "Current · month " + months;
  $("sim-month-label").textContent = "Month " + months + " · day " + day;
  $("sim-blend-value").textContent = $("sim-blend").value + "%";
  for (const preset of MONTH_PRESETS) {
    const button = document.querySelector('[data-sim-day="' + preset.day + '"]');
    if (button) button.setAttribute("aria-pressed", String(day === preset.day));
  }
  const alignButton = $("align-frames");
  alignButton.disabled = false;
  alignButton.setAttribute("aria-pressed", String(registered));
  alignButton.textContent = registered ? "Show unaligned frames" : "Align & blend images";
  $("sim-frame-comparison-title").textContent = (registered ? "Aligned blend" : "Raw overlay") + " · " + $("sim-blend").value + "% current";
  const shift = currentAligned.relativeTargetShift;
  const shiftArcsec = Math.hypot(model.offset.east, model.offset.north);
  const displaced = Math.hypot(shift.x, shift.y) > .3;
  $("sim-alignment-caption").textContent = registered
    ? "Aligned on the background stars: pointing jitter is removed. " +
      (displaced ? "The target still appears in two places because of parallax (" + shiftArcsec.toFixed(1) + " arcsec)." : "The target nearly overlaps its reference position.") +
      " Adjust the blend slider to balance the two synthetic exposures."
    : "Before alignment: pointing jitter makes the background stars appear doubled. Select Align & blend images to register them on the fixed stars.";
  $("sim-frame-overlay").setAttribute("aria-label", registered
    ? "Aligned synthetic exposures; fixed stars overlap, while target parallax remains visible."
    : "Unaligned synthetic exposures; field stars are doubled by pointing jitter.");
}

function stop() {
  clearInterval(timer);
  timer = null;
  $("play").textContent = "Play year";
}

function draw() {
  if (!controls.checkValidity()) {
    stop(); stopTargetMotion(); exposurePair = null; displayedTargetShift = null;
    svg.replaceChildren();
    for (const id of ["epoch","earth","offset","range","scale"]) $(id).textContent = "—";
    $("status").textContent = "Enter valid coordinates, distance and reference date to calculate the simulation.";
    $("align-frames").disabled = true;
    return;
  }
  $("status").textContent = "";
  const epoch = $("date").valueAsNumber / 86400000 + 40587, day = $("day").valueAsNumber;
  const model = orbitScene($("ra").valueAsNumber, $("dec").valueAsNumber, $("distance").valueAsNumber, epoch, day);
  const educational = $("mode").value === "educational";
  const target = educational ? model.reference.map((x,i) => x + 3 * model.direction[i]) : model.target;
  if (lastEpoch !== epoch) {
    orbit = Array.from({length:181}, (_,i) => earthPositionAU(epoch + 365.25 * i / 180));
    lastEpoch = epoch;
  }
  const view = p => cameraPoint(p, $("az").valueAsNumber, $("el").valueAsNumber);
  const bounds = [...orbit, target, [0,0,0]].map(view);
  const xs = bounds.map(p => p[0]), ys = bounds.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const pixelsPerAU = Math.min(530 / (maxX-minX || 1), 270 / (maxY-minY || 1));
  const project = point => {
    const [x,y] = view(point);
    return [350 + (x - (minX+maxX)/2) * pixelsPerAU, 200 - (y - (minY+maxY)/2) * pixelsPerAU];
  };
  const nodes = [];
  function shape(tag, attrs, content) {
    const el = document.createElementNS(svg.namespaceURI, tag);
    for (const [key,value] of Object.entries(attrs)) el.setAttribute(key,value);
    if (content) el.textContent = content;
    nodes.push(el);
  }
  function line(start, end, cls) {
    const [x1,y1] = project(start), [x2,y2] = project(end);
    shape("line", {x1,y1,x2,y2,class:cls});
  }
  function label(cx, cy, name) {
    shape("text", { x: Math.max(54, Math.min(cx, 646)), y: cy, "text-anchor": "middle" }, name);
  }
  function earth(pos, name, cls, dy) {
    const [cx, cy] = project(pos);
    shape("use", { href: "#earth-symbol", x: cx - 14, y: cy - 14, width: 28, height: 28, class: cls });
    label(cx, cy + dy, name);
  }
  shape("polyline", { points: orbit.map(p => project(p).join(",")).join(" "), class: "orbit" });
  const [sunX, sunY] = project([0, 0, 0]);
  shape("circle", { cx: sunX, cy: sunY, r: 58, fill: "url(#sun-glow)" });
  line(model.reference, target, "reference");
  line(model.observer, target, "sight");
  shape("circle", { cx: sunX, cy: sunY, r: 21, fill: "url(#sun-surface)" });
  label(sunX, sunY + 41, "Sun");
  const [refX, refY] = project(model.reference);
  const [obsX, obsY] = project(model.observer);
  const overlap = Math.hypot(refX - obsX, refY - obsY) < 32;
  if (!overlap) earth(model.reference, "Reference Earth", "reference-earth", -22);
  earth(model.observer, overlap ? "Earth · both views" : "Observer Earth", "observer-earth", 30);
  // The spacecraft marker is deliberately much larger than the actual low-Earth orbit on this AU diagram.
  shape("circle", { cx: obsX, cy: obsY, r: 25, class: "spherex-orbit" });
  const side = obsX > 535 ? -1 : 1;
  const craftX = obsX + side * 23, craftY = obsY - 15;
  shape("use", { href: "#spherex-symbol", x: craftX - 15, y: craftY - 15, width: 30, height: 30 });
  shape("text", { x: craftX + side * 18, y: craftY - 13, "text-anchor": side === 1 ? "start" : "end", class: "spherex-label" }, "SPHEREx");
  const [targetX, targetY] = project(target);
  shape("circle", { cx: targetX, cy: targetY, r: 15, fill: "url(#target-glow)" });
  shape("circle", { cx: targetX, cy: targetY, r: 3, fill: "#f5f8ff" });
  label(targetX, targetY - 17, "Target");
  svg.replaceChildren(...nodes);
  $("day-label").value = String(day);
  $("epoch").textContent = new Date((epoch + day - 40587) * 86400000).toISOString().slice(0,10);
  $("earth").textContent = model.observer.map(v => v.toFixed(3)).join(" / ");
  const offsetDigits = $("distance").valueAsNumber >= 1000 ? 1 : 0;
  $("offset").textContent = [model.offset.east,model.offset.north].map(v => `${v.toFixed(offsetDigits)}″`).join(" / ");
  $("range").textContent = model.range.toFixed(3) + " AU";
  $("scale").textContent = educational
    ? "Target distance compressed to 3 AU in the drawing. The readouts use the entered distance. Amber dashed line marks the reference date. Teal marks the observer date."
    : `Uniform spatial scale · 100 drawing units = ${(100 / pixelsPerAU).toPrecision(3)} AU. Body markers are enlarged. Amber dashed line marks the reference date. Teal marks the observer date.`;
  paintSyntheticFrames(model, day);
}
for (const button of document.querySelectorAll("[data-sim-day]")) {
  button.addEventListener("click", () => {
    stop();
    $("day").value = button.dataset.simDay;
    draw();
  });
}
$("align-frames").addEventListener("click", () => {
  if (!controls.reportValidity()) return;
  registered = !registered;
  draw();
});
controls.addEventListener("submit", e => e.preventDefault());
controls.addEventListener("input", draw);
$("play").addEventListener("click", () => {
  if (timer) { stop(); return; }
  if (!controls.reportValidity()) return;
  if ($("day").valueAsNumber === 365) $("day").value = "0";
  $("play").textContent = "Pause";
  timer = setInterval(() => {
    $("day").value = String(Math.min(365, $("day").valueAsNumber + 1));
    draw();
    if ($("day").valueAsNumber === 365) stop();
  }, 75);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stop(); stopTargetMotion();
    if (desiredTargetShift) {
      displayedTargetShift = { ...desiredTargetShift };
      redrawSyntheticExposures();
    }
  }
});
window.addEventListener("pagehide", () => { stop(); stopTargetMotion(); });
draw();
