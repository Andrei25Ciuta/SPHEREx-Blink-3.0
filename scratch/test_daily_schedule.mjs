import assert from "node:assert/strict";
import { missionForDate, WEEKLY_MISSIONS } from "../frontend/js/dailySchedule.js";
import { advanceStreak, streakState } from "../frontend/js/dailyRealStreak.js";

const week = WEEKLY_MISSIONS.map((_, i) => missionForDate(new Date(Date.UTC(2026, 10, 23 + i))));
assert.deepEqual(week, WEEKLY_MISSIONS);
assert.equal(week[0].target, "barnard");
assert.deepEqual(week[0].tools, ["Blink"]);
assert.equal(week[6].simulation, true);
assert.equal(week[6].sequence, undefined);
assert.ok(week[5].compare);
assert.ok(week[4].tools.length > week[0].tools.length);

let progress = { day: 100, streak: 5 }; // Existing state predates freezes.
assert.equal(streakState(progress, 102).streak, 5);
progress = advanceStreak(progress, 102);
assert.deepEqual(progress, { day: 102, streak: 6, freezeUsed: true });
assert.equal(advanceStreak(progress, 102), progress);
assert.equal(advanceStreak(progress, 103).streak, 7);
assert.deepEqual(advanceStreak(progress, 104), { day: 104, streak: 1, freezeUsed: false });
assert.deepEqual(advanceStreak(progress, 105), { day: 105, streak: 1, freezeUsed: false });
console.log("PASS weekly UTC rotation, skill progression and one-day freeze");
