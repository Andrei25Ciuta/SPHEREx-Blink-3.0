# Changelog

All notable changes to SPHEREx Blink. Dates are the commit dates (`git log`); the hashes can be looked up with `git show`. Numbers are in the documents
named next to them and come from commands that can be re-run. Nothing here is a release: the work after `main` lives on the branch `blink-2.0` and is not
published until the author decides ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

## Blink 2.0 (branch `blink-2.0`, not released)

The reference is `main` at `3f1e538` (7 Nov 2026). Status per phase: [docs/IMPLEMENTATION_ROADMAP.md](docs/IMPLEMENTATION_ROADMAP.md); feature by feature,
with what was and was not checked: [docs/FEATURE_STATUS.md](docs/FEATURE_STATUS.md).

### Survey coverage (10 Nov 2026)
- Section 6: *Which survey images cover a place?* A live search of IRSA's table `spherex.plane` through the backend (`GET /api/survey`): the footprints of the survey's images around a position at true scale, the images that cover the centre, in how many survey passes. It agrees with IRSA's own count at 7 of 7 comparable positions (`scratch/check_survey_live.mjs`, VALIDATION 18). The `e2e` smoke test has a 13th check (the button is disabled, with its reason, on the synthetic demo).

### Phase 10: hardening (9 Nov 2026)
- The two long searches (Find movers, the Planet X search) run in a module worker, with the same task as the fallback on the page when no worker can be had
  (`searchTasks.js`, `workerClient.js`, `searchWorker.js`; `test_workers.mjs`). The page records where the last search ran (`data-last-search`). `0c67f0d`
- `scratch/benchmark.mjs`: three deterministic scenarios with golden digests of their output; a test fails when a search gives another answer
  (`test_benchmark.mjs`). [docs/BENCHMARKS.md](docs/BENCHMARKS.md)
- `scratch/e2e_smoke.mjs`: the page in headless Chrome over the DevTools Protocol with Node only (no Playwright, no npm): 13 checks on the synthetic demo; a
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
