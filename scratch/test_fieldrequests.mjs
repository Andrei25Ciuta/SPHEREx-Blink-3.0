import assert from "node:assert/strict";
import { fieldRequestComplete, followFieldRequest } from "../frontend/js/data/fieldRequests.js";

const detectors = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`D${index + 1}`, { status: "queued" }]));
assert.equal(fieldRequestComplete({ detectors }), false);
assert.equal(fieldRequestComplete({ detectors: Object.fromEntries(Object.keys(detectors).map(key => [key, { status: "unavailable" }])) }), true);

const statuses = [
  { requestId: "fr-test", status: "running", progress: 0.23, detectors },
  { requestId: "fr-test", status: "partial", progress: 0.42,
    detectors: { ...detectors, D1: { status: "ready" } } },
  { requestId: "fr-test", status: "ready", progress: 1,
    detectors: Object.fromEntries(Object.keys(detectors).map(key => [key, { status: "ready" }])) },
];
const observed = [];
const delays = [];
const final = await followFieldRequest({
  requestId: "fr-test",
  getStatus: async id => { assert.equal(id, "fr-test"); return statuses.shift(); },
  onStatus: status => observed.push(status),
  initialDelayMs: 2500,
  sleep: async delay => delays.push(delay),
});
assert.equal(final.status, "ready");
assert.deepEqual(observed.map(item => item.progress), [0.23, 0.42, 1]);
assert.deepEqual(delays, [2500, 2500]);

const retryDelays = [];
let calls = 0;
const recovered = await followFieldRequest({
  requestId: "fr-test",
  getStatus: async () => {
    calls++;
    if (calls === 1) throw new Error("temporary network failure");
    return { detectors: Object.fromEntries(Object.keys(detectors).map(key => [key, { status: "failed" }])) };
  },
  initialDelayMs: 2000,
  maxDelayMs: 9000,
  sleep: async delay => retryDelays.push(delay),
});
assert.equal(recovered.detectors.D6.status, "failed");
assert.deepEqual(retryDelays, [3400]);
console.log("field request polling preserves server progress, retries transient status errors, and stops at terminal detector states");
