import { SIZE, LABELS, demoComparison } from "./colourBlink.js";

const section = document.querySelector("#colour-blink");
const canvas = section.querySelector("canvas");
const ctx = canvas.getContext("2d");
const tile = document.createElement("canvas");
tile.width = tile.height = SIZE;
const tileCtx = tile.getContext("2d");
const step = section.querySelector("#colour-blink-step");
const centres = section.querySelector("#colour-blink-centres");
const status = section.querySelector("#colour-blink-status");
const shifts = section.querySelector("#colour-blink-shifts");
const captions = {
  wavelength: ["Short band · same date", "Long band · same date"],
  date: ["First date · short band", "Second date · short band"],
};
let axis = "wavelength";
let frame = 0;
let comparison = demoComparison(axis);

function draw() {
  const width = canvas.width / LABELS.length;
  const styles = getComputedStyle(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  comparison.frames[frame].forEach(({ pixels, centre }, i) => {
    const image = tileCtx.createImageData(SIZE, SIZE);
    for (let k = 0; k < pixels.length; k++) {
      const shade = Math.min(255, 12 + 243 * Math.sqrt(pixels[k]));
      image.data.set([shade, shade, shade, 255], 4 * k);
    }
    tileCtx.putImageData(image, 0, 0);
    const left = i * width + 2;
    const side = width - 4;
    const top = (canvas.height - side) / 2;
    ctx.drawImage(tile, left, top, side, side);
    if (centres.checked) {
      const x = left + (centre.x + 0.5) * side / SIZE;
      const y = top + (centre.y + 0.5) * side / SIZE;
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.strokeStyle = styles.getPropertyValue("--bg");
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = styles.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });
  status.textContent = captions[axis][frame];
}

function formatShift(value) {
  if (Math.abs(value) < 0.005) return "0.00 px";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(2)} px`;
}

function drawTable() {
  shifts.replaceChildren(...LABELS.map((name, i) => {
    const row = document.createElement("tr");
    const label = document.createElement("th");
    label.scope = "row";
    label.textContent = name;
    row.append(label);
    row.insertCell().textContent = formatShift(comparison.measured[i]);
    row.insertCell().textContent = formatShift(comparison.corrected[i]);
    return row;
  }));
}

step.addEventListener("click", () => {
  frame = 1 - frame;
  draw();
});
centres.addEventListener("change", draw);
section.querySelectorAll('input[name="colour-blink-axis"]').forEach(input => {
  input.addEventListener("change", () => {
    axis = input.value;
    frame = 0;
    comparison = demoComparison(axis);
    draw();
    drawTable();
  });
});
draw();
drawTable();
