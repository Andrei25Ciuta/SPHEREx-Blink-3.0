# Runtime architecture

The static workspace enters through frontend/index.html and js/main.js. The player and feature modules consume frames through js/data/getCutouts.js. js/config.js selects the synthetic source by default or the API source with the data=api query. Results use a separate entry point, js/results.js, and read data/real_results.json.

backend/app.py exposes health, cutouts, photometry and a HiPS relay. Modules under backend/spherex handle observation lookup, FITS data, resampling, flags, stretch and photometry. backend/tests constructs small synthetic FITS frames with known WCS. The scratch directory contains both offline module checks and separate real-data experiments with external input requirements.

Both HTML pages use frontend/css/styles.css. Results-specific chart and layout rules live in frontend/css/results.css. The static frontend can be served independently with scripts/serve_frontend.py.

---

<!-- Everything below comes from the branch blink-2.0 of mateibut/SPHEREx, a second line of Blink 2.0 work that was merged into this repository on 10 Nov 2026. Where the two halves describe the same thing differently, they describe two different implementations: see docs/MERGE_NOTES.md. -->

> *Note (12 Nov 2026):* the second half of this file was written for the branch `blink-2.0` (Blink 2.0) and is merged here; it still describes the code. Where it names a branch or the
> default theme, `AGENTS.md` and the top of `docs/CODEX_PROGRESS.md` apply (repository: SPHEREx-Blink-3.0; default theme: Midnight / dark).

# Architecture

## Pieces

```
browser (frontend/, ES modules, no build step)            backend/ (FastAPI + astropy, optional)
  index.html + js/main.js  ── wires the page                 app.py          routes, CORS, error shape
  js/player.js             ── blink / difference /           spherex/query.py       index of FITS headers in SPHEREX_DATA_DIR
                              stack / trail on a canvas       spherex/cutout.py      resample every frame onto one north-up grid
  js/data/getCutouts.js    ── THE interface (Frame[])         spherex/stretch.py     shared asinh stretch -> PNG
     ├ mockSource.js          synthetic sky (default)         spherex/floatdata.py   the same pixels as float32 + bad-pixel mask
     └ apiSource.js           real data (?data=api)  ──────►  spherex/photometry.py  aperture photometry, moving objects
  js/features/*.js         ── analysis, pure functions        spherex/hips_proxy.py  IRSA sky tiles with CORS (allowlist)
  results.html             ── static numbers and charts       spherex/catalogues.py  2MASS / AllWISE / Gaia cone searches (allowlist)
                                                    spherex/footprints.py  corners of every indexed image on the sky (no paths)
```

Third parties asked **by the browser**: SIMBAD (Harvard mirror), SkyBoT (IMCCE), Aladin Lite and its survey tiles (ESA mirror, or the backend's
relay), `world-atlas` borders and Google Fonts (CDNs). Asked **by the backend**: IRSA TAP (2MASS, AllWISE), the ESA Gaia archive TAP (POST), IRSA HiPS
tiles. Real SPHEREx FITS files are read from disk only; they are never downloaded by the app and never leave the machine.

## Data contract

