import {
  LEVELS, ACHIEVEMENTS, STORAGE_KEY, createLearningState, readState, activeProfile,
  unlockedLevel, progressPercent, rankForXp, earnedAchievements, gradeAnswer,
  completeLevel, addProfile, selectProfile, renameActiveProfile, addLearningTime, recordQuizScore,
} from "./features/learning.js";
import { answerAstra, explanationFor } from "./features/spaceGuide.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const el = (tag, attrs = {}, text = null) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "className") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  if (text !== null) {
    if (text instanceof Node) node.append(text);
    else node.textContent = String(text);
  }
  return node;
};

let state;
let currentLevelId = 1;
let latestQuizAnswer = null;
let selectedSortItem = null;
let placements = {};
let lastSavedAt = Date.now();
let activeTimeSinceSave = 0;
let wasVisible = !document.hidden;
let lastInteractionAt = Date.now();

try {
  state = readState(localStorage.getItem(STORAGE_KEY));
} catch {
  state = createLearningState();
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Progress remains available for this page session. */ }
}

function renderPath() {
  const list = $("#learning-path");
  const profile = activeProfile(state);
  const maxUnlocked = unlockedLevel(profile);
  list.replaceChildren(...LEVELS.map((level) => {
    const done = profile.completed.includes(level.id);
    const unlocked = level.id <= maxUnlocked;
    const button = el("button", { type: "button", disabled: !unlocked, dataset: { status: done ? "complete" : unlocked ? (level.id === currentLevelId ? "active" : "open") : "locked" } });
    if (level.id === currentLevelId) button.setAttribute("aria-current", "step");
    button.append(
      el("span", { className: "path-number", "aria-hidden": "true" }, done ? "✓" : String(level.id)),
      el("span", { className: "path-title" }, level.title),
      el("span", { className: "path-state" }, done ? "Done" : unlocked ? "Open" : "Locked"),
    );
    button.addEventListener("click", () => { currentLevelId = level.id; latestQuizAnswer = null; selectedSortItem = null; placements = {}; render(); });
    return el("li", {}, null).appendChild(button).parentElement;
  }));
}

