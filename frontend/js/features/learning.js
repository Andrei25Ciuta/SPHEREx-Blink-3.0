// Learn Mode's offline curriculum, quiz grading, and local learner progress model.
export const STORAGE_KEY = "spherex-blink-learn-v1";

export const LEVELS = [
  { id: 1, slug: "spherex", title: "What is SPHEREx?", mission: "Open the all-sky atlas", story: "A new sky map is waiting. First, learn what kind of light it records.", lesson: "SPHEREx is a NASA space telescope that maps the whole sky in 102 wavelengths of infrared light. Scientists translate those invisible wavelengths into colors on a screen. The colors are a way to show data; they are not what your eyes would see in space.", visual: "atlas", term: "spectral signature", quiz: { type: "multiple-choice", prompt: "What does SPHEREx map across the sky?", answer: "infrared", choices: [{ id: "visible", label: "Only the rainbow colors our eyes can see" }, { id: "infrared", label: "Infrared light in many wavelengths" }, { id: "sound", label: "Sound waves from stars" }] } },
  { id: 2, slug: "infrared", title: "What is Infrared Light?", mission: "Meet the invisible colors", story: "Your eyes see only a small part of the light around you. Astra will help you find the rest.", lesson: "Infrared is light with longer wavelengths than visible red light. Human eyes cannot see it, but warm objects emit infrared light. Infrared can also pass through dusty space more easily than visible light, helping telescopes study regions hidden by dust.", visual: "spectrum", term: "infrared emission", quiz: { type: "image-identification", prompt: "Which band sits just beyond red, outside human vision?", answer: "infrared", choices: [{ id: "visible", label: "Visible light · the rainbow", visual: "rainbow" }, { id: "infrared", label: "Infrared · beyond red", visual: "infrared" }, { id: "radio", label: "Radio · much longer waves", visual: "radio" }] } },
  { id: 3, slug: "stars", title: "Stars", mission: "Read a star's light", story: "Stars are faraway suns. Their light carries clues about them.", lesson: "A star is a huge ball of hot gas that makes energy in its core. The light from a star includes many wavelengths. When astronomers spread that light out, patterns can reveal clues about temperature and the material around the star.", visual: "star", term: "spectral signature", quiz: { type: "true-false", prompt: "A star's light can carry clues about the star.", answer: "true", choices: [{ id: "true", label: "True" }, { id: "false", label: "False" }] } },
  { id: 4, slug: "nebulae", title: "Nebulae", mission: "Explore a cosmic cloud", story: "Some clouds between the stars are places where new stars can form.", lesson: "A nebula is a large cloud of gas and dust in space. Some nebulae are stellar nurseries where stars form; others are clouds of material released by dying stars. Different wavelengths can reveal different parts of a dusty cloud.", visual: "nebula", term: "infrared emission", quiz: { type: "drag-drop-classification", prompt: "Sort each space object into its group. Drag an item, or select it and choose a group.", answer: { star: "star", cloud: "nebula", island: "galaxy" }, items: [{ id: "star", label: "A star", category: "star" }, { id: "cloud", label: "A cloud of gas and dust", category: "nebula" }, { id: "island", label: "A huge collection of stars", category: "galaxy" }], categories: [{ id: "star", label: "Star" }, { id: "nebula", label: "Nebula" }, { id: "galaxy", label: "Galaxy" }] } },
  { id: 5, slug: "galaxies", title: "Galaxies", mission: "Chart a galaxy", story: "Zoom out: stars live in enormous neighborhoods called galaxies.", lesson: "A galaxy is a vast group of stars, gas, dust, and other matter held together by gravity. Galaxies come in different shapes, including spiral, elliptical, and irregular. The Andromeda Galaxy is a nearby spiral galaxy about 2.5 million light-years away; its light began its trip before humans existed.", visual: "galaxy", term: "redshift", quiz: { type: "multiple-choice", prompt: "What is a galaxy?", answer: "star-group", choices: [{ id: "star-group", label: "A huge group of stars, gas, and dust held together by gravity" }, { id: "single-star", label: "One star with planets around it" }, { id: "cloud-only", label: "A cloud inside Earth's atmosphere" }] } },
  { id: 6, slug: "movers", title: "Moving Objects", mission: "Track a moving dot", story: "Blink between two dates. Can you tell which point changed position?", lesson: "Astronomers compare pictures of the same sky taken at different times. Distant stars usually look fixed in a small image, while a nearby object can shift position. A source that seems to move is a candidate mover: a clue to investigate, not proof of what the object is.", visual: "mover", term: "candidate mover", quiz: { type: "image-identification", prompt: "In this sequence, which point changed position?", answer: "orange", choices: [{ id: "white", label: "The white stars", visual: "star" }, { id: "orange", label: "The orange dot", visual: "mover" }, { id: "none", label: "Nothing changed", visual: "still" }] } },
  { id: 7, slug: "planet-x", title: "Searching for Planet X", mission: "Test a distant-world idea", story: "A distant object might appear to sway as Earth moves around the Sun. Test the pattern carefully.", lesson: "Astronomers can test whether a series of positions fits the motion expected from Earth's orbit. A possible fit is only a candidate. Noise, image artefacts, and chance alignments can imitate patterns, so more observations and independent checks are essential. This project does not claim to have found Planet X.", visual: "orbit", term: "signal-to-noise ratio", quiz: { type: "true-false", prompt: "One promising pattern in images proves that Planet X has been found.", answer: "false", choices: [{ id: "true", label: "True" }, { id: "false", label: "False" }] } },
  { id: 8, slug: "blink", title: "The Blink Method", mission: "Flip between two nights", story: "In 1930 a young astronomer flipped between two photographs of the same stars, again and again, until one tiny dot jumped.", lesson: "The blink method compares images of the same patch of sky taken on different dates. When the images are shown one after another, stars stay in place and anything that moves seems to jump. Clyde Tombaugh found Pluto this way in 1930. This platform does the same thing with SPHEREx infrared images, and its Find movers button repeats the comparison automatically.", visual: "mover", term: "candidate mover", quiz: { type: "multiple-choice", prompt: "Why does a moving object 'jump' when you blink two images?", answer: "moved", choices: [{ id: "moved", label: "It was in a different place on the two dates, while the stars stayed put" }, { id: "brighter", label: "The camera made it brighter in the second image" }, { id: "random", label: "Every dot in the sky jumps the same amount" }] } },
  { id: 9, slug: "proper-motion", title: "Stars on the Move", mission: "Clock a runaway star", story: "Stars look fixed, but they are all travelling. The closest and fastest ones drift visibly over a few years.", lesson: "Proper motion is a star's slow drift across the sky, measured in arcseconds per year (one arcsecond is 1/3600 of a degree). Most stars are so far away that their drift is tiny. Barnard's Star, about 6 light-years away, moves about 10 arcseconds a year, the fastest of any star. Over a human lifetime it crosses a distance about half the width of the full Moon.", visual: "star", term: "candidate mover", quiz: { type: "true-false", prompt: "Nearby stars usually show a larger proper motion than very distant stars moving at the same speed.", answer: "true", choices: [{ id: "true", label: "True" }, { id: "false", label: "False" }] } },
  { id: 10, slug: "parallax", title: "Parallax: Measuring Distance", mission: "Use Earth's orbit as a ruler", story: "Hold up your thumb and close one eye, then the other. Your thumb jumps. Earth's orbit does the same to nearby objects.", lesson: "As Earth travels around the Sun, a nearby object seems to shift back and forth against far-away stars once a year. This shift is called parallax. The smaller the shift, the farther the object. Astronomers define a parsec as the distance at which the shift is one arcsecond: distance in parsecs = 1 / parallax in arcseconds. One parsec is about 3.26 light-years. Parallax is the only direct way to measure distances to stars.", visual: "orbit", term: "signal-to-noise ratio", quiz: { type: "multiple-choice", prompt: "An object's parallax gets smaller. What does that tell you?", answer: "farther", choices: [{ id: "farther", label: "It is farther away" }, { id: "closer", label: "It is closer" }, { id: "hotter", label: "It is hotter" }] } },
  { id: 11, slug: "small-bodies", title: "Asteroids and Comets", mission: "Sort the Solar System's small travellers", story: "Between and beyond the planets, millions of small bodies circle the Sun. They are the most common moving dots in sky images.", lesson: "Asteroids are rocky or metallic bodies, most of them in the main belt between Mars and Jupiter. Comets are icy bodies; near the Sun their ice turns to gas and dust and forms a glowing coma and tails. Because they are close to us, both move across the sky much faster than stars. Before calling a moving dot new, astronomers check catalogues of known asteroids and comets.", visual: "mover", term: "candidate mover", quiz: { type: "drag-drop-classification", prompt: "Sort each object into its group. Drag an item, or select it and choose a group.", answer: { rock: "asteroid", ice: "comet", sun: "star" }, items: [{ id: "rock", label: "A rocky body in the belt between Mars and Jupiter", category: "asteroid" }, { id: "ice", label: "An icy body that grows a tail near the Sun", category: "comet" }, { id: "sun", label: "A distant sun that barely moves across the sky", category: "star" }], categories: [{ id: "asteroid", label: "Asteroid" }, { id: "comet", label: "Comet" }, { id: "star", label: "Star" }] } },
  { id: 12, slug: "brown-dwarfs", title: "Brown Dwarfs: Failed Stars", mission: "Find a cold, dark neighbour", story: "Some objects are too big to be planets but too small to shine like stars. They glow only faintly, in infrared.", lesson: "A brown dwarf forms like a star but has too little mass to keep hydrogen fusion going in its core. It slowly cools for billions of years. Brown dwarfs are dim in visible light but glow in infrared, so infrared surveys like WISE and SPHEREx can find them. Some nearby brown dwarfs are so close that they also show large proper motions, which is how several were discovered.", visual: "star", term: "infrared emission", quiz: { type: "multiple-choice", prompt: "Why are infrared telescopes good at finding brown dwarfs?", answer: "glow", choices: [{ id: "glow", label: "Brown dwarfs are cool and give off most of their light as infrared" }, { id: "bright", label: "Brown dwarfs are the brightest objects in visible light" }, { id: "sound", label: "Infrared telescopes can hear them" }] } },
  { id: 13, slug: "noise", title: "Signal, Noise and Fake Dots", mission: "Tell a real source from a glitch", story: "Not every dot in an image is real. Detectors make mistakes, and the sky has its own noise.", lesson: "Every image has noise: random speckles from the detector and the background. Cosmic rays can hit the detector and leave a sharp bright pixel in a single image. The signal-to-noise ratio (S/N) tells how clearly a source stands above the noise. A real object is seen again and again, in several images and ideally in several detectors; a glitch usually appears only once. That is why a candidate seen in 8 of 8 images is much stronger than one seen in 1 of 8.", visual: "spectrum", term: "signal-to-noise ratio", quiz: { type: "true-false", prompt: "A bright dot that appears in only one image is probably a reliable new object.", answer: "false", choices: [{ id: "true", label: "True" }, { id: "false", label: "False" }] } },
  { id: 14, slug: "coordinates", title: "Addresses in the Sky", mission: "Point to an exact spot", story: "To share a discovery, you must say exactly where it is. The sky has its own map grid.", lesson: "Astronomers locate objects with two coordinates. Right Ascension (RA) is like longitude on the sky, measured in hours (0 to 24) or degrees (0 to 360). Declination (Dec) is like latitude: from +90 degrees at the north celestial pole to -90 at the south. Images are made of pixels; each SPHEREx pixel covers about 6 arcseconds of sky. Reporting RA and Dec lets anyone point a telescope at exactly the same place.", visual: "atlas", term: "provenance", quiz: { type: "multiple-choice", prompt: "Which pair of numbers gives an object's address on the sky?", answer: "radec", choices: [{ id: "radec", label: "Right Ascension and Declination" }, { id: "temp", label: "Temperature and brightness" }, { id: "pixels", label: "The number of pixels and the image size" }] } },
  { id: 15, slug: "redshift", title: "Redshift and the Big Map", mission: "Map the Universe in 3D", story: "SPHEREx does not only look for nearby movers. Its main goal is to map hundreds of millions of galaxies.", lesson: "As the Universe expands, light from distant galaxies is stretched to longer, redder wavelengths. This is called redshift, and the farther the galaxy, the larger it usually is. Because SPHEREx measures each point of the sky in 102 infrared wavelengths, scientists can estimate galaxy redshifts and build a 3D map of the Universe. That map helps test ideas about what happened in the first instant after the Big Bang.", visual: "galaxy", term: "redshift", quiz: { type: "multiple-choice", prompt: "What happens to light from a distant galaxy as the Universe expands?", answer: "stretch", choices: [{ id: "stretch", label: "It is stretched to longer, redder wavelengths" }, { id: "squash", label: "It is squeezed to shorter, bluer wavelengths" }, { id: "stop", label: "It stops travelling" }] } },
  { id: 16, slug: "citizen-scientist", title: "Become a Citizen Scientist", mission: "Make a careful observation", story: "Your final mission is to report what the evidence shows, and what still needs checking.", lesson: "Citizen scientists help by carefully inspecting data, recording what they see, and sharing methods so others can check the result. Keep track of where data came from, distinguish real observations from simulations, and describe a candidate as a candidate until independent evidence supports a stronger conclusion.", visual: "steward", term: "provenance", quiz: { type: "multiple-choice", prompt: "What is the most careful way to describe an unverified moving dot?", answer: "lead", choices: [{ id: "lead", label: "A candidate worth checking" }, { id: "discovery", label: "A confirmed new planet" }, { id: "proof", label: "Proof that every image is correct" }] } },
];

