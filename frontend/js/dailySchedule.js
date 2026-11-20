const barnard = { ra: 269.4462, dec: 4.769, fovArcmin: 5 };
const epsilon = { ra: 331.09666, dec: -56.80066, fovArcmin: 10 };
const wise = { ra: 133.75976, dec: -7.24219, fovArcmin: 5 };
const epsilonSequence = "fr-09964ed249704a3668eed37ff1c36a25-d6";
const wiseSequence = "fr-04c69f36e299240cd727aba625e534c6-d6";

export const WEEKLY_MISSIONS = [
  { day: "Monday", level: "Easy", name: "Barnard’s Star", field: { ...barnard, detector: "D2" },
    target: "barnard", sequence: "barnard-d2", marks: 2, tools: ["Blink"], hint: "Look for the fast mover between observations months apart." },
  { day: "Tuesday", level: "Easy+", name: "Barnard’s Star in another band", field: { ...barnard, detector: "D5" },
    target: "barnard", sequence: "barnard-d5", marks: 2, tools: ["Blink", "Difference"], hint: "Compare each image with the first observation and look for changing pixels." },
  { day: "Wednesday", level: "Intermediate", name: "Epsilon Indi B field", field: { ...epsilon, detector: "D6" },
    target: "epsindb", sequence: epsilonSequence, marks: 2, tools: ["Blink", "Contrast"], hint: "Boost the contrast to inspect the brown-dwarf field." },
  { day: "Thursday", level: "Intermediate+", name: "Epsilon Indi B track", field: { ...epsilon, detector: "D6" },
    target: "epsindb", sequence: epsilonSequence, marks: 3, tools: ["Blink", "Difference"], hint: "Use an intermediate observation to check that you are following the same source." },
  { day: "Friday", level: "Hard", name: "WISE 0855 field", field: { ...wise, detector: "D6" },
    target: "wise0855", sequence: wiseSequence, marks: 3, tools: ["Blink", "Contrast", "Difference"], hint: "Follow a faint source and check that it repeats across observations." },
  { day: "Saturday", level: "Hard+", name: "WISE 0855 motion models", field: { ...wise, detector: "D6" },
    target: "wise0855", sequence: wiseSequence, marks: 3, tools: ["Blink", "Contrast", "Difference"], compare: true,
    hint: "Trace the faint source, submit your marks, then compare the motion models." },
  { day: "Sunday", level: "Expert", name: "Simulated Planet X", simulation: true, marks: 2,
    tools: ["Blink", "Contrast", "Difference"], hint: "Practice following a faint source with curved apparent motion through a field with artefacts." },
];

export function missionForDate(date = new Date()) {
  return WEEKLY_MISSIONS[(date.getUTCDay() + 6) % 7];
}

export function realChallengeRequested(search) {
  return new URLSearchParams(search).get("challenge") === "real";
}


export function showWeeklySchedule(container, list, mission) {
  container.hidden = false;
  list.replaceChildren(...WEEKLY_MISSIONS.map((slot) => {
    const item = document.createElement("li");
    item.className = "pb-chip";
    item.textContent = `${slot.day} · ${slot.level}`;
    if (slot === mission) item.setAttribute("aria-current", "date");
    return item;
  }));
}