function makeMissionArt(level) {
  const figure = el("figure", { className: `lesson-visual visual-${level.visual}` });
  if (level.visual === "mover") {
    const row = el("div", { className: "lesson-mover-sequence", role: "img", "aria-label": "Three synthetic sky snapshots. The pale stars stay fixed while the orange dot shifts position." });
    for (let i = 0; i < 3; i++) row.append(el("div", { className: "lesson-frame" }, el("span", { "aria-hidden": "true" })));
    figure.append(row, el("figcaption", {}, "SYNTHETIC ILLUSTRATION · fixed stars stay in place; the orange point moves."));
    return figure;
  }
  if (level.visual === "spectrum") {
    const band = el("div", { className: "lesson-spectrum-art", role: "img", "aria-label": "Visible rainbow light followed by an infrared band beyond red" });
    band.append(el("span", {}, "VISIBLE · RAINBOW"), el("span", {}, "INFRARED · INVISIBLE TO OUR EYES"));
    figure.append(band, el("figcaption", {}, "Diagram only · infrared wavelengths are longer than visible red light."));
    return figure;
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 600 170");
  svg.setAttribute("role", "img");
  const art = {
    atlas: { label: "Schematic all-sky map made from colored bands", shapes: [["circle", 300, 85, 58, "var(--learn-galaxy)"], ["ellipse", 300, 85, 168, 45, "none"], ["ellipse", 300, 85, 225, 68, "none"]], caption: "Schematic · SPHEREx maps the whole sky in many infrared wavelengths." },
    star: { label: "Illustration of a star shining in a dark sky", shapes: [["circle", 300, 85, 41, "var(--learn-sun)"], ["circle", 300, 85, 64, "none"], ["circle", 100, 38, 4, "var(--learn-star)"], ["circle", 470, 123, 5, "var(--learn-star)"]], caption: "Illustration · a star's light can carry clues about its temperature and surroundings." },
    nebula: { label: "Illustration of a cloud of gas and dust", shapes: [["ellipse", 300, 85, 190, 47, "var(--learn-galaxy)"], ["ellipse", 250, 80, 114, 33, "var(--learn-nebula)"], ["ellipse", 370, 94, 96, 27, "var(--learn-nebula-warm)"], ["circle", 225, 65, 7, "var(--learn-star)"], ["circle", 394, 102, 8, "var(--learn-star)"]], caption: "Illustration · a nebula is a cloud of gas and dust; some are places where stars form." },
    galaxy: { label: "Schematic spiral galaxy", shapes: [["circle", 300, 85, 15, "var(--learn-star)"], ["ellipse", 300, 85, 123, 36, "none"], ["ellipse", 300, 85, 91, 30, "none"], ["ellipse", 300, 85, 169, 47, "none"]], caption: "Schematic · a galaxy is a vast group of stars, gas and dust held by gravity." },
    orbit: { label: "Schematic of Earth moving around the Sun and a distant object", shapes: [["circle", 115, 85, 17, "var(--learn-sun)"], ["ellipse", 115, 85, 64, 28, "none"], ["ellipse", 115, 85, 102, 47, "none"], ["circle", 180, 85, 7, "var(--learn-earth)"], ["circle", 495, 36, 8, "var(--learn-mover)"]], caption: "Model illustration · a distant body's apparent path can include Earth's motion. Not a Planet X detection." },
    steward: { label: "Schematic checklist showing careful scientific review", shapes: [["rect", 177, 26, 246, 118, "var(--learn-night)"], ["circle", 213, 58, 10, "var(--learn-check)"], ["circle", 213, 85, 10, "var(--learn-check)"], ["circle", 213, 112, 10, "var(--learn-check)"], ["rect", 237, 53, 143, 7, "var(--learn-check-line)"], ["rect", 237, 80, 143, 7, "var(--learn-check-line)"], ["rect", 237, 107, 143, 7, "var(--learn-check-line)"]], caption: "Illustration · record the source, inspect evidence, and leave room for someone else to check." },
  }[level.visual];
  svg.setAttribute("aria-label", art.label);
  for (const [kind, x, y, a, b, fill] of art.shapes) {
    const shape = document.createElementNS("http://www.w3.org/2000/svg", kind);
    if (kind === "rect") { shape.setAttribute("x", x); shape.setAttribute("y", y); shape.setAttribute("width", a); shape.setAttribute("height", b); }
    else { shape.setAttribute("cx", x); shape.setAttribute("cy", y); shape.setAttribute(kind === "circle" ? "r" : "rx", a); if (kind === "ellipse") shape.setAttribute("ry", b); }
    shape.setAttribute("fill", fill);
    if (fill === "none") shape.setAttribute("stroke", "var(--learn-outline)");
    svg.append(shape);
  }
  figure.append(svg, el("figcaption", {}, art.caption));
  return figure;
}

function submitQuiz(level, answer, feedback) {
  const result = gradeAnswer(level.id, answer);
  latestQuizAnswer = answer;
  feedback.hidden = false;
  feedback.dataset.kind = result.correct ? "correct" : "try";
  feedback.textContent = result.feedback;
  state = recordQuizScore(state, level.id, result.correct);
  save();
  if (!result.correct) { renderSummary(); return; }
  const profile = activeProfile(state);
  const alreadyDone = profile.completed.includes(level.id);
  state = completeLevel(state, level.id);
  save();
  renderSummary();
  renderPath();
  if (!alreadyDone) {
    const reward = el("p", { className: "lesson-finish", role: "status" }, `✦ Mission complete · +10 XP · ${rankForXp(activeProfile(state).xp)}`);
    if (level.id < LEVELS.length) {
      const next = el("button", { className: "learn-button learn-button-primary continue-button", type: "button" }, `Continue to Level ${level.id + 1} →`);
      next.addEventListener("click", () => { currentLevelId = level.id + 1; latestQuizAnswer = null; placements = {}; render(); $("#lesson-title")?.focus(); });
      feedback.after(reward, next);
    } else feedback.after(reward);
  }
}

function renderStandardQuiz(level, feedback) {
  const quiz = level.quiz;
  const list = el("div", { className: "answer-list", role: "group", "aria-label": quiz.prompt });
  for (const choice of quiz.choices) {
    const button = el("button", { type: "button", className: "answer-button", dataset: { answer: choice.id } });
    if (quiz.type === "image-identification") {
      const picture = el("span", { className: `choice-icon choice-${choice.visual}`, "aria-hidden": "true" }, choice.visual === "mover" ? "●" : choice.visual === "star" ? "✦" : choice.visual === "rainbow" ? "🌈" : choice.visual === "infrared" ? "◉" : "〰");
      button.append(picture);
    }
    button.append(el("span", {}, choice.label));
    button.addEventListener("click", () => submitQuiz(level, choice.id, feedback));
    list.append(button);
  }
  return list;
}

function renderSortQuiz(level, feedback) {
  const quiz = level.quiz;
  const board = el("div", { className: "sort-board", role: "group", "aria-label": quiz.prompt });
  const available = el("div", { className: "sort-items", "aria-label": "Items to sort" });
  const help = el("p", { className: "sort-help", role: "status" }, "Choose an item, then choose a group. Mouse users may also drag items into a group.");
  const reset = el("button", { type: "button", className: "learn-button" }, "Reset sort");
  reset.addEventListener("click", () => { placements = {}; selectedSortItem = null; latestQuizAnswer = null; renderLesson(); });
  for (const item of quiz.items) {
    const button = el("button", { type: "button", className: "sort-item", draggable: true, dataset: { item: item.id } }, item.label);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      selectedSortItem = selectedSortItem === item.id ? null : item.id;
      $$(".sort-item", board).forEach((node) => node.setAttribute("aria-pressed", String(node.dataset.item === selectedSortItem)));
      help.textContent = selectedSortItem ? `Now choose a group for “${item.label}”.` : "Choose an item, then choose a group.";
    });
    button.addEventListener("dragstart", (event) => event.dataTransfer?.setData("text/plain", item.id));
    available.append(button);
  }
  const itemBank = el("div", { className: "sort-bin sort-bank" }, el("h4", {}, "Space objects"));
  itemBank.append(available);
  board.append(itemBank);
  for (const category of quiz.categories) {
    const bin = el("div", { className: "sort-bin", dataset: { category: category.id }, tabIndex: 0, role: "button", "aria-label": `Place the selected item in ${category.label}` });
    const title = el("h4", {}, category.label);
    const binItems = el("div", { className: "sort-items" });
    bin.append(title, binItems);
    const assign = (itemId) => {
      if (!itemId || !quiz.items.some((item) => item.id === itemId)) return;
      placements[itemId] = category.id;
      const item = quiz.items.find((x) => x.id === itemId);
      const itemButton = $(`.sort-item[data-item="${itemId}"]`, board);
      itemButton.dataset.placed = "true";
      itemButton.hidden = true;
      binItems.append(el("span", { className: "sort-item-placed" }, item.label));
      selectedSortItem = null;
      help.textContent = `${item.label} placed in ${category.label}. Sort the remaining objects.`;
      if (Object.keys(placements).length === quiz.items.length) submitQuiz(level, placements, feedback);
    };
    bin.addEventListener("click", () => assign(selectedSortItem));
    bin.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); assign(selectedSortItem); } });
    bin.addEventListener("dragover", (event) => { event.preventDefault(); bin.classList.add("is-over"); });
    bin.addEventListener("dragleave", () => bin.classList.remove("is-over"));
    bin.addEventListener("drop", (event) => { event.preventDefault(); bin.classList.remove("is-over"); assign(event.dataTransfer?.getData("text/plain")); });
    board.append(bin);
  }
  board.prepend(help, reset);
  return board;
}