export const ACHIEVEMENTS = [
  { id: "first-light", name: "First Light", icon: "🌟", description: "Complete your first mission.", when: (p) => p.completed.length >= 1 },
  { id: "telescope-apprentice", name: "Telescope Apprentice", icon: "🔭", description: "Complete three missions.", when: (p) => p.completed.length >= 3 },
  { id: "nebula-guide", name: "Nebula Guide", icon: "☁️", description: "Complete the nebula mission.", when: (p) => p.completed.includes(4) },
  { id: "galaxy-explorer", name: "Galaxy Explorer", icon: "🌌", description: "Complete the galaxy mission.", when: (p) => p.completed.includes(5) },
  { id: "object-tracker", name: "Object Tracker", icon: "☄️", description: "Complete the moving-object mission.", when: (p) => p.completed.includes(6) },
  { id: "planet-hunter", name: "Planet Hunter", icon: "🪐", description: "Complete the distant-world mission.", when: (p) => p.completed.includes(7) },
  { id: "space-scientist", name: "Space Scientist", icon: "🚀", description: "Complete the full learning path.", when: (p) => p.completed.length === LEVELS.length },
];

const VALID_LEVELS = new Set(LEVELS.map((level) => level.id));
const cleanProfile = (profile, index = 0) => ({
  id: typeof profile?.id === "string" ? profile.id.slice(0, 64) : `learner-${index + 1}`,
  name: typeof profile?.name === "string" ? profile.name.trim().slice(0, 40) || "Space Explorer" : "Space Explorer",
  completed: (() => {
    const ids = Array.isArray(profile?.completed) ? [...new Set(profile.completed.filter((id) => Number.isInteger(id) && VALID_LEVELS.has(id)))].sort((a, b) => a - b) : [];
    const contiguous = [];
    for (const id of ids) { if (id !== contiguous.length + 1) break; contiguous.push(id); }
    return contiguous;
  })(),
  xp: Number.isFinite(profile?.xp) && profile.xp >= 0 ? Math.floor(profile.xp) : 0,
  timeSeconds: Number.isFinite(profile?.timeSeconds) && profile.timeSeconds >= 0 ? Math.floor(profile.timeSeconds) : 0,
  quizScores: (() => {
    const scores = {};
    if (profile?.quizScores && typeof profile.quizScores === "object" && !Array.isArray(profile.quizScores)) {
      for (const [key, value] of Object.entries(profile.quizScores)) {
        const id = Number(key);
        if (VALID_LEVELS.has(id) && value && Number.isFinite(value.score) && Number.isFinite(value.attempts)) {
          scores[id] = { score: Math.max(0, Math.min(100, Math.floor(value.score))), attempts: Math.max(1, Math.floor(value.attempts)) };
        }
      }
    }
    return scores;
  })(),
  streak: Number.isInteger(profile?.streak) && profile.streak >= 0 ? profile.streak : 0,
  lastStudyDate: /^\d{4}-\d{2}-\d{2}$/.test(profile?.lastStudyDate ?? "") ? profile.lastStudyDate : null,
});

