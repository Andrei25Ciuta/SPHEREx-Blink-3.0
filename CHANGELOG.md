# Changelog

All notable changes to SPHEREx Blink. Dates are the commit dates (`git log`); the hashes can be looked up with `git show`. Numbers are in the documents
named next to them and come from commands that can be re-run. Nothing here is a release: the work after `main` lives on the branch `blink-2.0` and is not
published until the author decides ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

## Blink 2.0 (branch `blink-2.0`, not released)

The reference is `main` at `3f1e538` (7 Nov 2026). Status per phase: [docs/IMPLEMENTATION_ROADMAP.md](docs/IMPLEMENTATION_ROADMAP.md); feature by feature,
with what was and was not checked: [docs/FEATURE_STATUS.md](docs/FEATURE_STATUS.md).

### Provenance in every saved picture (10 Nov 2026)
- **Found:** the saved PNG and the recorded video carried no label. They now print a caption into the image (real, or SYNTHETIC and not an observation, plus field, detector, date, mode); `test_exportlabels.mjs` audits all 13 save points; 17th browser check. Item 6 of the ten; 7-10 not done.

### Cancel and size estimate (10 Nov 2026)
- Find movers and the Planet X search show their size and a rough range before they start, the elapsed seconds while they run, and a Cancel button when a worker runs them (`workerClient.js` takes an AbortSignal; `searchCost.js`; `test_cancel.mjs`; a 16th check in `e2e_smoke.mjs`). No real progress bar; Find everything and the dot detection are not cancellable. Item 5 of the ten improvements; 6-10 not done.

### Calibrated uncertainty and a broader blind check (10 Nov 2026)
- `features/uncertainty.js`: the error of a velocity split into statistical, excess scatter and systematic parts (nominal beside calibrated), and warnings for what could make a candidate less reliable; three new columns in the text-analysis table and CSV. `scratch/validate_uncertainty_real.mjs` tests the error on the six real fields with injected movers and 300 empty copies each (VALIDATION 20): **the error is too small in Barnard D2 (61 % inside 1σ), too large in Barnard D6, about right in four fields, with heavy tails; a false candidate can show 143σ.** The error model was not changed. The movers benchmark digest was rewritten because candidates carry four more fields (the digest without them is unchanged). Item 4 of the ten improvements; 5-10 not done.

### Reproducibility bundle, and a correction found by it (10 Nov 2026)
- Section 9: "Save the bundle (JSON)": the field, the versions, the settings of the last search, a SHA-256 of every image the search used, the candidates, a replay link and a command; `scratch/replay_bundle.mjs` reads the same images from a backend, compares the hashes and runs the same search (REPRODUCED or what differs). Item 3 of the ten improvements.
- **Correction:** the bundle listed the same image twice: the backend held three exposures of Barnard's Star in D2 twice (byte-identical files), so they counted as two measurements. The backend now skips exact copies (`/api/health` lists them: 75 files, 72 frames). Sections 1-6 of the results page were remade (Barnard reproduces the numbers of 7 Nov; the first run of the day, with the copies, had wrongly given 0.61 ″/yr); sections 8-9 and VALIDATION 10, 14, 16 were made with the copies in and carry a notice.

### Keyboard and screen-reader audit (10 Nov 2026)
- `scratch/a11y_audit.mjs`: 18 checks with real key presses in headless Chrome (also a CI job). It found and fixed: the image change was not announced (a live region now says it), measuring a position needed a mouse (the picture takes focus, the centre of the view is read out, Enter measures there), two targets under 24 px. Not listened to with a real screen reader. Item 2 of the ten improvements.

### Text analysis (10 Nov 2026)
- Section 9: the images, the dots and the candidates as plain tables, no picture, for a screen reader and the keyboard; CSV with the provenance first; checked in the browser, not with a screen reader. The first of ten improvements the author listed on 10 Nov (accessibility, provenance, uncertainty, validation, bundles, failure behaviour, performance, interpretation, release checks); the others are not done.

### Results page: sections 1-6 made by a command (10 Nov 2026)
- Sections 4-6 too (the Jansky scale, the asteroid Arosa, the WISE 0855 stack): most numbers did not move (WISE 0855 is identical to 7 Nov; the Jansky medians moved by 0.001; the Arosa flux errors are 10-30 % larger since the Phase 4 change of the flux error). VALIDATION 19.

- `scratch/make_results.mjs` remakes the numbers of sections 1-3 from the real images (the six blind searches, the original rule, the mask) into `real_results_generated.json`, laid over the typed file by the page; the page says which sections are made and which typed. The numbers moved (Barnard D2 0.31 → 0.61 ″/yr with 18 images instead of 15); the failure of the original rule can no longer be remade by the code and is kept as a record (VALIDATION 2.1).