`getCutouts(query)` returns `Frame[]`; a frame has `mjd`, `dateISO`, `detector`, `wavelengthMinUm/MaxUm`, `imageUrl` (PNG for the player) and, with
the backend, `dataUrl` (raw little-endian float32, MJy/sr, background-subtracted, north up), `maskUrl` (1 byte per pixel, 1 = bad flag bit),
`flags`, `pixelScaleArcsec`, `unit` (the file's `BUNIT`, or null). Synthetic frames carry no `dataUrl`: the detectors then work on the 8-bit pictures and say so. The contract is
checked by `validateFrame` in `getCutouts.js`.

## Analysis modules (all pure: no DOM, no network, so Node tests can run them)

| Module | Job |
|---|---|
| `movers.js` | dots (`detectSources`, each with its position error `sigmaPx`), registration on field stars, straight-line movers with a chance-line estimate and their propagated velocity error (`lineUncertainty`), aperture S/N and the flux error to report (`calibratedFluxErr`), `ERROR_MODEL` (every constant of the error model), spectrum colour inputs |
| `parallax.js` | Earth-parallax search for distant bodies (low-precision Sun position from Meeus ch. 25) |
| `spectrum.js` | colour hint and smoothness of a spectrum |
| `catalogue.js`, `skybot.js` | request builders and parsers for SIMBAD and SkyBoT, with an injectable `fetch` |
| `catalogueRelay.js` | all four catalogues for a field, failures tolerated, wider circles for fast stars |
| `crossmatch.js` | catalogue match at each catalogue's epoch, motion-consistency check, SkyBoT body match |
| `vetting.js` | quality flags and the support score |
| `discovery.js` | `discover()`: sources (fixed, moving, one-pass), photometry in every image, matching, class; also `isShadowOf`, `fitTrack`, `stampFor` |
| `dossier.js` | one source as an object, Markdown, CSV, JSON, positions CSV |
| `discoverPanel.js` | the *Find everything* panel (DOM) and its pure helpers (texts, filters, stamps) |
| `view.js` | the viewer's zoom and pan as pure functions: image fraction <-> canvas pixel, zoom about a point, drag, keyboard step, centre-and-zoom on a point, the middle of a candidate's path, scale bar |
| `grid.js` | the coordinate grid: which RA and Dec lines are on screen, on round values, with labels (same flat-sky mapping as `geometry.js`) |
| `readout.js` | what is shown under the pointer: pixel, RA/Dec (the same conversion as a click), offset, value text |
| `layers.js` | the overlay layers: names, colours (used for drawing and for the colour key), counts |
| `viewerControls.js` | the DOM side of the viewer (not pure): buttons, drag, pinch, wheel, keys, the readout line, the layer list |
| `assistant.js` | the explainer (pure): the evidence of a candidate, the sentences of three questions each with its citations, the validator (every number in a sentence must be a cited value), the prompt and the answer parser for an optional language model (none connected) |
| `assistantView.js` | the DOM side of the explainer (not pure): the questions, the sentences with their citation chips, the evidence table; an answer is shown only if the validator passes it |
| `solarSystem.js` | the planets on a date (Keplerian elements, checked against Horizons), the Earth of the parallax search in ecliptic axes, a body that does not move and the angle it swings through, the two radial scales |
| `solarSystemView.js` | the DOM side of the simulator (not pure): the SVG view, the date and the range, the table of positions |
| `skyExplorer.js` | the sky explorer (pure): the Hammer map and its inverse, the ecliptic and the galactic plane, great circles cut at the map's edge, images grouped into fields, a field's images as arcminute offsets |
| `skyExplorerView.js` | the DOM side of the explorer (not pure): the SVG map, the list of fields, a field at true scale, open a field |
| `textAnalysis.js` | the images, the dots and the candidates as plain rows (pure): frame rows with survey passes and flag warnings, dot rows with RA/Dec, S/N, position error and warnings, candidate rows with a status in words, the provenance lines, CSV with the provenance first |
| `bundle.js` | the reproducibility bundle (pure; the hash function is injected): SHA-256 of an array, the replay link, the manifest, the validation (no pixel, path or local address), a signature of the candidates |
| `bundleView.js` | the DOM side of the bundle (not pure): hashes the pixels the searches use, builds and validates the manifest, saves it, shows the replay link and command |
| `textAnalysisView.js` | the DOM side of the text analysis (not pure): real tables with captions and scope, the live status, the focus on the result, the selector of one image, the CSV buttons |
| `surveyCoverage.js` | which SURVEY images (IRSA `spherex.plane`, via the backend's `/api/survey`) cover a place (pure): the gnomonic projection of a footprint, point in polygon, the survey passes by the rule of `passIndices`, the coverage in words, the request and its errors |
| `surveyView.js` | the DOM side of "Which survey images cover a place?" (not pure): the form, the footprints at true scale, the table; the button is disabled, with the reason, when there is no backend |
| `spectral.js` | the six detectors and what each field has of them (and what is missing), the spectrum's uncertainty as a band that breaks at gaps, the summary of what is missing at a position |
| `planetLab.js` | the Planet X Lab (pure): the three motions compared by BIC and the distance only when constrained, injecting a synthetic body into real images, the trial of the app's own search, the completeness map and its Wilson intervals, CSV |
| `planetLabView.js` | the DOM side of the lab (not pure): the comparison table, the form, the map; starts the worker |
| `../planetLabWorker.js` | a module worker that runs the injection test off the main thread (messages: run, progress, done, error) |
| `searchTasks.js` | the two long searches as plain tasks (pure): `runSearchTask("movers" \| "distant", payload)`; the same function runs in the worker and, when no worker can be had, on the page |
| `workerClient.js` | runs a task in a worker or, if the worker cannot start, stops with an error before it answered, or cannot be sent the data, on the page; says which (`inWorker`); the worker is injected, so Node tests it |
| `../searchWorker.js` | a module worker: `{ kind, payload }` in, `{ ok: true, result }` or `{ ok: false, message }` out; no DOM, no network |
| `tooltip.js` | tooltips for any element with a title or `data-tip`: where the box goes (pure), the DOM part with the delays, keyboard focus, Escape, `aria-describedby` |
| `ui.js` | the icons (inline SVG paths) and the box for an empty, error, loading or partial state (pure strings) |
| `dialog.js` | the modal dialog on the native `<dialog>`, and the list of keyboard shortcuts |
| `workspace.js` | the layout of the page: three, two or one column by width, which side panels are open (parse, save, toggle), the keys `[` and `]`, the words of the buttons, the text of the empty inspector |
| `workspaceView.js` | the DOM side of the workspace (not pure): the two side-panel buttons and keys, the saved choice, moves the description of a selected candidate between its list and the inspector; reads the same media queries as `styles.css` |
| `provenance.js` | the record of how a search was run (input, settings, algorithm version, time of the run); text and CSV columns from it; what the data is |
| `candidateExplorer.js` | rows for the candidate table: filter, search, sort by a column, pages, cell text, the support-against-S/N plot layout |
| `candidateExplorerView.js` | the DOM side of the explorer (not pure): the table, the plot, the pager; used by the *Find everything* panel and the results page |
| `timeline.js` | survey passes, the time × wavelength layout, the filter (wavelength window, passes off), stepping through the images that pass it, texts |
| `timelineView.js` | the DOM side of the timeline (not pure): one button per image, pass switches, wavelength sliders; tells the player which images are active |

## State and flow in `main.js`

Module-level variables: `allFrames` (every frame of the query), `currentFrames` (one detector), `currentQuery`, `loadToken` (raised on every load, so
a late answer is ignored), `movers`, `catalogueCache`, `asteroidState`. `loadData` fetches frames, `showDetector` sets the player, and
`clearMovers()` / `discoverPanel.clear()` reset the analysis when the data changes. A search (`Find movers`, `Find everything`) reads the float
pixels with `detectionPixels`, runs the pure module, and draws into the DOM; everything stale is dropped by comparing `loadToken`.

## The viewer: zoom is only a way of drawing

Every position in the analysis is an **image fraction** (0..1 from the top-left of the cutout) and `geometry.js` turns it into RA/Dec and back.
Zoom and pan live in `player.view = { zoom, cx, cy }` and are applied in exactly two places: when the picture is drawn (`_blit`, a source rectangle of the
image) and when an overlay point is placed on the canvas (`_px`). A mouse position goes back through `player.pointToFrac`, so a click, the readout and the
grid all use the same chain: canvas pixel -> image fraction -> sky. `scratch/test_view.mjs` and `scratch/test_grid.mjs` check that chain at random zooms and pans.

## Find everything, step by step

`discoverPanel` → `detectionPixels` (float arrays + masks) → `fetchAllCatalogues` (SIMBAD direct; `/api/catalogue` for 2MASS, AllWISE, Gaia) →
`fetchSkybotForFrames` → `discover()` → list, dossier, exports. Without the backend only SIMBAD is asked and every source stays "not checked":
SIMBAD alone cannot say that something is new.

## Backend conventions

`GET /api/survey` (`backend/spherex/survey.py`) is a relay of IRSA's table `spherex.plane`, like `/api/catalogue` for 2MASS and AllWISE: IRSA sends no CORS headers, so the browser cannot ask it. One query at a time (a lock shared with the catalogue relay), the answer cached on disk for a day (the age is read from the time stored in the answer), only validated numbers and a detector from a fixed list in the ADQL text, a failure is HTTP 502 and is not cached. It returns the footprints IRSA publishes (detector, dates, wavelength range, four corners), never a path or a file name of this computer.

Errors are `{"detail": "..."}` (FastAPI's own shape; `ValueError` becomes HTTP 400, an unreachable upstream HTTP 502, a refused catalogue HTTP 403). Answers are
cached on disk under `backend/cache/` (keys include the input files and an algorithm version). CORS allows every origin for GET.

## Tests

`scratch/test_*.mjs` (Node, no install; `PASS`/`FAIL` lines, non-zero exit on failure) and `backend/tests` (pytest, synthetic FITS made on the fly).
`.github/workflows/tests.yml` runs both, and a third job runs `scratch/e2e_smoke.mjs`. Scripts that need the real files (`validate_*.mjs`, `calibrate_real.mjs`, ...) are not run in CI.

- `scratch/e2e_smoke.mjs`: the page in headless Chrome or Edge, driven over the DevTools Protocol with Node only (Node 22+ for the built-in WebSocket; no Playwright,
  no npm). It serves `frontend/` itself, loads the **synthetic** demo, walks the main path and fails on a console error, an exception or a request to any host but its own
  server (the web fonts are answered with an empty file). It is not in the `test_*.mjs` set because it needs a browser.
- `scratch/a11y_audit.mjs`: the keyboard and screen-reader audit (real key presses in headless Chrome, 18 checks, four themes; `--theme`, `--verbose`), a separate CI job; it shares `scratch/lib_cdp.mjs` (server, browser, DevTools Protocol) with `e2e_smoke.mjs`.
- `scratch/benchmark.mjs`: three deterministic scenarios and the digest of their output; `test_benchmark.mjs` fails when an output changes
  ([BENCHMARKS.md](BENCHMARKS.md)).
- A long search is a task: `main.js` `searchInWorker(kind, payload)` → `workerClient.runTask` → `searchWorker.js` → `searchTasks.runSearchTask`, or the same
  `runSearchTask` on the page. The page writes where the last search ran into `data-last-search` of the movers section. What is still on the page thread: the detection of the
  dots (also for the Planet X search), the support of each candidate, *Find everything*.
