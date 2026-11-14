// Keep wavelength comparisons within one survey pass and the active timeline filters.
import { midWavelength, surveyPasses } from "./timeline.js";

export function colourSequences(frames, activeIndices) {
  const active = new Set(activeIndices);
  return surveyPasses(frames).flatMap(pass => {
    const indices = pass.indices.filter(index => active.has(index))
      .sort((a, b) => midWavelength(frames[a]) - midWavelength(frames[b]));
    const first = frames[indices[0]];
    const last = frames[indices.at(-1)];
    return first && last && midWavelength(last) - midWavelength(first) > 1e-6
      ? [{ ...pass, indices }]
      : [];
  });
}

/** Local brightness centroid in display pixels. Reject weak, clipped and flagged apertures. */
export function lightCentre(pixels, size, point, mask = null) {
  if (!pixels || !Number.isFinite(point?.fx) || !Number.isFinite(point?.fy)) return null;
  const x = point.fx * size - 0.5, y = point.fy * size - 0.5;
  const radius = 2.5, outer = 5;
  if (x - outer < 0 || y - outer < 0 || x + outer >= size || y + outer >= size) return null;
  const sky = [], core = [];
  for (let iy = Math.ceil(y - outer); iy <= y + outer; iy++) {
    for (let ix = Math.ceil(x - outer); ix <= x + outer; ix++) {
      const distance = Math.hypot(ix - x, iy - y);
      const index = iy * size + ix;
      if (distance <= radius) {
        if (mask?.[index]) return null;
        core.push({ ix, iy, value: pixels[index] });
      } else if (distance >= 3.5 && distance <= outer && !mask?.[index]) {
        sky.push(pixels[index]);
      }
    }
  }
  if (sky.length < 12 || !core.length) return null;
  sky.sort((a, b) => a - b);
  const background = sky[Math.floor(sky.length / 2)];
  const noise = sky[Math.floor(sky.length * 0.84)] - background;
  const peak = Math.max(...core.map(pixel => pixel.value));
  if (peak - background < Math.max(8, 1.5 * noise)) return null;
  let weight = 0, sumX = 0, sumY = 0;
  for (const pixel of core) {
    const signal = Math.max(0, pixel.value - background);
    weight += signal;
    sumX += signal * (pixel.ix + 0.5);
    sumY += signal * (pixel.iy + 0.5);
  }
  const fx = sumX / weight / size, fy = sumY / weight / size;
  return { fx, fy, peak, background, offsetPx: Math.hypot(fx - point.fx, fy - point.fy) * size };
}
