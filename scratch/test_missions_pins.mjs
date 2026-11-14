// Tests for features/missions.js and features/pinBoard.js.   Run: node scratch/test_missions_pins.mjs
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { missionsDatabase, pickRandomMission, missionHref, loadProgress, saveProgress, markComplete, noteShown, stepMatches, checkMeasurement, rankFor, totalXp } from "../frontend/js/features/missions.js";
import { canPin, cleanObserver, makePin, verifyPin, pinTag, addPin, removePin, loadPins, savePins, skyToMap, sha256Hex } from "../frontend/js/features/pinBoard.js";

let failed = 0;
const check = (name, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  – " + d : ""}`); if (!ok) failed++; };
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const html = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
const learn = readFileSync(new URL("../frontend/learn.html", import.meta.url), "utf8");

const keys = ["id", "category", "title", "story", "targetType", "objective", "successFeedback"];
check("at least 15 missions, every one with all fields", missionsDatabase.length >= 15 && missionsDatabase.every((m) => keys.every((k) => typeof m[k] === "string" && m[k])));
check("ids unique", new Set(missionsDatabase.map((m) => m.id)).size === missionsDatabase.length);
check("at least 4 categories", new Set(missionsDatabase.map((m) => m.category)).size >= 4);
check("at least 40 practical missions, each with steps", missionsDatabase.length >= 40 && missionsDatabase.every((m) => m.steps.length >= 1 && m.steps.every((s) => s.does && (s.check.on || s.check.see || s.check.measure))));
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((x) => x[1]));
const missing = [];
for (const m of missionsDatabase) {
  if (m.start.hash && !ids.has(m.start.hash.slice(1))) missing.push(m.id + " " + m.start.hash);
  for (const s of m.steps) for (const sel of (s.check.on || s.check.see || "").split(",").filter(Boolean)) { const first = sel.trim().match(/^#([\w-]+)/); if (first && !ids.has(first[1])) missing.push(m.id + " " + sel); }
}
check("every control a step points to exists in Science Mode", missing.length === 0, missing.join("; "));
const fake = (matches, label) => ({ closest: (s) => (s === "label" ? label : matches(s) ? {} : null) });
check("step check: a click on the control, or on its label", stepMatches({ on: "#a" }, fake((s) => s === "#a")) && stepMatches({ on: "#r" }, fake(() => false, { control: { matches: (s) => s === "#r" } })) && !stepMatches({ on: "#a" }, fake(() => false)));
const c0 = { speedArcsecPerYear: 10.29, positionAngleDeg: 355.6, compass: "N", nDet: 8 };
check("measurement: speed within 5 %, wrong value refused", checkMeasurement({ field: "speedArcsecPerYear", tol: 0.05 }, "10.3", c0).ok && !checkMeasurement({ field: "speedArcsecPerYear", tol: 0.05 }, "3", c0).ok);
check("measurement: comma decimals, compass letters, integers, count", checkMeasurement({ field: "speedArcsecPerYear", tol: 0.05 }, "10,3″/yr", c0).ok && checkMeasurement({ field: "compass" }, " n ", c0).ok && checkMeasurement({ field: "nDet", tol: 0 }, "8", c0).ok && !checkMeasurement({ field: "nDet", tol: 0 }, "7", c0).ok && checkMeasurement({ field: "count", tol: 0 }, "2", { count: 2 }).ok);
check("XP and ranks", totalXp({ completed: ["blink-first-look", "proper-speed-trap"] }) === 150 && rankFor(0) === "Cadet Observer" && rankFor(4000) === "Planet X Hunter");
check("random pick uses the rng", pickRandomMission(() => 0).id === missionsDatabase[0].id && pickRandomMission(() => 0.9999).id === missionsDatabase.at(-1).id);
check("real-data-only missions are not picked on the demo", [...Array(500)].every(() => !pickRandomMission().needsReal) && missionsDatabase.filter((m) => m.needsReal).length === 7);
check("random pick avoids recent ones", pickRandomMission(() => 0, [missionsDatabase[0].id]).id === missionsDatabase[1].id);
check("random pick falls back when all avoided", Boolean(pickRandomMission(Math.random, missionsDatabase.map((m) => m.id))));
const seen = new Set(); for (let i = 0; i < 2000; i++) seen.add(pickRandomMission().id);
check("Math.random reaches every mission the demo can run (real-data-only ones are skipped on purpose)", seen.size === missionsDatabase.filter((m) => !m.needsReal).length);
const barn = missionsDatabase.find((m) => m.id === "proper-barnard");
check("mission href keeps the backend and names the mission", missionHref(barn, "?data=api&api=http://localhost:8003&ra=1") === "index.html?data=api&api=http%3A%2F%2Flocalhost%3A8003&ra=269.4462&dec=4.769&fov=5&det=D2&mission=proper-barnard");
const st = mem(); let pr = loadProgress(st);
pr = markComplete(markComplete(pr, "blink-first-look"), "blink-first-look"); pr = noteShown(pr, "px-injection"); saveProgress(st, pr);
check("progress round-trips and counts once", JSON.stringify(loadProgress(st)) === JSON.stringify({ completed: ["blink-first-look"], recent: ["px-injection"] }));
check("broken storage gives empty progress", loadProgress({ getItem: () => "{bad" }).completed.length === 0);

check("observer cleaned", cleanObserver("  Alex_Space99 <script> ") === "Alex_Space99 script" && cleanObserver("<>") === "");
check("sha256 of 'abc'", (await sha256Hex("abc", webcrypto.subtle)) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
check("known objects cannot be pinned, unexplained ones can", !canPin({ ra: 1, dec: 1, known: "Barnard's Star" }).ok && canPin({ ra: 1, dec: 1 }).ok && !canPin(null).ok);
let knownErr = ""; try { await makePin({ ra: 1, dec: 1, known: "Barnard's Star" }, { observer: "x", subtle: webcrypto.subtle }); } catch (e) { knownErr = e.message; }
check("makePin refuses a known object", /known object/.test(knownErr));
const cand = { ra: 269.4462, dec: 4.769, label: "#1", speedArcsecPerYear: 10.14, nDet: 24, nFrames: 24 };
const pin = await makePin(cand, { observer: "Alex_Space99", realData: false, now: new Date("2026-11-14T10:00:00Z"), subtle: webcrypto.subtle });
check("pin fields", pin.observer === "Alex_Space99" && pin.dataKind === "synthetic" && pin.checks.knownObject === null && pin.foundAt === "2026-11-14T10:00:00.000Z" && /^[0-9a-f]{64}$/.test(pin.hash));
check("tag text, marked synthetic", pinTag(pin) === "Discovered/Verified by Alex_Space99 (synthetic demo data)");
check("hash verifies, and an edit breaks it", (await verifyPin(pin, webcrypto.subtle)) && !(await verifyPin({ ...pin, observer: "Mallory" }, webcrypto.subtle)));
let threw = ""; try { await makePin(cand, { observer: "  ", subtle: webcrypto.subtle }); } catch (e) { threw = e.message; }
check("empty name refused", threw === "Enter an observer name.");
threw = ""; try { await makePin({ ra: NaN, dec: 0 }, { observer: "x", subtle: webcrypto.subtle }); } catch (e) { threw = e.message; }
check("no position refused", /no sky position/.test(threw));
let pins = addPin(addPin([], pin), pin); const s2 = mem(); savePins(s2, pins);
check("duplicate not added; storage round-trip", pins.length === 1 && loadPins(s2).length === 1 && removePin(pins, pin.id).length === 0);
const a = skyToMap(0, 90), b = skyToMap(180, -90);
check("map projection", a.x === 1 && a.y === 0 && b.x === 0.5 && b.y === 1);
check("page has the pin button and the dialog", html.includes('id="pin-report-btn"') && html.includes("Enter Observer Name / Handle:") && html.includes("Pin &amp; Report Object"));
check("missions card is in Learn Mode", learn.includes('id="mission-card"') && !html.includes('id="mission-card"'));

const { sharedConfig, fetchSharedPins, pushSharedPin, mergePins } = await import("../frontend/js/features/pinSync.js");
check("shared config: accepts a publishable key, refuses a secret key and other hosts", Boolean(sharedConfig("https://xmxhtkcmaijmapfyuwcg.supabase.co", "sb_publishable_JT4A-xKALCWAKcyF9SfOxg_HVvJGbTY")) && !sharedConfig("https://xmxhtkcmaijmapfyuwcg.supabase.co", "sb_secret_abcdefghijklmnopqrstuvwxyz") && !sharedConfig("https://evil.example.com", "sb_publishable_JT4A-xKALCWAKcyF9SfOxg_HVvJGbTY"));
const cfg = sharedConfig("https://xmxhtkcmaijmapfyuwcg.supabase.co", "sb_publishable_JT4A-xKALCWAKcyF9SfOxg_HVvJGbTY");
const forged = { ...pin, observer: "Mallory" };
const fakeFetch = async () => ({ ok: true, json: async () => [{ record: pin, hash: pin.hash }, { record: forged, hash: pin.hash }] });
const got = await fetchSharedPins(cfg, { fetchFn: fakeFetch, subtle: webcrypto.subtle });
check("shared pins: a record that fails its hash is dropped", got.pins.length === 1 && got.dropped === 1 && got.pins[0].shared === true);
let sentBody = null; await pushSharedPin(cfg, { ...pin, pending: true }, { fetchFn: async (u, o) => { sentBody = JSON.parse(o.body); return { ok: false, status: 409 }; } });
check("push: duplicate counts as done, local flags not sent", sentBody.hash === pin.hash && !("pending" in sentBody.record));
check("merge: one per hash, shared wins", mergePins([{ ...pin, pending: true }], got.pins).length === 1 && mergePins([{ ...pin, pending: true }], got.pins)[0].pending === false);

console.log(failed ? `FAIL  ${failed} check(s) failed` : "PASS  all missions/pin board checks");
process.exit(failed ? 1 : 0);