function renderLesson() {
  const level = LEVELS.find((item) => item.id === currentLevelId) ?? LEVELS[0];
  const profile = activeProfile(state);
  const unlocked = level.id <= unlockedLevel(profile);
  if (!unlocked) { currentLevelId = unlockedLevel(profile); return renderLesson(); }
  const panel = $("#lesson-panel");
  const heading = el("div", { className: "lesson-heading" });
  heading.append(el("p", { className: "learn-kicker" }, `LEVEL ${String(level.id).padStart(2, "0")} · ${level.mission}`), el("h2", { id: "lesson-title", tabIndex: -1 }, level.title), el("p", { className: "lesson-story" }, `Mission briefing: ${level.story}`));
  const copy = el("p", { className: "lesson-copy" }, level.lesson);
  const quizSection = el("section", { className: "lesson-quiz", "aria-labelledby": "quiz-title" });
  quizSection.append(el("h3", { id: "quiz-title" }, "Mission check"), el("p", {}, level.quiz.prompt));
  const feedback = el("p", { className: "quiz-feedback", role: "status", "aria-live": "polite", hidden: true });
  const quiz = level.quiz.type === "drag-drop-classification" ? renderSortQuiz(level, feedback) : renderStandardQuiz(level, feedback);
  quizSection.append(quiz, feedback);
  if (profile.completed.includes(level.id)) {
    feedback.hidden = false;
    feedback.dataset.kind = "correct";
    feedback.textContent = "You have completed this mission. You can revisit the lesson and practice again; XP is awarded once.";
  }
  panel.replaceChildren(heading, makeMissionArt(level), copy, el("p", { className: "lesson-term" }, `Astra's simple term: ${explanationFor(level.term).label}`), quizSection);
  if (profile.completed.includes(level.id) && level.id < LEVELS.length) {
    const next = el("button", { className: "learn-button learn-button-primary continue-button", type: "button" }, `Continue to Level ${level.id + 1} →`);
    next.addEventListener("click", () => { currentLevelId = level.id + 1; latestQuizAnswer = null; placements = {}; render(); $("#lesson-title")?.focus?.(); });
    panel.append(next);
  }
}

