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
| `movers.js` | dots (`detectSources`), registration on field stars, straight-line movers with a chance-line estimate, aperture S/N, spectrum colour inputs |
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

Errors are `{"detail": "..."}` (FastAPI's own shape; `ValueError` becomes HTTP 400, an unreachable upstream HTTP 502, a refused catalogue HTTP 403). Answers are
cached on disk under `backend/cache/` (keys include the input files and an algorithm version). CORS allows every origin for GET.

## Tests

`scratch/test_*.mjs` (Node, no install; `PASS`/`FAIL` lines, non-zero exit on failure) and `backend/tests` (pytest, synthetic FITS made on the fly).
`.github/workflows/tests.yml` runs both. Scripts that need the real files (`validate_*.mjs`, `calibrate_real.mjs`, ...) are not run in CI.
