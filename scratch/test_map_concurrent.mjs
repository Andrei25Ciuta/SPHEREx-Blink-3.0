// Test for bounded async image/pixel reads. Run: node scratch/test_map_concurrent.mjs
import { mapConcurrent } from "../frontend/js/features/mapConcurrent.js";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

{
  let active = 0, peak = 0;
  const result = await mapConcurrent(Array.from({ length: 17 }, (_, i) => i), 4, async (value) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, value % 3));
    active--;
    return value * 2;
  });
  check("at most the configured number of operations are active", peak <= 4 && peak > 1, `peak ${peak}`);
  check("results remain in source order despite out-of-order completion", result.join(",") === Array.from({ length: 17 }, (_, i) => i * 2).join(","));
}

check("an empty input returns an empty result", (await mapConcurrent([], 2, async (x) => x)).length === 0);
{
  const started = [];
  let message = "";
  try {
    await mapConcurrent([0, 1, 2, 3], 2, async (value) => {
      started.push(value);
      if (value === 1) { await new Promise((resolve) => setTimeout(resolve, 1)); throw new Error("fixture failure"); }
      await new Promise((resolve) => setTimeout(resolve, 10));
      return value;
    });
  } catch (error) { message = error.message; }
  check("a failed operation stops the queue and waits for current work", message === "fixture failure" && started.length === 2);
}
let invalid = false;
try { await mapConcurrent([1], 0, async (x) => x); } catch (error) { invalid = error instanceof RangeError; }
check("a zero concurrency limit is rejected", invalid);

if (failed) process.exitCode = 1;
else console.log("All bounded-map checks passed.");
