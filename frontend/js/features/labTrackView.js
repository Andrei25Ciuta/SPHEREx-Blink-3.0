import { mulberry32 } from "../data/mockSource.js";

export function drawTrack(plot, points, size, active = -1) {
  const minX = Math.min(0, ...points.map(p => p.x));
  const minY = Math.min(0, ...points.map(p => p.y));
  const span = Math.max(size - minX, size - minY,
    ...points.map(p => Math.max(p.x - minX, p.y - minY)));
  const project = p => [24 + 372 * (p.x - minX) / span, 24 + 372 * (p.y - minY) / span];
  const shape = (tag, attributes) => {
    const node = document.createElementNS(plot.namespaceURI, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    plot.append(node);
    return node;
  };
  plot.replaceChildren();
  const [x, y] = project({ x: 0, y: 0 });
  shape("rect", { x, y, width: 372 * size / span, height: 372 * size / span, class: "recovery-boundary" });
  // Keep the illustrative stars stationary when switching trials.
  const random = mulberry32(1365);
  for (let i = 0; i < 156; i++) {
    const [cx, cy] = project({ x: size * (.025 + .95 * random()), y: size * (.025 + .95 * random()) });
    const brightness = random() ** 3;
    if (brightness > .72) {
      shape("circle", { cx, cy, r: 4.2, class: "recovery-star", opacity: .10, "aria-hidden": "true" });
    }
    shape("circle", { cx, cy, r: .45 + 1.65 * brightness,
      class: "recovery-star", opacity: .16 + .58 * brightness, "aria-hidden": "true" });
  }
  shape("polyline", { points: points.map(p => project(p).join(",")).join(" "), class: "recovery-line" });
  points.forEach((point, i) => {
    const [cx, cy] = project(point);
    const dot = shape("circle", { cx, cy, r: i === active ? 6 : 3.5, class: i === active ? "recovery-point current" : "recovery-point" });
    const title = document.createElementNS(plot.namespaceURI, "title");
    title.textContent = point.dateISO;
    dot.append(title);
  });
}

/** Supporting detections, in observation order and in the registered image plane. */
export function candidateTrackPoints(candidate) {
  return (candidate?.dots ?? []).map((p, i) => ({ x: p.x, y: p.y, mjd: candidate.dotDates?.[i] }))
    .filter(p => [p.x, p.y, p.mjd].every(Number.isFinite))
    .sort((a, b) => a.mjd - b.mjd);
}

export function datedTrackPoints(points) {
  return points.map(p => ({
    ...p, dateISO: new Date((p.mjd - 40587) * 86400000).toISOString(),
  }));
}