### Survey coverage (10 Nov 2026)
- Section 6: *Which survey images cover a place?* A live search of IRSA's table `spherex.plane` through the backend (`GET /api/survey`): the footprints of the survey's images around a position at true scale, the images that cover the centre, in how many survey passes. It agrees with IRSA's own count at 7 of 7 comparable positions (`scratch/check_survey_live.mjs`, VALIDATION 18). The `e2e` smoke test has a 13th check (the button is disabled, with its reason, on the synthetic demo).

### Phase 10: hardening (9 Nov 2026)
- The two long searches (Find movers, the Planet X search) run in a module worker, with the same task as the fallback on the page when no worker can be had
  (`searchTasks.js`, `workerClient.js`, `searchWorker.js`; `test_workers.mjs`). The page records where the last search ran (`data-last-search`). `0c67f0d`
- `scratch/benchmark.mjs`: three deterministic scenarios with golden digests of their output; a test fails when a search gives another answer
  (`test_benchmark.mjs`). [docs/BENCHMARKS.md](docs/BENCHMARKS.md)
- `scratch/e2e_smoke.mjs`: the page in headless Chrome over the DevTools Protocol with Node only (no Playwright, no npm): 15 checks on the synthetic demo; a
  separate job in `tests.yml` (green in CI on PR 2, 10 Nov 2026; the golden digests are identical on Node 20 / Linux).
- Documents: BENCHMARKS, DEPLOYMENT, CONTRIBUTING, this file.
- Measured and said: no search got faster; Find movers no longer stops the page (longest gap between frames 15-28 ms against 396-499 ms), the Planet X search
  gains little because the dots are still found on the page.

### Phase 9: explainer (8 Nov) `57bd456`
- Section 8: three questions about the selected candidate, every sentence citing the measured values it is made of, a validator that refuses a number that
  is not in what it cites. No language model, no key, no network.

### Phase 8: Solar System simulator (8 Nov) `3eb6cda`
- Section 7: a top view of the eight planets, scientific and educational ("NOT TO SCALE") modes, a distant body with the lines of sight on the survey dates;
  the planets checked against JPL Horizons (VALIDATION 17).

### Phase 7: sky explorer (8 Nov) `afddd59`
- Section 6: an all-sky map of the footprints of the image files, from their own WCS (`GET /api/footprints`, no path or file name served).

### Phase 6: spectral and multi-detector view (8 Nov) `6b11614`
- The six detectors side by side with the missing ones marked; the spectrum's uncertainty as a band that breaks where no image covers the wavelengths.

### Phase 5: Planet X Lab (8 Nov) `4adf08e`
- Section 5: which motion fits (stationary / line / line plus parallax, by BIC; the distance only when constrained) and how likely a distant body is to be
  found (synthetic bodies injected into the real images, in a worker; VALIDATION 16).

### Phase 4: positions, motions and fluxes with errors (8 Nov) `180d4ef`, `e93d2a6`
- Errors of positions, velocities and fluxes measured against repeated injections and real stars, and corrected (VALIDATION 15). A PSF-fit centroid that is
  worse than the windowed one on the real images, so it is off by default (15.7). A calibrated flux error for the backend's photometry.

### Phase 3: provenance, explorer, results page (8 Nov) `dead397`, `e559357`, `1a620a5`
- Provenance (input, settings, algorithm version, time) on every result and export. A candidate table with sort, filter, search and paging, and a plot.
  Every source of the six real fields on the results page (section 11); each of sections 1-10 names the command its numbers come from.

### Phase 2: workspace (8 Nov) `d6b76d1`, `c5441fe`, `4a7aab6`, `e907b68`, `c47f042`
- Zoom, pan, pixel and sky readout, scale bar, layer list (order, opacity), coordinate grid, centre or follow a candidate, a timeline by time and
  wavelength, three panels with an inspector.

### Phase 1: design foundation (8 Nov) `c910066`, `c9c3396`
- Four colour themes from CSS tokens (`?theme=`), a theme switch, tabular digits, tooltips that work with the keyboard, a modal dialog with the shortcut
  list, one box for empty and error states, icons.

### Phase 0: audit (8 Nov) `ea18243`
- PROJECT_AUDIT, ARCHITECTURE, FEATURE_STATUS, SCIENTIFIC_LIMITATIONS, the roadmap, AGENTS.md and the progress file.

### Find everything (8 Nov) `6dc79b9`
- Every source, vetted, cross-matched with Gaia, 2MASS, AllWISE and SIMBAD, ranked.

## Before Blink 2.0 (`main`, 5-7 Nov 2026)

The MVP (blink viewer, backend, stretch features), Find movers, real SPHEREx data support, the Planet X parallax mode, the results page and the first
validation on real data. See `git log main`.
