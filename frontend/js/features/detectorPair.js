const panel = document.getElementById("detector-pair");
const panes = [...panel.querySelectorAll("figure")];
let observations = [];

function render(pane) {
  const frame = observations[pane.querySelector("select").selectedIndex];
  if (!frame || !panel.open) return;
  const image = pane.querySelector("img");
  image.alt = `${frame.detector} cutout at ${frame.dateISO}`;
  image.src = frame.imageUrl;
  const flags = frame.flags ? `${(frame.flags.fractionFlagged * 100).toFixed(1)}% flagged` : "flag coverage unavailable";
  pane.querySelector("figcaption").textContent = `${frame.wavelengthMinUm.toFixed(2)}–${frame.wavelengthMaxUm.toFixed(2)} µm · ${flags}`;
}
for (const pane of panes) {
  pane.querySelector("select").addEventListener("change", () => render(pane));
  pane.querySelector("img").addEventListener("error", () => {
    pane.querySelector("figcaption").textContent = "Could not load this cutout.";
  });
}
panel.addEventListener("toggle", () => panes.forEach(render));

export function setComparisonFrames(frames) {
  observations = frames;
  panel.hidden = frames.length < 2;
  for (const [index, pane] of panes.entries()) {
    pane.querySelector("img").removeAttribute("src");
    pane.querySelector("figcaption").textContent = "";
    const selector = pane.querySelector("select");
    selector.replaceChildren(...frames.map((f, i) => new Option(`${f.detector} · ${f.dateISO}`, i)));
    if (!frames.length) continue;
    const other = frames.findIndex(f => f.detector !== frames[0].detector);
    selector.selectedIndex = index === 0 ? 0 : other >= 0 ? other : frames.length - 1;
    render(pane);
  }
}
