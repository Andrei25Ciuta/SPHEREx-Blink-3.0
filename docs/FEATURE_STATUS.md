# Feature status (8 Nov 2026)

One line per feature, from the code and the tests as they are on branch `blink-2.0`. Status words:
**validated** = measured on real SPHEREx data (numbers in [VALIDATION.md](VALIDATION.md)); **tested** = automatic tests on synthetic inputs only;
**manual** = checked by hand in a browser, no automatic test; **experimental** = works, but its scientific claim is limited or unproven;
**missing** = not implemented. Evidence counts are `PASS` lines / pytest tests of 8 Nov 2026.

## Implemented

| Feature | Where | Status | Evidence and known issues |
|---|---|---|---|
| Blink, Difference, Stack, Trail | `js/player.js` | manual | used on real and synthetic data; the maths has no dedicated test file |
| Compare A / B | `js/features/compare.js` | tested | `test_compare.mjs` (21) |
| Flagged-pixel overlay, skip flagged frames | `player.js`, backend `flags.py` | tested (backend), manual (overlay) | `test_flags.py` |
| Measure a source (spectrum, light curve) | `js/features/measure.js`, `/api/photometry` | validated | Jansky scale agrees with 2MASS/AllWISE stars to 2-10 % (VALIDATION §3); `test_measure.mjs` (17) |
| Find movers | `js/features/movers.js` | validated | blind runs recover Barnard's Star and Epsilon Indi B; calibrated by injection and empty-sky copies (VALIDATION §2, §10); `test_movers.mjs` (65). Limits: needs 3 survey passes, motion above about 0.8 px, 20-30x less sensitive near a saturated star; sensitive to the pixel grid (`det=all` vs one detector) for marginal lines |
| Spectrum along a mover's path, colour hint | `movers.js`, `spectrum.js` | experimental | colour hint cannot separate an M dwarf from an early T dwarf (VALIDATION §3); `test_spectrum.mjs` (31) |
| Planet X mode (Earth parallax) | `js/features/parallax.js` | experimental | recovers Makemake (52.65 vs 52.62 AU) when told where to look; the blind search found it once, with loosened options, among 38 candidates (empty fields give about 33); `test_parallax.mjs` (56). A Planet-Nine-like body is out of reach of single images (§11) |
| Known asteroids (SkyBoT) | `js/features/skybot.js` | validated | asteroid Arosa found 1.0″ from the ephemeris and shown to move (VALIDATION §6); `test_skybot.mjs` (35) |
| Catalogue stars overlay (SIMBAD) | `js/features/catalogue.js` | tested | `test_catalogue.mjs` (24); real data only |
| **Find everything** (all sources, 4 catalogues, vetting, dossier) | `js/features/{discovery,vetting,crossmatch,dossier,catalogueRelay,discoverPanel}.js`, `backend/spherex/catalogues.py` | experimental | 42 of 42 sources on six real fields explained by Gaia; empty-sky control 0.047 false leads per field at the chosen threshold; depth 0.7-1.5 mJy (fixed) in a clean field; **nothing new found** (VALIDATION §14); `test_discovery.mjs` (60), `test_catalogue_relay.mjs` (26), `test_discover_panel.mjs` (31), `test_catalogues.py` (31); panel checked in a browser (manual) |
| Export (movers CSV/JSON; sources CSV/JSON; dossier Markdown; positions CSV) | `export.js`, `dossier.js` | tested | `test_export.mjs` (21); the positions CSV is **not** an MPC/ADES report |
| Colour themes (Deep Space default, Observatory, Light research, Classic) and switch | `css/styles.css` section 1, `js/features/theme.js` | tested, manual | `test_theme.mjs` (46): contrast of every text colour on every surface in every theme, token completeness, persistence logic; script audit in a browser at 375 px in all four themes. Not checked: a real phone, other browsers, the Plotly chart in the light theme |
| Guided tour | `js/features/tour.js` | tested | `test_tour.mjs` (18) |
| Sky map (Aladin Lite) and country readout | `skyContext.js`, `skyGeo.js` | tested (readout), manual (map) | `test_skygeo.mjs` (25); the map needs a CDN |
| Real-data results page | `results.html`, `js/results.js`, `data/real_results.json` | tested | `test_results.mjs` (50) checks the data file against VALIDATION.md; numbers only, no pixels |
| Share (PNG, WebM, link), embed (`?embed=1`) | `exporters.js` | manual | |
| URL state (`?ra=&dec=&fov=&det=&mode=`) | `urlState.js` | manual | |
| Backend: cutouts, float pixels, bad-pixel mask, photometry, HiPS relay, catalogue relay | `backend/app.py`, `backend/spherex/` | tested | pytest 143; only `/api/catalogue` is exercised at the HTTP layer (as a function) |
| Injection and recovery, empty-sky control | `scratch/calibrate_real.mjs`, `scratch/validate_discovery.mjs`, `scratch/planet_x_limits.mjs` | validated, command line only | not in the interface; results in VALIDATION §10-§14 |
| Synthetic demo data | `js/data/mockSource.js` | tested | `test_mock.mjs`; always labelled synthetic (badge, export columns) |

## Missing (named in the 2.0 mission, not implemented)

| Feature | Notes |
|---|---|
| Reusable dialog and tooltip components, icon system | buttons, inputs, cards and tables share CSS; no dialog, tooltip or icon system; **Phase 1 remainder** |
| Three-panel workstation (controls / viewer / inspector), collapsible panels | today: one column of panels |
| Viewer zoom, pan, pixel and coordinate inspection, coordinate grid, scale bar | not present in `player.js` |
| Layer manager with per-layer visibility | the overlays are separate checkboxes (flags, predicted tracks, SIMBAD, asteroids) |
| Timeline 2.0 (detector and wavelength labels, filtering) | there is a frame slider with date and frame number |
| Candidate Explorer with diagnostic plots and cutouts | the movers list and the *Find everything* list with dossiers cover part of it |
| Side-by-side multi-detector comparison, matched sources across detectors | the "All detectors" overview and Compare A/B exist |
| Planet X Lab (model comparison, distance uncertainty, completeness heat maps in the interface) | the parallax search and the command-line injection tests exist |
| Spectral analysis with uncertainty bands and reference spectra | spectrum plot and colour hint exist |
| Observation footprints on the sky map | no footprint data is served |
| Results dashboard 2.0 (candidate table, provenance per result) | the current results page is static numbers and charts |
| 3D Solar System simulator | |
| AI research assistant (optional, evidence-grounded) | |
| Web Workers for the searches; benchmarks | |
| Playwright end-to-end tests; CONTRIBUTING.md; CHANGELOG.md | |
| Rate limiting and request size limits on the backend | see [PROJECT_AUDIT.md](PROJECT_AUDIT.md) A3 |