export function createLearningState() {
  const first = cleanProfile({ id: "learner-1", name: "Space Explorer" });
  return { version: 1, activeProfileId: first.id, classroomName: "My classroom", profiles: [first] };
}

export function readState(serialized) {
  try {
    const parsed = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
    if (!parsed || !Array.isArray(parsed.profiles)) return createLearningState();
    const profiles = parsed.profiles.slice(0, 50).map(cleanProfile);
    if (!profiles.length) return createLearningState();
    const activeProfileId = profiles.some((p) => p.id === parsed.activeProfileId) ? parsed.activeProfileId : profiles[0].id;
    return { version: 1, activeProfileId, classroomName: typeof parsed.classroomName === "string" ? parsed.classroomName.slice(0, 60) : "My classroom", profiles };
  } catch {
    return createLearningState();
  }
}

export function activeProfile(state) {
  const safe = readState(state);
  return safe.profiles.find((profile) => profile.id === safe.activeProfileId) ?? safe.profiles[0];
}

export function unlockedLevel(profile) {
  const safe = cleanProfile(profile);
  return Math.min(LEVELS.length, safe.completed.length + 1);
}

export function progressPercent(profile) {
  return Math.round((cleanProfile(profile).completed.length / LEVELS.length) * 100);
}

export function rankForXp(xp = 0) {
  if (xp >= 80) return "Cosmic Navigator";
  if (xp >= 50) return "Sky Explorer";
  if (xp >= 20) return "Star Mapper";
  return "First Light Cadet";
}