function renderSummary() {
  const profile = activeProfile(state);
  const completed = profile.completed.length;
  const percent = progressPercent(profile);
  $("#mission-progress").value = percent;
  $("#mission-progress").setAttribute("aria-label", `${percent}% of learning path complete`);
  $("#progress-label").textContent = `${completed} of ${LEVELS.length} complete`;
  $("#xp-total").textContent = `${profile.xp} XP`;
  $("#rank-label").textContent = rankForXp(profile.xp);
  $("#streak-label").textContent = `${profile.streak} day${profile.streak === 1 ? "" : "s"} streak`;
  if ($("#learner-profile")) {                        // the learner profile panel was removed from learn.html (author, 14 Nov 2026); kept working if it returns
    $("#profile-xp").textContent = `${profile.xp} XP`;
    $("#profile-rank").textContent = rankForXp(profile.xp);
    $("#profile-completed").textContent = `${completed} / ${LEVELS.length}`;
    const minutes = Math.floor(profile.timeSeconds / 60);
    $("#profile-time").textContent = minutes ? `${minutes} min` : profile.timeSeconds ? "<1 min" : "0 min";
    if (document.activeElement !== $("#profile-name")) $("#profile-name").value = profile.name;
    const options = state.profiles.map((item) => el("option", { value: item.id, selected: item.id === state.activeProfileId }, item.name));
    $("#profile-select").replaceChildren(...options);
    const won = new Set(earnedAchievements(profile).map((item) => item.id));
    $("#badge-list").replaceChildren(...ACHIEVEMENTS.map((badge) => {
      const li = el("li", { className: won.has(badge.id) ? "is-earned" : "is-locked" });
      const description = el("span");
      description.append(el("strong", {}, badge.name), el("small", {}, badge.description));
      li.append(el("span", { className: "badge-icon", "aria-hidden": "true" }, badge.icon), description);
      return li;
    }));
  }
  if ($("#classroom-rows")) {                        // the classroom dashboard and worksheets were removed from learn.html (author, 14 Nov 2026)
    const rows = state.profiles.map((item) => {
      const tr = el("tr");
      const scores = Object.values(item.quizScores);
      const average = scores.length ? `${Math.round(scores.reduce((sum, score) => sum + score.score, 0) / scores.length)}% · ${scores.reduce((sum, score) => sum + score.attempts, 0)} tries` : "—";
      tr.append(el("th", { scope: "row" }, item.name), el("td", {}, `${item.completed.length} / ${LEVELS.length}`), el("td", {}, average), el("td", {}, `${item.xp} XP`), el("td", {}, rankForXp(item.xp)));
      return tr;
    });
    $("#classroom-rows").replaceChildren(...rows);
    const classAverage = Math.round(state.profiles.reduce((sum, item) => sum + progressPercent(item), 0) / state.profiles.length);
    $("#class-progress").textContent = `${state.profiles.length} learner${state.profiles.length === 1 ? "" : "s"} · average learning path completion ${classAverage}%`;
    if (document.activeElement !== $("#classroom-name")) $("#classroom-name").value = state.classroomName;
    const worksheetSelect = $("#worksheet-level");
    if (!worksheetSelect.options.length) worksheetSelect.replaceChildren(...LEVELS.map((item) => el("option", { value: String(item.id) }, `Level ${item.id} · ${item.title}`)));
  }
}

