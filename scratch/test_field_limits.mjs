import assert from "node:assert/strict";
import { clampFov, maxFovForDataSource, REAL_DATA_MAX_FOV_ARCMIN, SYNTHETIC_MAX_FOV_ARCMIN } from "../frontend/js/features/fieldLimits.js";

assert.equal(REAL_DATA_MAX_FOV_ARCMIN, 30);
assert.equal(SYNTHETIC_MAX_FOV_ARCMIN, 30);
assert.equal(maxFovForDataSource("api"), 30);
assert.equal(maxFovForDataSource("mock"), 30);
assert.equal(clampFov(20, "api"), 20);
assert.equal(clampFov(20, "mock"), 20);
assert.equal(clampFov(-1, "api"), 1);
assert.equal(clampFov("invalid", "mock"), 1);
console.log("PASS: real-data and synthetic FOV limits");