export function earnedAchievements(profile) {
  const safe = cleanProfile(profile);
  return ACHIEVEMENTS.filter((badge) => badge.when(safe));
}

export function gradeAnswer(levelId, answer) {
  const level = LEVELS.find((item) => item.id === Number(levelId));
  if (!level) return { correct: false, feedback: "This mission is not available." };
  const quiz = level.quiz;
  let correct = false;
  if (quiz.type === "drag-drop-classification") {
    correct = answer && Object.entries(quiz.answer).every(([item, category]) => answer[item] === category);
  } else {
    correct = answer === quiz.answer;
  }
  return {
    correct: Boolean(correct),
    feedback: correct
      ? "Mission complete. " + level.lesson.split(". ")[0] + ". Keep exploring the evidence."
      : "Not quite yet. Review the mission note, then try again. A good scientific answer should fit the evidence.",
  };
}

export function completeLevel(state, levelId, date = new Date().toISOString().slice(0, 10)) {
  const next = readState(state);
  const profile = next.profiles.find((item) => item.id === next.activeProfileId) ?? next.profiles[0];
  const id = Number(levelId);
  if (!VALID_LEVELS.has(id) || id > unlockedLevel(profile) || profile.completed.includes(id)) return next;
  profile.completed.push(id);
  profile.completed.sort((a, b) => a - b);
  profile.xp += 10;
  if (profile.lastStudyDate !== date) {
    const previous = profile.lastStudyDate ? new Date(`${profile.lastStudyDate}T00:00:00Z`).getTime() : 0;
    const current = new Date(`${date}T00:00:00Z`).getTime();
    const consecutive = previous && current - previous === 86_400_000;
    profile.streak = consecutive ? profile.streak + 1 : 1;
    profile.lastStudyDate = date;
  }
  return next;
}

