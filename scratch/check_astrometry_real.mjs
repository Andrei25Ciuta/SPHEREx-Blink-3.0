// Are the REPORTED errors right on REAL SPHEREx images? Two checks, both with the pixels of the six real fields (docs/VALIDATION.md §15).
//
//   1. positions   Fixed stars (a dot at the same place in at least 6 images, after the registration of the exposures): how far is each dot from the
//                  mean position of its star, compared with the error the model gives it (centroidSigmaPx of its S/N)? z = residual / error, and the
//                  systematic floor s that would make the model right:  s^2 = mean(residual^2 * m/(m-1) - sigma^2).
//   2. apertures   Empty sky: apertureSnr (r = 2) at random places far from every dot: flux / reported error must have a spread of 1.
//
// Needs a backend that serves only the real files (SPHEREX_DATA_DIR=backend/data/real, port 8003: "backend-real" in .claude/launch.json). No download.
//   node scratch/check_astrometry_real.mjs [--api http://localhost:8003] [--json out.json]

import { detectSources, registerShifts, apertureSnr, centroidSigmaPx, MASKED_FIT_SIGMA_PX } from "../frontend/js/features/movers.js";
import { linkStaticSources } from "../frontend/js/features/discovery.js";
import { loadField, parseArgs, mulberry32 } from "./lib_real.mjs";
import { writeFileSync } from "node:fs";

const FIELDS = [
  { name: "Barnard D2", ra: 269.4462, dec: 4.769, det: "D2" }, { name: "Barnard D6", ra: 269.4462, dec: 4.769, det: "D6" },
  { name: "Epsilon Indi B D2", ra: 331.0965, dec: -56.8006, det: "D2" }, { name: "Epsilon Indi B D6", ra: 331.0965, dec: -56.8006, det: "D6" },
  { name: "WISE 0855 D2", ra: 133.7598, dec: -7.2422, det: "D2" }, { name: "WISE 0855 D6", ra: 133.7598, dec: -7.2422, det: "D6" },
];
const FOV = 5;
const args = parseArgs();
const api = args.api ?? "http://localhost:8003";
const sd = (v) => { const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length - 1)); };
// a robust scale (1.4826 x the median absolute deviation): faint sources below the detection threshold and the wings of bright stars put real flux into some "empty" apertures, which the plain sd counts as noise
const robustSd = (v) => { const s = [...v].sort((a, b) => a - b), med = s[Math.floor(s.length / 2)]; const d = s.map((x) => Math.abs(x - med)).sort((a, b) => a - b); return 1.4826 * d[Math.floor(d.length / 2)]; };
const rmsOf = (v) => Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length);

