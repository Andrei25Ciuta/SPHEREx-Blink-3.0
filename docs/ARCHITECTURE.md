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
`flags`, `pixelScaleArcsec`. Synthetic frames carry no `dataUrl`: the detectors then work on the 8-bit pictures and say so. The contract is
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

## State and flow in `main.js`

Module-level variables: `allFrames` (every frame of the query), `currentFrames` (one detector), `currentQuery`, `loadToken` (raised on every load, so
a late answer is ignored), `movers`, `catalogueCache`, `asteroidState`. `loadData` fetches frames, `showDetector` sets the player, and
`clearMovers()` / `discoverPanel.clear()` reset the analysis when the data changes. A search (`Find movers`, `Find everything`) reads the float
pixels with `detectionPixels`, runs the pure module, and draws into the DOM; everything stale is dropped by comparing `loadToken`.

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
