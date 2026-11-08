import { earthPositionAU } from "./features/parallax.js";
import { orbitScene, cameraPoint } from "./features/orbitScene.js";

const $ = id => document.getElementById(id);
const svg = $("scene"), controls = $("controls");
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
  function body(pos, name, cls, radius, dy) {
    const [cx,cy] = project(pos);
    shape("circle", {cx,cy,r:radius,class:cls});
    shape("text", {x:Math.max(10,Math.min(cx+8,585)),y:cy+dy},name);
  }
  shape("polyline",{points:orbit.map(p=>project(p).join(",")).join(" "),class:"orbit"});
  line(model.reference,target,"reference"); line(model.observer,target,"sight");
  body([0,0,0],"Sun","sun",5,19);
  body(model.observer,"Earth","model",4,-11);
  body(target,"Target","model",5,-11);
  svg.replaceChildren(...nodes);
  $("day-label").value = String(day);
  $("epoch").textContent = new Date((epoch + day - 40587) * 86400000).toISOString().slice(0,10);
  $("earth").textContent = model.observer.map(v => v.toFixed(5)).join(" / ");
  $("offset").textContent = [model.offset.east,model.offset.north].map(v => `${v.toFixed(2)}″`).join(" / ");
  $("range").textContent = model.range.toFixed(4) + " AU";
  $("scale").textContent = educational
    ? "Target distance compressed to 3 AU in the drawing. The readouts use the entered distance. Dashed line shows the reference sightline."
    : `Uniform spatial scale · 100 drawing units = ${(100 / pixelsPerAU).toPrecision(3)} AU. Body markers are enlarged. Dashed line shows the reference sightline.`;
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