const all = { positions: [], apertures: [] };
const rows = [];
for (const fld of FIELDS) {
  const f = await loadField(api, fld.ra, fld.dec, FOV, fld.det);
  const { n } = f, N = f.frames.length;
  // ---------------------------------------------------------------- 1. positions of fixed stars
  const dots = f.arrays.map((a, k) => detectSources(a, n, { sigmaFloor: 1e-9, mask: f.masks[k] }));
  const reg = registerShifts(dots.map((s, k) => ({ mjd: f.frames[k].mjd, sources: s })));
  const shifts = reg.map((s) => (Math.abs(s.dx) > 0.05 || Math.abs(s.dy) > 0.05 ? s : { dx: 0, dy: 0 }));
  const corrected = dots.map((list, k) => list.map((d) => ({ ...d, x: d.x - shifts[k].dx, y: d.y - shifts[k].dy })));
  const clusters = linkStaticSources(corrected, { radiusPx: 1.2, minDetections: 6 });
  // linkStaticSources keeps only x, y, snr of members: look the error up again from the dot that gave each member
  const sigmaOf = (frame, x, y) => { const d = corrected[frame].find((q) => Math.abs(q.x - x) < 1e-9 && Math.abs(q.y - y) < 1e-9); return d?.sigmaPx ?? centroidSigmaPx(d?.snr ?? 0); };
  const posRows = [];
  const years = f.frames.map((fr) => fr.mjd / 365.25);
  for (const c of clusters) {
    const m = c.members.length;
    const sig = c.members.map((q) => sigmaOf(q.frame, q.x, q.y));
    if (sig.some((s) => s >= MASKED_FIT_SIGMA_PX - 1e-9 && s > centroidSigmaPx(c.members[0].snr) * 1.5)) continue;     // a star positioned by the masked fit: outside the model
    // a star that MOVES (Epsilon Indi B moves 0.77 px/yr, inside the 1.2 px linking radius) is not a fixed star: its straight-line trend is removed from the test
    const tt = c.members.map((q) => years[q.frame]), tm0 = tt.reduce((s, v) => s + v, 0) / m, sxx0 = tt.reduce((s, v) => s + (v - tm0) ** 2, 0);
    const mx0 = c.members.reduce((s, q) => s + q.x, 0) / m, my0 = c.members.reduce((s, q) => s + q.y, 0) / m;
    const vx0 = sxx0 > 0 ? c.members.reduce((s, q, i) => s + (tt[i] - tm0) * (q.x - mx0), 0) / sxx0 : 0, vy0 = sxx0 > 0 ? c.members.reduce((s, q, i) => s + (tt[i] - tm0) * (q.y - my0), 0) / sxx0 : 0;
    const sigRms = Math.sqrt(sig.reduce((s, v) => s + v * v, 0) / m), vErr0 = sxx0 > 0 ? sigRms / Math.sqrt(sxx0) : Infinity;
    if (Math.hypot(vx0, vy0) > 5 * vErr0 && Math.hypot(vx0, vy0) * Math.sqrt(sxx0) > 0.1) { console.log(`  (left out: a star that moves ${(Math.hypot(vx0, vy0) * 6.14).toFixed(1)}"/yr at S/N ${c.members[0].snr.toFixed(0)})`); continue; }
    const mx = mx0, my = my0;
    c.members.forEach((q, i) => {
      const k = Math.sqrt(m / (m - 1));                                      // a residual about the sample mean has variance sigma^2 (1 - 1/m)
      posRows.push({ snr: q.snr, sigma: sig[i], zx: ((q.x - mx) * k) / sig[i], zy: ((q.y - my) * k) / sig[i], rx: (q.x - mx) * k, ry: (q.y - my) * k, m });
    });
    if (args.verbose && c.members[0].snr >= 20) {
      const res = c.members.flatMap((q) => [(q.x - mx) * Math.sqrt(m / (m - 1)), (q.y - my) * Math.sqrt(m / (m - 1))]);
      console.log(`    star at (${mx.toFixed(1)}, ${my.toFixed(1)}): ${m} dots, median S/N ${[...c.members.map((q) => q.snr)].sort((a, b) => a - b)[Math.floor(m / 2)].toFixed(0)}, model ${sigRms.toFixed(3)} px, rms residual ${rmsOf(res).toFixed(3)} px`);
    }
  }
  all.positions.push(...posRows);
  const z = posRows.flatMap((r) => [r.zx, r.zy]);
  const s2 = posRows.flatMap((r) => [r.rx ** 2 - r.sigma ** 2, r.ry ** 2 - r.sigma ** 2]);
  const sFloor = Math.sqrt(Math.max(0, s2.reduce((a, b) => a + b, 0) / s2.length));
  // ---------------------------------------------------------------- 2. empty-sky apertures
  const rng = mulberry32(4242 + N), zs = [];
  for (let k = 0; k < N; k++) {
    for (let t = 0, got = 0; t < 4000 && got < 150; t++) {
      const x = 9 + rng() * (n - 18), y = 9 + rng() * (n - 18);
      if (dots[k].some((d) => Math.hypot(d.x - x, d.y - y) < 6)) continue;
      const a = apertureSnr(f.arrays[k], n, x, y, 2);
      if (!a || !Number.isFinite(a.err) || a.err <= 0) continue;
      zs.push(a.flux / a.err); got++;
    }
  }
  all.apertures.push(...zs);
  rows.push({ field: fld.name, images: N, stars: clusters.length, dotsUsed: posRows.length, positionZ: z.length ? sd(z) : null, systematicFloorPx: z.length ? sFloor : null, rmsResidualPx: posRows.length ? rmsOf(posRows.flatMap((r) => [r.rx, r.ry])) : null, apertures: zs.length, apertureZsd: sd(zs), apertureZrobust: robustSd(zs) });
  const r = rows.at(-1);
  console.log(`${fld.name}: ${N} images, ${clusters.length} fixed stars (${posRows.length} dots)  position z sd ${r.positionZ?.toFixed(2)}, floor ${r.systematicFloorPx?.toFixed(3)} px, rms ${r.rmsResidualPx?.toFixed(3)} px;  empty apertures ${zs.length}: sd(flux/err) ${r.apertureZsd.toFixed(2)}, robust ${r.apertureZrobust.toFixed(2)}`);
}

