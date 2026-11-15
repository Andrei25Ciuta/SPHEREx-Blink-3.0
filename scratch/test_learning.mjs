import { LEVELS, gradeAnswer, createLearningState, readState, activeProfile, progressPercent, unlockedLevel, rankForXp, earnedAchievements, completeLevel, addProfile, selectProfile, renameActiveProfile, addLearningTime } from "../frontend/js/features/learning.js";
import { explanationFor, answerAstra } from "../frontend/js/features/spaceGuide.js";
import { readFileSync } from "node:fs";

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}

check("learning path has sixteen unique levels in order (eight added on purpose, 14 Nov 2026), ending with the citizen scientist", LEVELS.length === 16 && new Set(LEVELS.map((x) => x.id)).size === 16 && LEVELS.every((x, i) => x.id === i + 1) && LEVELS.slice(0, 7).map((x) => x.title).join("|") === "What is SPHEREx?|What is Infrared Light?|Stars|Nebulae|Galaxies|Moving Objects|Searching for Planet X" && LEVELS.at(-1).title === "Become a Citizen Scientist");
check("quiz data includes every requested question type", new Set(LEVELS.map((x) => x.quiz.type)).size === 4);
check("correct and incorrect quiz answers have useful feedback", gradeAnswer(6, "orange").correct && gradeAnswer(6, "wrong").feedback.length > 20);
check("classification quiz accepts only a complete matching sort", gradeAnswer(4, { star: "star", cloud: "nebula", island: "galaxy" }).correct && !gradeAnswer(4, { star: "nebula" }).correct);
check("invalid mission is safely rejected", !gradeAnswer(99, "anything").correct);

const empty = createLearningState();
check("new local profile has no progress", activeProfile(empty).completed.length === 0 && progressPercent(activeProfile(empty)) === 0);
const restored = readState(JSON.stringify({ profiles: [{ id: "x", name: "Ada", completed: [1, 1, 99, "2"], xp: 20 }], activeProfileId: "x" }));
check("saved profile progress is filtered and deduplicated", activeProfile(restored).completed.join(",") === "1");
check("out-of-order imported level completions cannot skip locked lessons", activeProfile(readState({ profiles: [{ id: "x", completed: [1, 3, 5] }] })).completed.join(",") === "1");
check("malformed saved state safely returns a fresh profile", activeProfile(readState("{")).completed.length === 0);
check("level two is locked until level one is completed", unlockedLevel(activeProfile(empty)) === 1 && unlockedLevel(activeProfile(completeLevel(empty, 2))) === 1);
const levelOne = completeLevel(empty, 1, "2026-11-14");
check("correct completion awards XP and unlocks only the next level", activeProfile(levelOne).xp === 10 && unlockedLevel(activeProfile(levelOne)) === 2 && progressPercent(activeProfile(levelOne)) === Math.round(100 / LEVELS.length));   // 1 of 16 lessons since 14 Nov 2026 (was 1 of 8 = 13 %)
check("a completed level cannot award XP twice", activeProfile(completeLevel(levelOne, 1, "2026-11-14")).xp === 10);
check("streak increases on the next calendar day and resets after a gap", activeProfile(completeLevel(levelOne, 2, "2026-11-15")).streak === 2 && activeProfile(completeLevel(levelOne, 2, "2026-11-17")).streak === 1);
check("rank and badges are derived from learner progress", rankForXp(0) === "First Light Cadet" && rankForXp(80) === "Cosmic Navigator" && earnedAchievements(activeProfile(levelOne)).some((x) => x.id === "first-light"));
const classState = addProfile(empty, "Sam", "sam");
check("teacher roster profiles can be added and selected locally", classState.profiles.length === 2 && activeProfile(selectProfile(classState, "sam")).name === "Sam");
check("profile names can be changed without altering other profiles", activeProfile(renameActiveProfile(classState, "Samantha")).name === "Samantha" && classState.profiles[0].name === "Space Explorer");
check("learning time is stored as non-negative whole seconds", activeProfile(addLearningTime(empty, 12.8)).timeSeconds === 12 && activeProfile(addLearningTime(empty, -4)).timeSeconds === 0);
check("Astra explains key science terms in beginner-friendly language", explanationFor("signal-to-noise ratio").simple.includes("random background") && answerAstra("What is infrared light?").includes("cannot see it"));
check("Astra has a transparent offline fallback for unknown questions", explanationFor("how far is my spaceship").context.includes("does not send") && explanationFor("how far is my spaceship").simple.includes("prepared answer"));

const home = readFileSync(new URL("../frontend/overview.html", import.meta.url), "utf8");
const learn = readFileSync(new URL("../frontend/learn.html", import.meta.url), "utf8");
const science = readFileSync(new URL("../frontend/js/scienceExplain.js", import.meta.url), "utf8");
check("the landing offers both modes (since the merge into 3.0 it is the 3D overview with the mode cards; the 4.0 headline is gone on purpose)", home.includes('class="mode-choices') && home.includes("Learn Mode") && home.includes("Science Mode") && home.includes('href="learn.html"'));
check("learn page includes all levels, Astra (the learner profile and classroom panels were removed on purpose, 14 Nov 2026)", learn.includes("Astra") && !learn.includes("learner-profile") && !learn.includes("classroom-dashboard") && learn.includes("SYNTHETIC") && learn.includes("aria-live"));
check("Science Mode exposes a keyboard-operable simple explanation on each panel", science.includes('querySelectorAll("main .panel")') && science.includes('aria-expanded') && science.includes("Explain Simply"));
if (failed) process.exitCode = 1;
