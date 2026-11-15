import { strict as assert } from "node:assert";
import { FIELD_DETECTOR_IDS, fieldRequestCardRows } from "../frontend/js/features/fieldRequestCards.js";

const frames = [
  { detector: "D2", imageUrl: "/d2.png" },
  { detector: "D2", imageUrl: "/d2-later.png" },
  { detector: "D5", imageUrl: "/d5.png" },
];
const rows = fieldRequestCardRows({ detectors: {
  D1: { status: "queued", progress: 0 },
  D2: { status: "ready", phase: "ready", progress: 1, frameCount: 2 },
  D3: { status: "downloading", phase: "download", progress: 0.5, completedFiles: 6, totalFiles: 12 },
  D4: { status: "failed", progress: 0.3, error: "Archive request failed" },
  D5: { status: "ready", progress: 1 },
} }, frames);

assert.deepEqual(rows.map((row) => row.detector), FIELD_DETECTOR_IDS);
assert.equal(rows[0].status, "queued");
assert.equal(rows[0].canSelect, false);
assert.equal(rows[0].progress, 0);
assert.equal(rows[0].totalFiles, null);
assert.equal(rows[0].frameCount, null);
assert.equal(rows[1].canSelect, true);
assert.equal(rows[1].frames.length, 2);
assert.equal(rows[2].completedFiles, 6);
assert.equal(rows[2].totalFiles, 12);
assert.equal(rows[2].progress, 0.5);
assert.equal(rows[3].error, "Archive request failed");
assert.equal(rows[4].canSelect, true);
assert.equal(rows[5].status, "waiting");
assert.equal(rows[5].progress, null);
assert.equal(rows[5].canSelect, false);
assert.equal(rows[5].completedFiles, null);

const clamped = fieldRequestCardRows({ detectors: { D1: { status: "processing", progress: 3 } } })[0];
assert.equal(clamped.progress, 1);
console.log("field request cards show all six backend states without inventing progress");
