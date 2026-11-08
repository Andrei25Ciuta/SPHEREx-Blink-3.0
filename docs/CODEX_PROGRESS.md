# Progress: SPHEREx Blink 2.0

Read `AGENTS.md` first. Update this file after every working session. Last update: **8 Nov 2026**, branch `blink-2.0`.
Verify what is written here against `git log` and the test commands in `AGENTS.md`; do not trust it blindly.

## Where it stands

**Phase 0 (audit) done. Phase 1 (design foundation) mostly done. Phase 2 not started.** Phases are defined in
[IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md).

## Completed

| When | What | Evidence |
|---|---|---|
| 8 Nov | **Find everything** (before the 2.0 brief): every source, vetting, four catalogues at their own epochs, SkyBoT, support score, classes, dossier, exports; backend `/api/catalogue` relay; `apertureSnr` hole fix; shadow-mover and motion-disagrees rules | commit `6dc79b9`; VALIDATION §14; tests below |
| 8 Nov | Phase 0: [PROJECT_AUDIT.md](PROJECT_AUDIT.md), [FEATURE_STATUS.md](FEATURE_STATUS.md), [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md), [ARCHITECTURE.md](ARCHITECTURE.md), [SCIENTIFIC_LIMITATIONS.md](SCIENTIFIC_LIMITATIONS.md), `AGENTS.md` | files exist; statements checked against the code on 8 Nov |
| 8 Nov | Phase 1: CSS tokens in four themes (**Deep Space** default, **Observatory**, **Light research**, **Classic** = the original look), theme switch in both pages, choice kept in `localStorage`, `?theme=` override, no flash (inline head script), JetBrains Mono + tabular digits for numbers, dark "islands" (banner, image stage, charts) inside the light theme, `control-border` token (3:1) | `scratch/test_theme.mjs` (46 checks: contrast of every text colour on every surface in every theme, token completeness, `theme.js` behaviour, the pages' script and markup); built-in browser at 375 px in all four themes: no horizontal overflow, 0 low-contrast text nodes of 150-350 (script audit; `rval.inside` bar values are a false positive of the script, their colour pair is covered by the token test), choice persisted from the app to the results page |

## Tests (8 Nov 2026, after Phase 1)

- Node: 17 files, all exit 0, **526** `PASS`, 0 `FAIL` (`test_coords` and `test_mock` print differently and are not counted).
- Backend: `pytest backend`: **143** passed.
- Not run: CI on GitHub (nothing pushed), Playwright (none exist), any real-device or screen-reader check.

## Files changed in Phase 1

`frontend/css/styles.css` (tokens, themes, switch, numerals, hero wrap), `frontend/css/results.css`, `frontend/index.html`, `frontend/results.html`
(theme attribute, head script, fonts, switch), `frontend/js/features/theme.js` (new), `frontend/js/main.js`, `frontend/js/results.js`,
`scratch/test_theme.mjs` (new), `scratch/test_results.mjs` (the `<html>` check allows the new attribute), `README.md`, docs listed above.

## Remaining in Phase 1

- Reusable dialog, tooltip and empty/error-state components (buttons, inputs, selects and cards already come from shared CSS; there is no dialog or tooltip system).
- An icon system (none; the page uses CSS shapes and text).
- Contrast check of the Plotly spectrum chart in the light theme (it sits on a fixed dark ground by design; not looked at in the light theme).
- Classic keeps the original faint input borders (below 3:1): known, kept on purpose.

## Next recommended steps

1. Phase 2, smallest useful part first: viewer **zoom and pan** with exact image-to-sky mapping (`canvasToSky`/`skyToCanvas` take image fractions today, so zoom is a
   transform of the canvas, not of the geometry), then **pixel/coordinate readout under the cursor**, then a layer list that replaces the overlay checkboxes.
2. Before the larger rework of the page layout (three panels), decide whether it may change what judges see on 14-15 Nov; `main` still has the old page.
3. Run the new tests in CI once the branch is pushed by the author (the action versions in `tests.yml` were written from memory).

## Decisions made

- **Branch, not a new repository**: the working copy's `origin` is `mateibut/SPHEREx`, which the brief calls the original; `main` stays at `3f1e538`. Pushing the
  branch (for example to `SPHEREx-Blink-2.0`) is the author's step.
- **Deep Space is the default theme** as the brief asks; Classic keeps the original identity one click away. Changing the default is one constant in `theme.js`
  and the `data-theme` attribute of the two pages (the test checks that they agree).
- **Light theme keeps dark islands** (banner, image stage, charts): the Plotly series colours were validated against a dark ground and images are dark by nature.

## Blockers and risks

See [PROJECT_AUDIT.md](PROJECT_AUDIT.md) §4. The ones that matter for the next session: the eligibility question (A7), the unreviewed data licence (A8), heavy searches on the main thread (A1).
