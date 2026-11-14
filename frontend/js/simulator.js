import { earthPositionAU } from "./features/parallax.js";
import { orbitScene, cameraPoint } from "./features/orbitScene.js";

const $ = id => document.getElementById(id);
const svg = $("scene-bodies"), controls = $("controls");
let timer, lastEpoch, orbit;

function stop() {
  clearInterval(timer);
  timer = null;
  $("play").textContent = "Play year";
}

function draw() {
  if (!controls.checkValidity()) {
    stop(); svg.replaceChildren();
    for (const id of ["epoch","earth","offset","range","scale"]) $(id).textContent = "—";
    $("status").textContent = "Enter valid coordinates, distance and reference date to calculate the simulation.";
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
}
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
document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
window.addEventListener("pagehide", stop);
draw();