// ---------------------------------------------------------------- pooled
const zAll = all.positions.flatMap((r) => [r.zx, r.zy]);
const bins = [[3, 8], [8, 20], [20, 60], [60, 1e9]];
console.log(`\nPooled positions: ${all.positions.length} dots; sd(z) = ${sd(zAll).toFixed(2)}; within 1 sigma ${(zAll.filter((z) => Math.abs(z) < 1).length / zAll.length * 100).toFixed(0)} %, within 2 sigma ${(zAll.filter((z) => Math.abs(z) < 2).length / zAll.length * 100).toFixed(0)} %`);
console.log("| dot S/N | dots | model sigma (px) | rms residual (px) | sd(z) | floor needed (px) |\n|---|---|---|---|---|---|");
for (const [lo, hi] of bins) {
  const sel = all.positions.filter((r) => r.snr >= lo && r.snr < hi);
  if (sel.length < 6) continue;
  const zz = sel.flatMap((r) => [r.zx, r.zy]), res = sel.flatMap((r) => [r.rx, r.ry]), sg = sel.flatMap((r) => [r.sigma, r.sigma]);
  const fl = Math.sqrt(Math.max(0, res.reduce((a, b, i) => a + b * b - sg[i] ** 2, 0) / res.length));
  console.log(`| ${lo}-${hi > 1e8 ? "∞" : hi} | ${sel.length} | ${rmsOf(sg).toFixed(3)} | ${rmsOf(res).toFixed(3)} | ${sd(zz).toFixed(2)} | ${fl.toFixed(3)} |`);
}
const sAll = all.positions.flatMap((r) => [r.rx ** 2 - r.sigma ** 2, r.ry ** 2 - r.sigma ** 2]);
console.log(`systematic floor over all: ${Math.sqrt(Math.max(0, sAll.reduce((a, b) => a + b, 0) / sAll.length)).toFixed(3)} px`);
console.log(`Pooled empty-sky apertures: ${all.apertures.length}; robust sd(flux/err) = ${robustSd(all.apertures).toFixed(2)} (plain sd ${sd(all.apertures).toFixed(2)}); within 1 sigma ${(all.apertures.filter((z) => Math.abs(z) < 1).length / all.apertures.length * 100).toFixed(0)} %, within 2 sigma ${(all.apertures.filter((z) => Math.abs(z) < 2).length / all.apertures.length * 100).toFixed(0)} %`);
if (args.json && args.json !== "1") writeFileSync(args.json, JSON.stringify({ rows, pooled: { positions: all.positions.length, positionZsd: sd(zAll), apertures: all.apertures.length, apertureZsd: sd(all.apertures) } }, null, 1));
