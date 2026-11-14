import { blindCheckCandidate } from "../frontend/js/features/blindCheck.js";

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
const n = 25;
function frameAt(x, y, flux = 20) {
  const a = new Float32Array(n * n);
  for (let py = 0; py < n; py++) for (let px = 0; px < n; px++) {
    a[py * n + px] = flux * Math.exp(-((px + 0.5 - x) ** 2 + (py + 0.5 - y) ** 2) / 2);
  }
  return a;
}
const mjds = [60000, 60200, 60400, 60600, 60800];
const positions = mjds.map((mjd) => ({ x: 8 + (mjd - 60000) / 2000, y: 10 + (mjd - 60000) / 4000 }));
const frames = mjds.map((mjd, frame) => ({ id: `D2@${mjd}`, mjd }));
const candidate = { points: positions.map((p, frame) => ({ frame, ...p })), frameIds: frames.map((f) => f.id), shifts: frames.map(() => ({ dx: 0, dy: 0 })) };
const bright = positions.map((p) => frameAt(p.x, p.y));
const positive = blindCheckCandidate(candidate, frames, bright, n);
check("leave-one-image-out confirms a coherent source in every held-out image", positive.checked === 5 && positive.supported === 5 && positive.images.every((x) => x.trainingDetections === 4));
const absent = bright.map((a, i) => i === 2 ? new Float32Array(n * n) : a);
const negative = blindCheckCandidate(candidate, frames, absent, n);
check("a missing held-out source is not counted as supported", negative.checked === 5 && negative.supported === 4);
const tooFew = blindCheckCandidate({ ...candidate, points: candidate.points.slice(0, 3) }, frames, bright, n);
check("too few independent detections are reported as insufficient evidence", tooFew.checked === 0 && tooFew.reason === "needs at least 4 detections across 4 survey passes");
{
  const duplicateFrames = [60000, 60000, 60200, 60400, 60600].map((mjd) => ({ id: `D2@${mjd}`, mjd }));
  const duplicatePositions = duplicateFrames.map((f) => ({ x: 8 + (f.mjd - 60000) / 2000, y: 10 + (f.mjd - 60000) / 4000 }));
  const duplicateCandidate = { points: duplicatePositions.map((p, frame) => ({ frame, ...p })), frameIds: duplicateFrames.map((f) => f.id), shifts: duplicateFrames.map(() => ({ dx: 0, dy: 0 })) };
  const duplicateArrays = duplicatePositions.map((p, i) => i === 1 ? new Float32Array(n * n) : frameAt(p.x, p.y));
  const result = blindCheckCandidate(duplicateCandidate, duplicateFrames, duplicateArrays, n);
  check("duplicate detector/time IDs retain their distinct image indices", result.images.map((x) => x.frame).join(",") === "0,1,2,3,4" && result.checked === 5);
  check("same-time duplicate is held out with its partner, so it cannot leak into the fit", result.images.find((x) => x.frame === 1)?.supported === false && result.supported === 4);
}
if (failed) process.exitCode = 1;
