# Project audit (8 Nov 2026)

What the repository contains **today**, checked by reading the code and running the tests, not copied from older notes.
Branch `blink-2.0` (from `main` at `3f1e538`; `main` is left as the reference and was not changed). Nothing here has been pushed.

## 1. Baseline

| Check | Result (8 Nov 2026) |
|---|---|
| Node tests (`scratch/test_*.mjs`) | 16 files, all exit 0, 480 `PASS` lines before Phase 1; 17 files and **526** `PASS` after it (`test_theme.mjs`, 46); 0 `FAIL` (`test_coords` and `test_mock` print in another style and are not in that count) |
| Backend tests (`pytest backend`) | 143 passed (112 before this work) |
| CI (`.github/workflows/tests.yml`) | runs every `scratch/test_*.mjs` and pytest; **not run on the new branch yet** (nothing pushed); the action versions in it were written from memory |
| Browser check of the new panel (built-in browser, real data, backend on port 8003) | opens, runs, no console errors; 375 px wide: no horizontal overflow after a fix (see §4) |
| End-to-end browser tests (Playwright) | **none exist**: every browser check so far was done by hand or with small scripts (`scratch/audit_page.js`) |

## 2. Architecture in one paragraph

A static site of ES modules with no build step (`frontend/`, about 6 400 lines of JavaScript) that works alone on **synthetic** data made in the
browser (`js/data/mockSource.js`) and, with `?data=api`, on **real** SPHEREx cutouts served by a FastAPI backend (`backend/`, about 1 100 lines
of Python, astropy) that reads FITS files from `backend/data/` (git-ignored: the data licence has not been reviewed). The single interface
between the two is `js/data/getCutouts.js`. Details: [ARCHITECTURE.md](ARCHITECTURE.md).

## 3. Feature inventory

[FEATURE_STATUS.md](FEATURE_STATUS.md): one line per feature with status, evidence and known issues.

## 4. Risks and findings

**Fixed during this audit/work**

1. `apertureSnr` (`movers.js`) rejected about 2 % of pixel grids because its "no holes" test used 0.8·π·r² = 10.05 centres while some positions
   have only 10 (regression check in `test_movers.mjs`).
2. A moving candidate that was four dots of a fixed bright star (12″/yr, 6σ) was listed next to the fixed source (rule `isShadowOf`, flag
   `motion-disagrees`; VALIDATION §14).
3. The new panel made the page 14 px wider than a 375 px screen (a `<select>` sized by its longest option); fixed in `styles.css`.

**Open**

| # | Finding | Severity | Notes |
|---|---|---|---|
| A1 | Heavy searches (`findMovers`, `discover`) run on the **main thread**; no Web Workers | medium | fine on 5′ fields (about a second); not measured on 30′ fields with many images |
| A2 | A cutout of `det=all` is not the same pixels as one of a single detector (about 2 100 of 2 401 pixels differ: different resampling grid); marginal movers can appear in one and not the other | medium | measured in VALIDATION §14; all calibration used single-detector cutouts |
| A3 | `backend/app.py` has `allow_origins=["*"]`, no rate limit and no size limit on `/api/catalogue` (radius at most 25′, 20 000 rows, but each call can trigger a minutes-long upstream query) | medium for a public deployment; low on a laptop | the allowlists (`hips_proxy`, `catalogues`) stop it being an open proxy |
| A4 | The HTTP layer is tested only for `/api/catalogue` (called as a function); `httpx`, needed by FastAPI's `TestClient`, is not installed | low | |
| A5 | `docs/TODO.md` is in Romanian and dated 6 Nov: several statuses are older than the code | low | it is the submission checklist, not user documentation |
| A6 | No Playwright/E2E tests, no CONTRIBUTING.md, no CHANGELOG.md | low | |
| A7 | Eligibility: the project began on 5 Nov, before the hackathon; the official rule was not found and the question to the organisers is still open (`docs/TODO.md` §1) | **decision for the author** | not something code can settle |
| A8 | Data licence/acknowledgement wording for SPHEREx, Gaia, 2MASS and AllWISE not yet copied from the archives (`CREDITS.md`) | needed before submission | |
| A9 | IRSA's and Gaia's TAP services are slow or unreachable at times; a plain GET to the ESA service hangs from this network (the relay uses POST) | operational | the page reports what failed instead of falling back silently |

## 5. What was **not** examined

Accessibility with a screen reader or on a real phone (script checks only, [ACCESSIBILITY.md](ACCESSIBILITY.md)); other browsers than Chromium
(the built-in browser); the public GitHub Pages build; dependency vulnerabilities (`pip audit` / `npm audit` not run; there is no npm
dependency, the frontend loads Aladin Lite, `world-atlas` and Google Fonts from CDNs at run time).
