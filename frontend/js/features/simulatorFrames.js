// Educational synthetic exposures for the standalone simulator.
// Only the apparent displacement comes from orbitScene's parallax model.
// Field stars, pointing jitter and image pixels are illustrative, not SPHEREx observations.
export const FRAME_WIDTH = 320;
export const FRAME_HEIGHT = 200;
export const POINTING_JITTER = Object.freeze({ x: 11, y: -7 });
export const MONTH_PRESETS = Object.freeze([{ day: 0, label: "Month 0" }, { day: 183, label: "Month 6" }, { day: 365, label: "Month 12" }]);

export function syntheticStars() {
  let seed = 43971;
  const next = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const stars = [];
  for (let i = 0; i < 46; i++) {
    const x = 14 + next() * (FRAME_WIDTH - 28);
    const y = 14 + next() * (FRAME_HEIGHT - 28);
    // Leave an uncluttered window for the highlighted hypothetical target.
    if (Math.hypot(x - 160, y - 100) < 29) continue;
    stars.push({ x, y, radius: 0.7 + next() * 1.1, brightness: 0.35 + next() * 0.6 });
  }
  return stars;
}

export function targetShiftPixels(offset, distanceAU) {
  if (!Number.isFinite(distanceAU) || distanceAU <= 0 ||
      !Number.isFinite(offset?.east) || !Number.isFinite(offset?.north)) return { x: 0, y: 0 };
  // Exaggerate the actual arcsecond parallax to show it at small screen sizes.
  // The same scale is used at every epoch for a given target distance.
  const fullSixMonthSwing = 2 * 206264.806 / distanceAU;
  // A modest illustrative displacement keeps the movement easy to follow.
  const pixelsPerArcsec = 24 / fullSixMonthSwing;
  return { x: offset.east * pixelsPerArcsec, y: -offset.north * pixelsPerArcsec };
}

export function exposureGeometry(offset, distanceAU, alignOnStars = false) {
  const shift = targetShiftPixels(offset, distanceAU);
  const jitter = alignOnStars ? { x: 0, y: 0 } : POINTING_JITTER;
  return {
    stars: { x: jitter.x, y: jitter.y },
    target: { x: 160 + jitter.x + shift.x, y: 100 + jitter.y + shift.y },
    relativeTargetShift: shift,
  };
}

// Exponential easing toward the latest model position. A frame-time-based step
// makes target motion smooth without modifying the parallax calculation.
export function easeTargetShift(current, desired, deltaMs) {
  const dt = Math.max(0, Math.min(64, Number.isFinite(deltaMs) ? deltaMs : 0));
  const mix = 1 - Math.exp(-dt / 230);
  return { x: current.x + (desired.x - current.x) * mix,
    y: current.y + (desired.y - current.y) * mix };
}
