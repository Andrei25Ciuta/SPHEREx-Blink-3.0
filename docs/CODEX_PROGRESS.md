# Progress: SPHEREx Blink 2.0

Read `AGENTS.md` first. Update this file after every working session. Last update: **8 Nov 2026**, branch `blink-2.0`.
Verify what is written here against `git log` and the test commands in `AGENTS.md`; do not trust it blindly.

## Where it stands

**Phase 0 (audit) done. Phase 1 (design foundation) mostly done. Phase 2 (workspace) mostly done: the viewer (zoom, pan, readout, scale bar, coordinate grid, centre on a candidate, layer list) and the timeline (time × wavelength plot, survey-pass switches, wavelength window) are in; the three-panel layout and the inspector panel are not.** Phases are defined in
[IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md).

## Completed

| When | What | Evidence |
|---|---|---|
| 8 Nov | **Find everything** (before the 2.0 brief): every source, vetting, four catalogues at their own epochs, SkyBoT, support score, classes, dossier, exports; backend `/api/catalogue` relay; `apertureSnr` hole fix; shadow-mover and motion-disagrees rules | commit `6dc79b9`; VALIDATION §14; tests below |
| 8 Nov | Phase 0: [PROJECT_AUDIT.md](PROJECT_AUDIT.md), [FEATURE_STATUS.md](FEATURE_STATUS.md), [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md), [ARCHITECTURE.md](ARCHITECTURE.md), [SCIENTIFIC_LIMITATIONS.md](SCIENTIFIC_LIMITATIONS.md), `AGENTS.md` | files exist; statements checked against the code on 8 Nov |
| 8 Nov | Phase 1: CSS tokens in four themes (**Deep Space** default, **Observatory**, **Light research**, **Classic** = the original look), theme switch in both pages, choice kept in `localStorage`, `?theme=` override, no flash (inline head script), JetBrains Mono + tabular digits for numbers, dark "islands" (banner, image stage, charts) inside the light theme, `control-border` token (3:1) | `scratch/test_theme.mjs` (46 checks: contrast of every text colour on every surface in every theme, token completeness, `theme.js` behaviour, the pages' script and markup); built-in browser at 375 px in all four themes: no horizontal overflow, 0 low-contrast text nodes of 150-350 (script audit; `rval.inside` bar values are a false positive of the script, their colour pair is covered by the token test), choice persisted from the app to the results page |
| 8 Nov | Phase 2, first part: **viewer zoom and pan** (×1 to ×32; buttons, keys `+ - 0`, Shift + arrows, Ctrl + scroll / trackpad pinch, two-finger pinch, drag; a drag never measures), **pixel / RA-Dec / offset / value readout** under the pointer, **scale bar**, **layer list** (flagged pixels, predicted positions, SIMBAD stars, asteroids, movers found, measuring circle, scale bar: each its own switch, a colour key that is the colour on the canvas, a count), the cross-hair follows the picture; backend frames now carry `unit` (the file's `BUNIT`) and `STRETCH_VERSION` is 5 | `scratch/test_view.mjs` (55): the maths of the view (round trip, the point under the cursor stays under it, edges, zoom limits), the **sky mapping unchanged by zoom and pan** (3000 random views, under 1e-10 degrees), scale bar, layer registry against `index.html`, readout text; `backend/tests/test_cutout_unit.py` (3). Built-in browser, real data (Barnard D2): readout RA/Dec equals the click measurement at the same point; a drag does not measure and the next click does; keys and limits; pinch (synthetic touch events); the "Movers found" and "Scale bar" layers change the canvas and restore it; value 680.2 and 4.206 MJy/sr read from the backend's float file with a separate script match the readout; 375 px: no overflow; contrast audit on a fresh load of each theme: 0 low-contrast text nodes |
| 8 Nov | Phase 2, second part: **coordinate grid** (a layer, off by default: RA and Dec lines on round values, finer with zoom, labels on the bottom and right edges, the spacing in a corner) and **Centre the picture on it** (a button in a mover's description and in a *Find everything* dossier: zooms to at least ×6 and puts the candidate in the middle; in Stack and Trail the middle of its path) | `scratch/test_grid.mjs` (26): each line is at the RA or Dec it is labelled with (1500 random views, error 0), never closer than 96 / 64 px, steps and labels by hand (5′ cutout: 1′ and 5 s; ×32: 2″ and 0.2 s), RA = 0 wrap, a pole, and the **flat-sky error against the exact TAN projection** (0.002-0.035 px at the corner of a 5′ cutout, 1.2 px for a 30′ cutout at Dec 60°); `test_view.mjs` gained 8 checks for centring. Built-in browser, real data (Barnard D2): the grid lines are drawn at the pixels the module gives; after *Centre the picture on it* the readout at the middle of the picture is RA 17h57m47.07s Dec +04°46′08.0″ for Barnard's Star, whose own text says 17h57m47.07s +04°46′07.8″ (the middle of its observations; the picture shows one image, 0.2″ away); for a source of the dossier (62″ north of the field centre) the middle of the picture reads the dossier's own position; 375 px: no overflow |

| 8 Nov | Phase 2, third part: **Timeline 2.0**: a plot with one button per image (time order across, grouped by survey pass; wavelength up), the image on screen marked, hollow points for images the filter leaves out, diamonds for more than 1 % flagged pixels; **survey-pass switches** and a **wavelength window** (two sliders); the filter changes what the blink visits and what Stack, Trail and Difference are made of (not the searches); *Show all*; the player has `active` images (`setActive`, stepping and Play over them, Stack and Trail over them, Difference reference from the active images of other passes); the recorded video loops over the active images | `scratch/test_timeline.mjs` (36); built-in browser, real data (Barnard D2, 18 images, 4 passes): click shows the image; window 1.30–1.50 µm leaves 3, arrow keys visit only those, "Stack of 3 of 18", Difference runs, the slider reaches every image; a pass off removes its 5; no image left: Play disabled, no error; 375 px no overflow, 0 low-contrast text in Light and Classic |

## Tests (8 Nov 2026, after Phase 2, third part)

- Node: 20 files, all exit 0, **651** `PASS`, 0 `FAIL` (`test_coords` and `test_mock` print differently and are not counted).
- Backend: `pytest backend`: **146** passed.
- Not run: CI on GitHub (nothing pushed), Playwright (none exist), a real touch screen, other browsers, any screen-reader check.
- Method note: changing `data-theme` from a script in a pane that is not visible freezes the CSS transitions and gives false low-contrast results (light and classic showed 10 "failures" that vanished on a fresh load with `?theme=`).

## Files changed in Phase 1

`frontend/css/styles.css` (tokens, themes, switch, numerals, hero wrap), `frontend/css/results.css`, `frontend/index.html`, `frontend/results.html`
(theme attribute, head script, fonts, switch), `frontend/js/features/theme.js` (new), `frontend/js/main.js`, `frontend/js/results.js`,
`scratch/test_theme.mjs` (new), `scratch/test_results.mjs` (the `<html>` check allows the new attribute), `README.md`, docs listed above.

## Files changed in Phase 2 (first part)

New: `frontend/js/features/{view,readout,layers,viewerControls}.js`, `scratch/test_view.mjs`, `backend/tests/test_cutout_unit.py`.
Changed: `frontend/js/player.js` (view applied to the picture and to every overlay through `_px`; `setView`, `zoomBy`, `panByCanvas`, `pointToFrac`, `setLayerVisible`,
`setPixelScale`, `greyLevelAt`; overlay colours from `layers.js`), `frontend/js/main.js` (viewer set up before the measuring click; the click uses `pointToFrac`; pixel scale
for the scale bar; Shift + arrows left to the viewer), `frontend/index.html` (zoom buttons, readout line, layer list replaces the overlay checkboxes; every old id kept),
`frontend/css/styles.css` (section 5: stage tools, readout, layers; tokens only), `backend/app.py` and `backend/spherex/stretch.py` (`unit`, cache version 5; the cache is rebuilt from
the local FITS files, nothing is downloaded), `frontend/js/data/getCutouts.js` (contract comment), docs and README.

## Files changed in Phase 2 (second part)

New: `frontend/js/features/grid.js`, `scratch/test_grid.mjs`. Changed: `frontend/js/features/view.js` (`centreAndZoom`, `pathCentre`), `layers.js` (the grid layer, a "cross" key),
`frontend/js/player.js` (`_drawGrid`, `setField`, `centreOnCandidate`; the scale bar moves up when the grid is on), `viewerControls.js` (the grid switch), `main.js` (`setField`, the
centre button, `deps.centre`), `discoverPanel.js` (the dossier button), `index.html` (grid layer row, centre button), `styles.css` (the cross key), `scratch/test_view.mjs`, docs.

## Files changed in Phase 2 (third part)

New: `frontend/js/features/timeline.js`, `frontend/js/features/timelineView.js`, `scratch/test_timeline.mjs`. Changed: `frontend/js/player.js` (`active`, `setActive`, `activeIndices`,
`activeCount`; `next`/`prev`/`play` over the active images; `_stat` and `_referenceFor` use them), `frontend/js/main.js` (the timeline, the Stack/Trail text, Play enabled by the active
count, the flagged limit shared with the timeline), `frontend/js/features/exporters.js` (video loops over the active images), `frontend/index.html` and `frontend/css/styles.css`
(the timeline section), docs and README.

## Remaining in Phase 2

- Three-panel layout (controls / viewer / inspector), collapsible panels: changes what judges see on 14-15 Nov, so it waits for the author's decision (see next steps).
- Inspector panel (the readout is a one-line start).
- A view that follows a moving candidate from image to image (co-moving view); layer order and opacity.
- The pixel value is shown in Blink mode only.

## Remaining in Phase 1

- Reusable dialog, tooltip and empty/error-state components (buttons, inputs, selects and cards already come from shared CSS; there is no dialog or tooltip system).
- An icon system (none; the page uses CSS shapes and text).
- Contrast check of the Plotly spectrum chart in the light theme (it sits on a fixed dark ground by design; not looked at in the light theme).
- Classic keeps the original faint input borders (below 3:1): known, kept on purpose.

## Next recommended steps

1. Phase 2 is mostly done. What is left (three panels, inspector) depends on the author's decision about the page layout; Phase 3 (results dashboard and candidate explorer) does not.
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