export function addProfile(state, name, id) {
  const next = readState(state);
  const cleanName = typeof name === "string" ? name.trim().slice(0, 40) : "";
  if (!cleanName || next.profiles.length >= 50) return next;
  const safeId = typeof id === "string" && id ? id.slice(0, 64) : `learner-${Date.now()}`;
  if (next.profiles.some((p) => p.id === safeId)) return next;
  next.profiles.push(cleanProfile({ id: safeId, name: cleanName }));
  next.activeProfileId = safeId;
  return next;
}

export function selectProfile(state, id) {
  const next = readState(state);
  if (next.profiles.some((profile) => profile.id === id)) next.activeProfileId = id;
  return next;
}

export function renameActiveProfile(state, name) {
  const next = readState(state);
  const profile = next.profiles.find((item) => item.id === next.activeProfileId) ?? next.profiles[0];
  const cleanName = typeof name === "string" ? name.trim().slice(0, 40) : "";
  if (cleanName) profile.name = cleanName;
  return next;
}

export function addLearningTime(state, seconds) {
  const next = readState(state);
  const profile = next.profiles.find((item) => item.id === next.activeProfileId) ?? next.profiles[0];
  if (Number.isFinite(seconds) && seconds > 0) profile.timeSeconds += Math.floor(seconds);
  return next;
}

export function recordQuizScore(state, levelId, correct) {
  const next = readState(state);
  const profile = next.profiles.find((item) => item.id === next.activeProfileId) ?? next.profiles[0];
  const id = Number(levelId);
  if (!VALID_LEVELS.has(id)) return next;
  const previous = profile.quizScores[id];
  profile.quizScores[id] = { score: correct ? 100 : 0, attempts: (previous?.attempts ?? 0) + 1 };
  return next;
}