function render() {
  renderPath();
  renderLesson();
  renderSummary();
}

if ($("#learner-profile")) {
  $("#profile-select").addEventListener("change", (event) => { state = selectProfile(state, event.target.value); currentLevelId = unlockedLevel(activeProfile(state)); latestQuizAnswer = null; placements = {}; save(); render(); });
  $("#profile-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = $("#profile-name").value.trim().slice(0, 40);
    if (!name) return;
    state = renameActiveProfile(state, name);
    save();
    renderSummary();
  });
  $("#add-learner-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = $("#new-learner-name").value.trim();
    if (!name) return;
    state = addProfile(state, name, `learner-${Date.now()}`);
    $("#new-learner-name").value = "";
    currentLevelId = 1;
    save();
    render();
  });
}
$("#classroom-name")?.addEventListener("change", (event) => { state.classroomName = event.target.value.trim().slice(0, 60) || "My classroom"; save(); });

$("#astra-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const question = $("#astra-question").value.trim();
  if (question) $("#astra-answer").textContent = answerAstra(question);
});
$$('[data-ask]').forEach((button) => button.addEventListener("click", () => {
  const question = button.dataset.ask;
  $("#astra-question").value = question;
  $("#astra-answer").textContent = answerAstra(question);
}));
$$('[data-explain]').forEach((button) => button.addEventListener("click", () => {
  const explanation = explanationFor(button.dataset.explain);
  $("#astra-answer").textContent = `${explanation.label}: ${explanation.simple}`;
  $("#astra-answer").focus?.();
}));

const spectrumNotes = [
  "Visible light · about 380–700 nanometres · the rainbow our eyes detect.",
  "At the red edge · the longest visible wavelengths are near infrared.",
  "Infrared · longer wavelengths beyond visible red; not visible to human eyes.",
];
$("#spectrum-slider").addEventListener("input", (event) => {
  const index = Number(event.target.value);
  $("#spectrum-readout").textContent = spectrumNotes[index];
  $("#spectrum-marker").style.left = ["8%", "53%", "76%"][index];
});

