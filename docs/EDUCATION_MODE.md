# Learn Mode · design and operating limits

Learn Mode is a beginner-facing experience alongside Science Mode. It uses the existing no-build-step, vanilla JavaScript frontend and does not change scientific analysis code or backend APIs.

## Experience

- The public Overview is the mode chooser: Science Mode opens the existing research workspace; Learn Mode opens the guided course.
- Eight sequential levels cover SPHEREx, infrared light, stars, nebulae, galaxies, moving objects, Planet X search methods, and citizen science.
- Each level has a short mission story, a plain-language lesson, an illustration or interactive visual, and a reusable quiz control. Quiz data includes multiple-choice, true/false, image-identification, and drag-and-drop classification; classification also has a click/keyboard alternative.
- Correct answers unlock the next level and award XP once. Badges, rank, learning time, and a local-day streak are derived from the active learner's saved profile.
- Learner profiles can be switched on one browser. The classroom view summarizes those local profiles and prints a worksheet with an answer key or a class summary.
- Astra is an offline guide over reviewed, prepared explanations. It does not call a language model, send questions off-device, or invent answers to unsupported questions. Science Mode panels expose the same simple glossary.

## Data model and storage

`frontend/js/features/learning.js` owns the curriculum and the local state contract. Storage key: `spherex-blink-learn-v1`.

```text
{ version, activeProfileId, classroomName, profiles: [
  { id, name, completed: [level numbers], quizScores: { level: { score, attempts } }, xp, timeSeconds, streak, lastStudyDate }
] }
```

Profile progress is normalized on read: unknown levels are removed and completion must be contiguous from level 1. Browser storage is best-effort; blocked or malformed storage starts a fresh session. There is no account, sync, analytics, or cross-device classroom data.

## Science and provenance

All diagrams on Learn Mode are original schematic or synthetic examples, labelled as such. They are not survey data. The lessons distinguish an analysis candidate from a confirmed discovery, and the Planet X mission explicitly states that Blink makes no Planet X discovery claim. NASA's public learning pages are linked in the course and listed in [CREDITS.md](../CREDITS.md).

## Accessibility and responsiveness

Native headings, forms, buttons, links, progress elements, tables, visible focus, live feedback, keyboard sorting, click-based touch alternatives, mobile layouts, and reduced-motion rules are used. Light and dark palettes are available, with a saved high-contrast toggle shared by the Science and Learn pages. The drag classification quiz can be completed without dragging.

## Not in this implementation

- Astra does not understand unrestricted natural-language questions and is not a connected AI model.
- Teacher summaries cover profiles saved in the current browser only; they do not represent a distributed class roster.
- XP, badges, age-based personalization, parental controls, and streaks are motivational UI conventions, not measures of learning ability or mastery.
- The eight quizzes are short progress checks, not a validated assessment of astronomy knowledge.
