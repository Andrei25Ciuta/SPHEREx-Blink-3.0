import assert from "node:assert/strict";
import { candidatesToJson } from "../frontend/js/features/export.js";
import { importDataset } from "../frontend/js/features/candidateEvidence.js";

const candidate = {
  label: "#1", ra: 269.4462, dec: 4.769, mjdRef: 60908.981929,
  speedArcsecPerYear: 10.4, pmEastArcsecPerYear: -0.8, pmNorthArcsecPerYear: 10.35,
  positionAngleDeg: 355, nDet: 3, nFrames: 3, significance: 13,
  rms: 0.2, known: "Barnard's Star", distant: null, asteroids: [],
  frameIds: ["D2@60908.981929", "D2@61114.099563", "D2@61273.515"],
  fitPoints: [{ frame: 0, x: 50.25, y: 51.5 }, { frame: 1, x: 50.75, y: 52 },
    { frame: 2, x: 51.25, y: 52.5 }],
};
const ctx = { isReal: true, detector: "D2", query: { ra: 269.4462, dec: 4.769, fov: 5 },
  permalink: "https://example.org/index.html?ra=269.4462&dec=4.769&fov=5&det=D2" };
const exported = JSON.parse(candidatesToJson([candidate], ctx, { generated: "2026-11-08T00:00:00Z" }));
assert.equal(exported.candidates[0].fit_centroids.length, 3);
assert.deepEqual(exported.candidates[0].search_frames, candidate.frameIds);
const imported = importDataset(exported, "candidate.json");
assert.equal(imported.rows[0].samples.length, 3);
assert.equal(imported.rows[0].samples[1].key, candidate.frameIds[1]);
assert.match(imported.rows[0].link, /data=api/);
console.log("Candidate evidence export and import passed");
