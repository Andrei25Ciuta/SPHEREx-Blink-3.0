// How long does a search take as the field grows? Synthetic images, so the numbers are about the code, not about the sky.   Run: node scratch/measure_search_cost.mjs
import { findMoversInImages, detectSources } from "../frontend/js/features/movers.js";
import { mulberry32, renderStar } from "./lib_inject.mjs";

const rows = [];
for (const n of [49, 100, 200, 293]) for (const frames of [6, 18, 40]) {
  const rng = mulberry32(5), area = n * n, nStars = Math.round(area / 170);       // about the star density of the 49 px cutouts (14 per 2401 px)
  const fixed = Array.from({ length: nStars }, () => ({ x: 6 + rng() * (n - 12), y: 6 + rng() * (n - 12), flux: 60 + rng() * 300 }));
  const days = Array.from({ length: frames }, (_, k) => Math.floor(k / 6) * 120 + (k % 6) * 0.1);
  const imgs = days.map((d) => ({ mjd: 60908 + d, grey: renderStar(n, 0, 0, 0, 0.4, rng, { noise: 1, extra: fixed }) }));
  const t0 = performance.now();
  findMoversInImages(imgs, n, { sigmaFloor: 1e-9, register: false });
  const ms = performance.now() - t0;
  rows.push({ n, frames, pixels: n * n * frames, stars: nStars, ms: Math.round(ms), nsPerPixel: Math.round((ms * 1e6) / (n * n * frames)) });
}
console.log("| side (px) | images | pixels | stars | search time (ms) | ns per pixel |\n|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.n} | ${r.frames} | ${r.pixels} | ${r.stars} | ${r.ms} | ${r.nsPerPixel} |`);
