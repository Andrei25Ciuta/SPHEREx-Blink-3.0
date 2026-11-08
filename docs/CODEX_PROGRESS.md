# Progress: SPHEREx Blink 2.0

Read `AGENTS.md` first. Update this file after every working session. Last update: **8 Nov 2026**, branch `blink-2.0`.
Verify what is written here against `git log` and the test commands in `AGENTS.md`; do not trust it blindly.

## Where it stands

**Phase 0 (audit) done. Phase 2 (workspace) done, with limits: the viewer, the timeline, the three-panel layout (search / picture / inspector, side panels that close) and the inspector are in; a view that follows a candidate, layer order and opacity are not. Phase 3 (results dashboard and candidate explorer) mostly done: provenance, the candidate table and plot, the six real fields' sources made by a command, and an origin line under each of sections 1-10 (the command and the VALIDATION.md section); the numbers of sections 1-10 are still typed into `real_results.json` from the reports of those commands. Phase 1 (design foundation) mostly done. Phase 4 (scientific pipeline) mostly done: positions, velocities and fluxes carry errors checked against repeated injections and real stars (VALIDATION §15); a PSF-fit centroid and the parallax search's errors are not done.** Phases are defined in
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

| 8 Nov | Phase 3, first part: **provenance** (input, settings, algorithm version, time of the run, built when a search finishes; on the page, in the CSV columns, the JSON and every dossier); **candidate explorer** (table with sort by column, filter, search, paging; a plot of support against S/N with the "needs checking" line) in the *Find everything* panel ("Table and plot") and on the results page; **results page section 11**: all 42 sources of the six real fields from `frontend/data/real_sources.json`, made by `scratch/make_results_sources.mjs`, each field with its provenance | `test_provenance.mjs` (28), `test_explorer.mjs` (37), `test_results.mjs` (+14: the file against VALIDATION §14 field by field, complete provenance, made by the algorithm and settings of the code now, no pixel and no local address), `test_discovery.mjs` / `test_export.mjs` / `test_discover_panel.mjs` extended. Real data: the second run reproduced §14 (8, 6, 7, 3, 14, 4 = 42, all four catalogues answered, no problem); built-in browser: provenance in the movers and Find everything exports, table sort/filter/search/select, paging on the results page, 375 px: no page overflow after two fixes (a grid column grown to the table's width in `index.html` and `results.html`) |

| 8 Nov | Phase 4, first part: **errors of positions, motions and fluxes measured and fixed** (VALIDATION §15). Measured first: the windowed centroid has no bias on average but a pixel-phase bias of up to 0.05 px; the velocity error was a floor 2-4 times too large; the aperture flux error left out the background term (8-13 % too small) and is 1.7 times too small on real cutouts. Now: every dot has `sigmaPx` (σ² = (1.05/S/N)² + B²), the velocity error is propagated from the dots (`lineUncertainty`) with a systematic floor of 0.04 px found on real stars, the dossier has `± mJy` (`calibratedFluxErr`: `errTotal`, ×1.7 on real cutouts) and the candidate's position error comes from the dots; `ERROR_MODEL` goes into every provenance record; versions `movers-2` / `discovery-3` | `test_astrometry.mjs` (31: spread of z 0.98-1.00 for positions, 0.89-0.96 for faint movers, 1.00 for fluxes; the exact velocity formula on 6 000 lines); `calibrate_astrometry.mjs` (the tables), `check_astrometry_real.mjs` (real fixed stars: z 0.97 at S/N 20-60; empty sky 1.68). **No regression on real data**, A/B with the committed code: the same candidate with the same motion, chance number and path support in all 6 blind runs (significance of Epsilon Indi B 8/7/11 → 15/11/18 σ), empty-sky control 316/225/86/12/0 → 315/225/86/12/0 false leads, the injection table identical, the 42 sources identical; `real_sources.json` remade |
| 8 Nov | Phase 2, fourth part: **three-panel workspace and inspector**. From 1180 px: search / picture / inspector (the inspector stays in view while the page scrolls); from 861 px: search beside the picture, the inspector below; below that one column with the picture first. The search panel and the inspector close (a button each, keys `[` and `]`), a closed panel is a thin rail on a wide screen, the picture takes its room (never taller than the window), the choice is kept in `localStorage` (not in the link). The inspector holds the facts of the image on screen (detector, wavelength, MJD, flags), the **marked position** (pixel, RA/Dec, offset: it follows the measuring circle wherever it is set or cleared) and, on a wide screen, the description of the selected candidate (`#mover-detail`, `#discover-detail` are moved there and back; same ids and code) | `scratch/test_workspace.mjs` (53): breakpoints equal to the CSS ones, the saved choice (damaged or blocked storage: both open), keys, moving the descriptions, the layout read from the media queries (a first version read `innerWidth` and lagged in an emulated resize: found in the browser, fixed, test added), page markup (ids, aria, order). Built-in browser, real data (Barnard D2): 1440 px three panels; Find movers found Barnard's Star and its description appeared in the inspector; a click marked RA 17h57m44.70s Dec +04°46′38.7″, the same as the section-3 measurement; Escape cleared it; closing panels: picture 622 → 756 px; 1000 px two columns; 375 px one column, no horizontal overflow, 44 px buttons |
| 8 Nov | Phase 3, second part: **where the numbers of sections 1-10 come from**: `origins` in `real_results.json` (the command or commands and the VALIDATION.md section of each section), shown under each heading (`originHtml`), saying openly that the numbers were typed into the file from the report of the command on the day of the measurement and that the page does not remake them | `test_results.mjs` (+9, 73 in all): one origin per section 1-10 in order, every command names a script that exists, every cited VALIDATION.md section exists as a heading, no address in a command, each page section has its origin line right under its heading, the date and the text, the data file is still under 12 000 bytes. Browser: ten origin lines drawn, no overflow, no console error |

## Tests (8 Nov 2026, after the workspace panels and the origins of the results page)

- Node: 24 files, all exit 0, **833** `PASS`, 0 `FAIL` (`test_coords` and `test_mock` print differently and are not counted).
- Backend: `pytest backend`: **146** passed.
- CI on GitHub: both jobs of `tests.yml` passed on the pull request (https://github.com/mateibut/SPHEREx/pull/2) for commit `180d4ef`; the work after it is not pushed. Not run: Playwright (none exist), a real touch screen, other browsers, any screen-reader check.
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

## Files changed in Phase 3 (first part)

New: `frontend/js/features/{provenance,candidateExplorer,candidateExplorerView}.js`, `frontend/data/real_sources.json`, `scratch/{test_provenance,test_explorer,make_results_sources}.mjs`.
Changed: `movers.js` (`VERSION`), `parallax.js` (`VERSION`, `DISTANT_DEFAULTS`: the same defaults, now exported), `discovery.js` (`SETTINGS`), `export.js` and `dossier.js` (provenance columns, JSON and
Markdown; `dataLabel` now defined in `provenance.js`), `discoverPanel.js` (provenance, "Table and plot", `explorerRow`, `FILTERS` moved to `candidateExplorer.js` and re-exported), `main.js` (the movers' run record),
`results.js` and `results.html` (section 11, the old 11 is now 12), `index.html`, `styles.css`, `results.css`, tests and docs. One existing check was **changed on purpose**: the cell count of
`test_export.mjs` used a regular expression that miscounts a line ending in an empty cell; it now uses a real CSV line parser (same intent, stricter).

## Files changed in Phase 4 (first part)

New: `scratch/{lib_inject,test_astrometry,calibrate_astrometry,check_astrometry_real}.mjs`. Changed: `movers.js` (`centroidSigmaPx`, `lineUncertainty`, `calibratedFluxErr`, `ERROR_MODEL`, `sigmaPx` on dots, `vErrPx` / `posErrPx` on candidates,
`errTotal` in `apertureSnr`, `VERSION` movers-2), `discovery.js` (`fitTrack`, `posErrArcsec`, `fluxErrMilliJy`, `SETTINGS`, `VERSION` discovery-3), `dossier.js` and `discoverPanel.js` (`± mJy`), `main.js` (the error model in the movers' provenance),
`frontend/data/real_sources.json` (remade), `test_discovery.mjs` and `test_provenance.mjs` (version labels no longer hard-coded), docs. The searches' behaviour is unchanged; only the reported errors are.

## Files changed in Phase 2 (fourth part) and Phase 3 (second part)

New: `frontend/js/features/{workspace,workspaceView}.js`, `scratch/test_workspace.mjs`.
Changed: `index.html` (the search panel has a head with a button and a body; a new `<aside id="inspector">` takes the frame facts, which moved out of the picture panel; the keyboard hint), `styles.css` (a section at the end: panel heads and buttons, the three layouts, the closed rails, the picture's room), `main.js` (`setupWorkspace`, the marked position), `viewerControls.js` (`describeAt`), `player.js` (`onMarkerChange`), `results.js`/`results.html`/`results.css` (`originHtml`, `fmtDate`, an origin line under sections 1-10), `real_results.json` (`origins`), `test_results.mjs` (+9), docs. No check was weakened or changed.

## Remaining in Phase 4

- A **PSF-fit centroid** (the windowed centroid stops at 0.04 px for bright stars; the best possible is 5-16 times smaller on injected stars) and a PSF width per image instead of the cautious default.
- The **parallax search** still uses its 0.15 px floor; Epsilon Indi B's 0.5″/yr offset from the catalogue is unexplained (a systematic); the flux errors of the backend's spectrum chart (`photometry.py`) are not recalibrated.

## Remaining in Phase 3

- Sections 1-10 of the results page: the numbers are typed into `real_results.json` from the reports of the commands (`origins` names the command and the VALIDATION.md section of each section, the page shows it, `test_results.mjs` checks that the scripts and the sections exist and that the headline numbers stand in VALIDATION.md). Making the file with the scripts (a `--json` output for `validate_real.mjs`, `calibrate_real.mjs`, `real_parallax.mjs` and the Python ones, then one `make_results_data.mjs`) is not done; it needs the real backend and would change numbers measured with older code.
- The table has no pictures (stamps) or spectra in its rows: they are in the dossier a row opens. A comparison of candidates across fields in the live app does not exist.

## Remaining in Phase 2

- The real pixel value (the file's unit) is shown in Blink mode only; in Stack, Trail, Difference and Compare the readout gives display levels (0-255 of the stretched picture), said to be such.
- The layer settings (opacity, order) are not remembered between visits; the follow-it view stops when the picture is moved by hand.

## Remaining in Phase 1

- The icons are on two buttons and in the state boxes; the other buttons still have text only (several of them rewrite their own text for feedback, which would erase an icon).
- State boxes are used in the explorer table; the other empty and error messages of the page (the overlay on the picture, the status lines) are still written one by one.
- Classic keeps the original faint input borders (below 3:1): known, kept on purpose.

## Next recommended steps

1. Phases 2 and 3 are finished as far as this note says; what is left in each is listed above. The next phases (5-10) are Planet X Lab, spectral and multi-detector analysis, footprints, the simulator, the assistant and hardening.
2. The page layout changed (three panels): `main` still has the old page, so decide when this branch replaces it.
3. Run the new tests in CI once the branch is pushed by the author (the action versions in `tests.yml` were written from memory).

## Decisions made

- **Branch, not a new repository**: the working copy's `origin` is `mateibut/SPHEREx`, which the brief calls the original; `main` stays at `3f1e538`. Pushing the
  branch (for example to `SPHEREx-Blink-2.0`) is the author's step.
- **Deep Space is the default theme** as the brief asks; Classic keeps the original identity one click away. Changing the default is one constant in `theme.js`
  and the `data-theme` attribute of the two pages (the test checks that they agree).
- **Light theme keeps dark islands** (banner, image stage, charts): the Plotly series colours were validated against a dark ground and images are dark by nature.

## Blockers and risks

See [PROJECT_AUDIT.md](PROJECT_AUDIT.md) §4. The ones that matter for the next session: the eligibility question (A7), the unreviewed data licence (A8), heavy searches on the main thread (A1).