const planets = [
  ["Mercury", "The smallest planet and the closest to the Sun."], ["Venus", "The second planet from the Sun, wrapped in thick clouds."],
  ["Earth", "Our home world, the third planet from the Sun."], ["Mars", "The fourth planet, a rocky world with a rusty-colored surface."],
  ["Jupiter", "The largest planet in our Solar System."], ["Saturn", "A giant planet famous for its bright rings."],
  ["Uranus", "A distant ice giant, seventh from the Sun."], ["Neptune", "A distant ice giant and the eighth planet from the Sun."],
];
$("#planet-picker").replaceChildren(...planets.map(([name, description], index) => {
  const button = el("button", { type: "button", dataset: { planet: name }, "aria-pressed": "false" }, name);
  button.addEventListener("click", () => {
    $$("#planet-picker button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    $("#planet-readout").textContent = `${name} · Planet ${index + 1} · ${description}`;
  });
  return button;
}));

const galaxies = {
  andromeda: "Andromeda · spiral galaxy · about 2.5 million light-years away. Its halo stars span a wide range of ages, roughly 6–13 billion years.",
  "milky-way": "Milky Way · spiral galaxy · our home galaxy. It has stars of many ages; some of its oldest halo stars are about 11–13 billion years old.",
};
$$('[data-galaxy]').forEach((button) => button.addEventListener("click", () => {
  $$("[data-galaxy]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
  $("#galaxy-readout").textContent = galaxies[button.dataset.galaxy];
}));

function buildPrintable(level, includeKey = true) {
  const section = el("article", { className: "worksheet-sheet" });
  section.append(el("p", { className: "learn-kicker" }, "SPHEREx Blink 4.0 · Classroom worksheet"), el("h1", {}, `Level ${level.id}: ${level.title}`), el("p", {}, `Name: __________________________________   Date: __________________`), el("p", {}, `Mission: ${level.mission}`), el("p", {}, level.lesson), el("h2", {}, "Mission question"), el("p", {}, level.quiz.prompt));
  const options = level.quiz.type === "drag-drop-classification"
    ? level.quiz.items.map((item) => `${item.label} → ____________________`)
    : level.quiz.choices.map((choice) => `☐ ${choice.label}`);
  section.append(el("ul", {}, null));
  const list = $("ul", section);
  options.forEach((text) => list.append(el("li", {}, text)));
  section.append(el("p", {}, "What clue in the lesson helped you answer?\n____________________________________________________________"));
  if (includeKey) {
    const key = el("article", { className: "answer-key" });
    key.append(el("p", { className: "learn-kicker" }, "TEACHER ANSWER KEY"), el("h2", {}, `Level ${level.id}: ${level.title}`));
    const answer = level.quiz.type === "drag-drop-classification"
      ? Object.entries(level.quiz.answer).map(([itemId, categoryId]) => `${level.quiz.items.find((x) => x.id === itemId)?.label} → ${level.quiz.categories.find((x) => x.id === categoryId)?.label}`).join(" · ")
      : level.quiz.choices.find((choice) => choice.id === level.quiz.answer)?.label;
    key.append(el("p", {}, `Answer: ${answer}`), el("p", {}, level.lesson));
    section.append(key);
  }
  return section;
}

$("#print-worksheet")?.addEventListener("click", () => {
  const id = Number($("#worksheet-level").value);
  const level = LEVELS.find((item) => item.id === id);
  if (!level) return;
  $("#printable-content").replaceChildren(buildPrintable(level));
  window.print();
});
$("#print-class-report")?.addEventListener("click", () => {
  const printable = el("article", { className: "worksheet-sheet" });
  printable.append(el("p", { className: "learn-kicker" }, "SPHEREx Blink 4.0 · Teacher dashboard"), el("h1", {}, state.classroomName || "My classroom"), el("p", {}, `Learners on this device: ${state.profiles.length}`));
  const list = el("ul");
  for (const profile of state.profiles) list.append(el("li", {}, `${profile.name}: ${profile.completed.length}/${LEVELS.length} missions · ${profile.xp} XP · ${rankForXp(profile.xp)}`));
  printable.append(list, el("p", {}, "This summary includes only profiles stored in this browser. It is not a class-wide report from multiple devices."));
  $("#printable-content").replaceChildren(printable);
  window.print();
});

document.addEventListener("visibilitychange", () => { if (document.hidden) saveActiveTime(); });
for (const eventName of ["pointerdown", "keydown", "input", "change"]) {
  document.addEventListener(eventName, () => { lastInteractionAt = Date.now(); }, { passive: true });
}
function saveActiveTime() {
  const now = Date.now();
  const elapsed = Math.floor((now - lastSavedAt) / 1000);
  if (elapsed > 0 && elapsed < 600 && wasVisible && now - lastInteractionAt < 300_000) {
    activeTimeSinceSave += elapsed;
  }
  lastSavedAt = now;
  wasVisible = !document.hidden;
  if (activeTimeSinceSave >= 10) {
    state = addLearningTime(state, activeTimeSinceSave);
    activeTimeSinceSave = 0;
    save();
    renderSummary();
  }
}
setInterval(saveActiveTime, 10_000);
window.addEventListener("pagehide", () => { saveActiveTime(); });

render();
