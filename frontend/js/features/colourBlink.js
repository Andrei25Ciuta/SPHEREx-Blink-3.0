// Illustrative, coarsely sampled cutouts. Each tile uses the same symmetric PSF.
export const SIZE = 40;
const CENTRE = (SIZE - 1) / 2;
const PSF_SIGMA = 2.4;
export const LABELS = ["Fixed pair", "Moving source", "Reference star"];

function renderTile(sources, offset) {
  const pixels = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      for (const [sourceX, flux] of sources) {
        const radiusSquared = (x - CENTRE - sourceX - offset) ** 2 + (y - CENTRE) ** 2;
        pixels[y * SIZE + x] += flux * Math.exp(-radiusSquared / (2 * PSF_SIGMA ** 2));
      }
    }
  }
  return pixels;
}

export function centroid(pixels) {
  let flux = 0;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < pixels.length; i++) {
    const value = pixels[i];
    flux += value;
    sumX += value * (i % SIZE);
    sumY += value * Math.floor(i / SIZE);
  }
  return { x: sumX / flux, y: sumY / flux };
}

export function demoComparison(axis) {
  const wavelength = axis === "wavelength";
  const reference = [[0, 1]];
  const shortBand = [[-1.5, 0.85], [1.5, 0.15]];
  const longBand = [[-1.5, 0.15], [1.5, 0.85]];
  const scenes = [
    [shortBand, [[-3, 1]], reference],
    [wavelength ? longBand : shortBand, [[wavelength ? -3 : 3, 1]], reference],
  ];
  const frames = scenes.map((scene, i) => scene.map(sources => {
    const pixels = renderTile(sources, i * 0.6);
    return { pixels, centre: centroid(pixels) };
  }));
  const measured = frames[1].map(({ centre }, i) => centre.x - frames[0][i].centre.x);
  const referenceShift = measured.at(-1);
  return { frames, measured, corrected: measured.map(dx => dx - referenceShift) };
}
