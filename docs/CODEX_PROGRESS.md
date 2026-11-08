# Development progress

## 2026-11-08 — Phase 1 navigation milestone

Imported upstream history through 3f1e538 into the SPHEREx-Blink-2.0 development checkout after checking that the named development remote advertised no refs. The reference repository supplied the baseline. This entry starts the Blink 2.0 progress record.

Changed frontend/index.html, frontend/results.html and their two CSS files. The workspace header now wraps its existing links on narrow screens. A first-tab skip link moves focus to the workspace. Both destinations use focusable main landmarks. The embed header stays hidden. Added scratch/browser_navigation.cjs and the audit, architecture, feature inventory, roadmap, limitations and repository instructions.

### Verification

- Ran each of the 13 scratch/test_*.mjs scripts with Node 24.15 before and after the UI edits. All exited zero. Some scripts print diagnostics rather than asserting each value.
- Installed backend/requirements-dev.txt in a temporary dependency directory and ran python -m pytest backend -q under Python 3.12. All 112 tests passed.
- Served frontend/ over loopback HTTP and ran node scratch/browser_navigation.cjs with Playwright and headless Edge. Widths of 320, 720, 721 and 1280 CSS pixels passed. The check tabs to the skip link, activates it, verifies the workspace owns focus, checks all header links are actionable and within the viewport, loads results JSON, and returns through the results header. It also checks embed visibility. External network requests are blocked during this test.
- To repeat the browser check, serve the frontend with python scripts/serve_frontend.py, make Playwright available to Node and install its Chromium browser or select an installed channel with BLINK_BROWSER (e.g. msedge). BLINK_URL overrides the default loopback URL on port 8765.

No scientific algorithms or saved measurements changed. Live catalogue queries and historical real-frame experiments were not rerun. Phase 1 continues with persistent shared themes and contrast verification. See IMPLEMENTATION_ROADMAP.md for subsequent phases.

## 2026-11-08 — integrated development increment

Implemented persisted Deep Space, Observatory and Light Research palettes across the pages. The workspace gained a three-column wide layout, observation selection, pixel coordinate readout, zoom, scroll pan, brightness and contrast controls, and paired detector cutouts with their own dates. The measurement table gained detector filtering and JSON export. Results gained candidate import, search, selection, centroid evidence and local reports. New Sky Explorer and simulator pages use actual IRSA metadata or a saved example, and calculated observer geometry. Planet X Lab reads the recorded injection experiment.

Scientific changes include a profile distance fit that refits position and motion at each trial distance, a case-sensitive FITS surface-brightness unit conversion, and an injection-recovery experiment on nine observed backgrounds. The saved experiment includes input hashes, seed, detected outcomes and four null controls. The cache writes image and float files atomically.

Verification during integration: Python 3.12 with temporary backend dependencies, `python -m pytest backend -q`, 113 passed. All `scratch/test_*.mjs` scripts exited zero. The independent parallax profile script passed. Headless Edge loaded the workspace, results, Sky Explorer, simulator and Planet X Lab without page exceptions. The saved Sky Explorer field listed 100 products. The simulator drew its scene. The Planet X Lab read its recovery record. A synthetic Planet X demo loaded four observations, zoom worked, Find Distant found one candidate, and the selected Light Research theme persisted on results. Existing navigation smoke passed at 320, 720, 721 and 1280 px.

Remaining work includes an independent real-data replication of the saved recovery counts, broader fields and trials, full keyboard and contrast audit, live archive and cross-service failure testing, and deployment review. The browser checks cover representative paths. No release or scientific discovery claim is justified by this increment.

## 2026-11-08 — SPHEREx Blink 3.0 destination and archive validation

The requested deployment repository is now `origin` at SPHEREx-Blink-3.0. Its main branch contained a single reset commit and one-line README when fetched. `blink2` and `upstream` remain reference remotes. README and AGENTS.md now point to this destination and the current entry points. Added backend tests for a valid SIA2 product and footprint, an unexpected table schema, and an unapproved collection. The backend suite passed with 116 tests.

This session continues the remaining phases incrementally. The archive test uses a controlled response. Live IRSA availability, broader real-field injection recovery, full interface accessibility, and production deployment still need verification.

## 2026-11-08 — candidate evidence round trip

Found and fixed an export bug in `frontend/js/features/export.js`: `candidatesToJson` built enriched records with fit centroids and detector/time frame keys but serialized a fresh unenriched record list. JSON exports now retain the enriched records. Added `scratch/test_candidate_roundtrip.mjs` and `scratch/browser_candidate_roundtrip.cjs`. The Node test passed an exported candidate through `importDataset` and confirmed all three supporting positions and the viewer URL. Headless Edge imported a candidate file into Results, displayed its three centroid rows, generated an evidence report, and linked to the workspace without page errors. Existing export checks also passed. This verifies the data path with a representative controlled candidate; scientific validation of real associations remains open.

### Follow-up verification after push

Pushed commit `ffc7d8b` to SPHEREx-Blink-3.0 `main` by a fast-forward update that preserved its reset commit. GitHub Actions run 42468696891 passed its Node and backend jobs. The Pages workflow stopped at `actions/configure-pages@v5` because GitHub Pages has not been enabled for this repository. Enabling public Pages remains an explicit deployment step.

Started the local backend against the ignored FITS archive. `/api/health` indexed 17 files and reported no unreadable files. `/api/photometry` returned nine D2 measurements at the Barnard field. Headless Edge loaded the same field with `data=api`, displayed nine frames, and measured nine points after a canvas click, with no page exceptions. The local archive is an input dependency and is not part of Git. This verifies one real-data entry path, not the entire scientific pipeline.

## 2026-11-08 — FITS provenance labels

The backend can serve synthetic test FITS as well as archive files. Added a header-derived provenance field to indexed frames, cutout responses and photometry points. The workspace badge and candidate and measurement exports now reflect the field. A new cache-key component regenerates old cutout responses. The parser accepts explicit synthetic test comments, recognises the observed SPHEREx product header pattern, and otherwise labels files unverified. Mixed fields receive a mixed label. Header classification does not authenticate where a file was downloaded.

Verification: backend pytest passed 117 tests, including synthetic, SPHEREx header pattern and unverified cases. The candidate and export module checks passed. The local backend returned nine Barnard-field D2 frames with SPHEREx header markers. Headless Edge loaded them and displayed "SPHEREx-format FITS" in the badge. Independent archive-source verification and broader field checks remain open.

## 2026-11-08 — responsive layout and core contrast

Added `scratch/browser_layout_audit.cjs` and ran it in headless Edge on the workspace, Results, Sky Explorer, Simulator and Planet X Lab at 320, 375, 768 and 1280 CSS pixels with Deep Space, Observatory and Light Research themes. The first pass found horizontal document overflow at 320 px in the detector reference table and Results, and at 320–375 px in the Planet X recovery table. Wrapped the two tables in scroll containers and let long code text wrap on Results. The same check then passed 60 page/theme/width combinations with zero document-level overflow, first-tab skip-link focus, and at least 4.5:1 core body, panel and muted text contrast against solid token surfaces. Imagery, canvas plots, dynamic dialogs and screen reader behavior remain outside this check.

## 2026-11-08 — guided tour modal behavior

The workspace tour already trapped Tab and restored focus, but its `aria-modal="true"` dialog left the background interactive. `startTour` now makes other body children inert while the dialog is open and restores each child's prior inert state before returning focus to the launcher. Added `scratch/browser_tour_modal.cjs`; its initial run reproduced the missing inert state. The completed browser check passed at 320 and 1280 px with offline assets: it exercises the dialog, background pointer blocking, forward and reverse focus, step advancement, Escape, previous inert state and focus return.

Verification: all 15 `scratch/test_*.mjs` scripts exited zero; `python -m pytest backend -q` passed 117 tests (one existing Astropy HIERARCH warning); `scratch/browser_navigation.cjs` passed four widths; `scratch/browser_layout_audit.cjs` passed the five pages across three themes and four widths; and the tour check passed both widths. No FITS fixture, scientific method, saved measurement or backend API changed. A human screen reader audit and imagery/canvas contrast check remain open.

## 2026-11-08 — Pages deployment check

The latest pushed commit passed the backend and Node GitHub Actions jobs but failed the separate Pages job at `actions/configure-pages@v5`. The repository API reports `has_pages: false`; the failure is not a test failure. The workflow now checks the repository setting and skips deployment with an explanatory job summary until Pages is enabled. When the setting is enabled, the existing `configure-pages`, artifact upload and deploy steps still run on pushes to `main` or manual dispatch. This change does not enable public hosting; historical failed runs remain in GitHub Actions history. A successful Pages deployment remains unverified.

## 2026-11-08 — return to SPHEREx-Blink-2.0 repository

The user changed the requested destination from SPHEREx-Blink-3.0 to SPHEREx-Blink-2.0. A fetch and `git ls-remote --heads` found no advertised branches in the Blink 2.0 repository, so the complete local history can be published as its first `main` branch without replacing remote work. Repository instructions and the README title and planned Pages URL now refer to Blink 2.0. The prior Blink 3.0 progress entries remain as historical facts. This repository handoff changes no scientific algorithms or FITS fixtures. The Pages source and live demo status must be checked independently in the new repository after pushing.

Pushed `0d7989b` to Blink 2.0 as its first `main` branch. GitHub Actions runs 42471267710 (Node and backend) and 42471267709 (Pages configuration, deployment skipped) both passed. GitHub reports `has_pages: false` for this new repository.

## 2026-11-08 — observed D2 workflow at narrow widths

Added `scratch/browser_real_responsive.cjs` to exercise the actual local FITS backend on a Barnard-field query (RA 269.4462°, Dec +4.769°, 3′). The ignored local archive contained 17 D2 FITS files; the query returned nine frames. In headless Edge at 320, 375 and 1280 CSS pixels, the browser loaded the nine observed frames, showed the SPHEREx-format provenance badge, stepped to frame two, rendered difference mode and two comparison cutouts, and returned nine photometry rows after a canvas click. No page exceptions or document-level horizontal overflow occurred. External requests were blocked. The FITS files and backend cache were not committed. This verifies one detector and field; other detectors and independent fields remain untested in this browser path.

## 2026-11-08 — public synthetic demo deployment

Enabled GitHub Pages on the Blink 2.0 repository with `build_type: workflow` using the existing repository account. Dispatched `.github/workflows/pages.yml` on `main`; run 42471642977 completed successfully, including the deploy job. The authenticated Pages API reports a public, HTTPS-enforced workflow site at `https://mateibut.github.io/SPHEREx-Blink-2.0/`. The published artifact is the `frontend/` folder; the default workspace remains labelled synthetic and no FITS archive is published. A direct browser check of the public origin was denied by the browser access gate, so page rendering and interaction at that URL were not independently observed in this session. Local browser and backend checks from the preceding milestones remain the available functional evidence.

## 2026-11-08 — public static backend boundary

The public static workspace offered a selectable local FITS backend even though its API URL is loopback on the visitor's machine. Added a host boundary in `frontend/js/config.js` and `frontend/js/data/apiSource.js`: on a nonlocal page, the local option is disabled, explanatory text appears, and an old `?data=api` deep link fails with a direct instruction before any loopback request. The source remains explicitly labelled; there is no silent substitution of synthetic frames for a requested FITS field. The local backend path remains available when the frontend is served on localhost.

Verification: the new `scratch/browser_public_backend.cjs` failed first on the actionable local option, then passed in headless Edge with an intercepted `https://blink.example` origin. At 320 px it checked the public guidance fits, no loopback requests occur, the deep-link error is readable, and switching to the synthetic demo loads images. `scratch/browser_real_responsive.cjs` still passed the observed D2 workflow at 320, 375 and 1280 px against the ignored local FITS archive. All 15 `scratch/test_*.mjs` scripts exited zero; backend pytest passed 117 tests with the existing Astropy HIERARCH warning. The actual public origin could not be opened through the denied browser access gate; these checks use a local origin simulation and local FITS files.

## 2026-11-08 — public research links

The Sky Explorer saved-field view and Planet X Lab linked directly to `?data=api` workspace views even on the static public site, where FITS frames cannot load. On a public host those links are now hidden and each page explains that an observed-field workspace requires the local backend. When served locally the original links remain actionable. `scratch/browser_public_backend.cjs` now routes all assets under the GitHub Pages-style `/SPHEREx-Blink-2.0/` project path and checks both public and local link states, saved data loading, and no document overflow at 320 px. It failed on the public Sky Explorer link before the change and passed after it. The actual public origin remains untested due to the browser access denial.

Verification after the change: all 15 `scratch/test_*.mjs` scripts exited zero; `python -m pytest backend -q` passed 117 tests with the existing Astropy HIERARCH warning; `scratch/browser_navigation.cjs` passed four widths; `scratch/browser_layout_audit.cjs` passed five pages, three themes and four widths; and `scratch/browser_public_backend.cjs` passed.

## 2026-11-08 — Results workspace link on the public site

The archived real-data records in Results still offered an active `data=api` workspace link on the public static site. `resultsExplorer.js` now hides that link and explains the local backend requirement on public hosts. A locally served Results page keeps the real-data link, and imported synthetic candidate exports keep their usable workspace link on either host. The first browser regression run reproduced the active public real-data link; the updated `scratch/browser_public_backend.cjs` passed real, local and synthetic link checks under a simulated GitHub Pages project path at 320 px, without document overflow. The actual public origin remains unavailable to the browser access gate.

Verification: all 15 `scratch/test_*.mjs` scripts passed, and `python -m pytest backend -q` passed 117 tests (one existing Astropy HIERARCH warning). `scratch/browser_candidate_roundtrip.cjs`, `scratch/browser_public_backend.cjs` and `scratch/browser_layout_audit.cjs` passed; the layout check covered five pages, three themes and four widths. One navigation run failed an immediate post-click visibility assertion, then the same script passed alone and in three additional repetitions. No app failure was reproduced; the intermittent browser-test result remains a verification limit.

## 2026-11-08 — independent Epsilon Indi B D6 workspace validation

Queried the live IRSA SPHEREx TAP archive for Epsilon Indi B in detector D6. It returned 92 products in four passes. Downloaded three dated level-2 cutouts from QR2 and QR3 into ignored `backend/data/real/`; recorded exact product URLs, SHA-256 hashes, command and limits in `docs/REAL_D6_REPLICATION.md`. `read_frame_file` accepted all three, and the local backend indexed 20 FITS files in total with none unreadable. Its D6 photometry endpoint returned three finite Jy values with `spherex_header` provenance. A nearby bright peak lay within one approximately 6.16-arcsecond pixel of the catalogue track at each date. This checks location and data loading, not calibrated astrometric or photometric accuracy.

Extended `scratch/browser_real_responsive.cjs` with a D6 field option and a measurement JSON export check. Headless Edge passed the D6 three-frame workflow and the previous Barnard D2 nine-frame workflow at 320, 375 and 1280 CSS pixels. Each run loaded both paired cutouts, switched to difference mode, displayed measurement rows and had no page exceptions or document-level overflow. The 1280 px checks also downloaded JSON with the expected detector, provenance and finite `fluxJy` values. The script now clicks the visual canvas center across widths, waits for decoded comparison images, and accounts for measurement details already opened by the offline plot fallback.

Verification: all 15 `scratch/test_*.mjs` scripts exited zero; `python -m pytest backend -q` passed 117 tests with one existing Astropy HIERARCH warning; both browser field variants passed at all three widths. No production algorithm changed. Further fields, detectors, independent flux/uncertainty calibration, blind mover recovery and actual public-origin browser access remain open.

## 2026-11-08 — D6 raw-pixel flux cross-check

Added `scratch/validate_d6_raw_photometry.py` to verify the SHA-256 of the three ignored Epsilon Indi B D6 cutouts and independently sum their native FITS `IMAGE` pixels. It places a 2-pixel aperture with FITS WCS, subtracts a 4–7-pixel background-ring median, and converts MJy/sr with WCS pixel area. Unlike the backend measurement, this path does not use the application's resampling, aperture or unit conversion functions. It fails above a 10% flux difference. The observed native-versus-backend differences were 0.6%, 1.6% and 5.1%; details are in `docs/REAL_D6_REPLICATION.md`.

The third aperture is flagged. The native sky-noise proxies were larger than backend `fluxJyErr` values on all three dates, but the grids and pixel correlations differ; neither estimate proves calibrated uncertainty. No production algorithm or threshold was changed. `docs/VALIDATION.md` already documents earlier Epsilon Indi B science validation, so these three products provide a new measurement-path cross-check rather than a blind field test. More detectors, robust flag treatment, independently calibrated errors and broader sources remain open.

Verification: `python scratch/validate_d6_raw_photometry.py` passed on all three hash-pinned files; all 15 `scratch/test_*.mjs` scripts exited zero; `python -m pytest backend -q` passed 117 tests with the existing Astropy HIERARCH warning. Browser navigation was unchanged and was not rerun for this measurement-script and documentation increment.

## 2026-11-08 — resampled photometry error disclosure

Investigated the smaller backend `fluxJyErr` values seen in the D6 native-pixel cross-check. `scratch/diagnose_resampled_noise.py` uses seeded independent Gaussian input pixels and the actual bilinear sampler and aperture helper. Across 1,500 realizations per phase, empirical flux scatter divided by the mean formula error was 1.05 without a subpixel shift, 1.62 at (0.25, 0.40) px and 1.86 at (0.50, 0.50) px. Interpolation creates neighbouring-pixel covariance that the existing sky-ring formula ignores. These synthetic ratios cannot be applied as universal SPHEREx correction factors.

Kept existing fluxes and numeric errors for compatibility with saved reports. Added `errorModel: "resampled_sky_scatter"` to backend photometry points, which flows into JSON exports. The measurement note now explains the missing covariance, source-noise and calibration terms; its table labels the error as sky scatter and the ratio as nominal S/N. The science validation document now explicitly treats prior photometry S/N figures as nominal. A backend regression test first failed on missing `errorModel` and then passed. Real D6 and Barnard D2 browser workflows passed at 320, 375 and 1280 px with the visible explanation, table labels and export metadata. A calibrated replacement error model, and rerunning historical significance analyses under it, remain open.

Verification: all 15 `scratch/test_*.mjs` scripts exited zero; `python -m pytest backend -q` passed 118 tests with the existing Astropy HIERARCH warning; `scratch/diagnose_resampled_noise.py` produced the ratios above; both observed browser field variants passed at all three widths. The public static demo does not include these real FITS points, so its display of this note was not separately exercised.

## 2026-11-08 — Sky Explorer archive boundary and recovery

Inspected the IRSA variance layer while planning error calibration: the three Epsilon Indi B D6 cutouts have a `VARIANCE` HDU with `MJy2 / sr2` units. IRSA's [SPHEREx explanatory supplement](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/SPHEREx_Expsupp_QR_v1.2.1.pdf) describes it as a calibrated per-pixel variance layer. It does not, by itself, account for the background estimate or covariance introduced by this app's resampling, so no numeric photometry error was changed in this increment.

Advanced the Sky Explorer service path instead. The public static page no longer presents a usable live IRSA search button when its local backend is unavailable; it points visitors to the saved QR2 field. Locally, an invalid coordinate leaves the last valid product view in place. Backend HTTP errors now show their readable `detail` text, and malformed successful JSON is rejected before it changes the displayed query. Added `scratch/browser_sky_archive.cjs` to cover the public project path at 320 px, local invalid input, controlled 502 and malformed responses, saved-field recovery and a later valid live response. Its first run reproduced the active public search button; the completed check passed. A direct live `observations(127.69444, -39.17760, 2, "spherex_qr2")` call returned the capped 100 product records with `truncated=True` and first D2 observation `2025W20_2D_0192_2`.

The browser test uses controlled responses, not an end-to-end live browser request. Other IRSA collections, empty fields, offline map tiles and actual public-origin rendering remain open.

Verification: all 15 `scratch/test_*.mjs` scripts exited zero; `python -m pytest backend -q` passed 118 tests with the existing Astropy HIERARCH warning; `scratch/browser_sky_archive.cjs` and `scratch/browser_public_backend.cjs` passed. The first layout audit reported 9 px of overflow on an `#layers` fieldset; inspection showed port 8765 was serving an older workspace copy that does not match this checkout. The current frontend passed the five-page, three-theme, four-width layout audit on an isolated port. `scratch/browser_layout_audit.cjs` now self-hosts this checkout on an ephemeral loopback port by default, so future runs cannot silently audit that stale server; the self-hosted audit passed all combinations. No current-page CSS change was needed.

## 2026-11-08 — Sky Explorer geometry and empty archive result

Compared `tangentPoint` with independent Astropy TAN WCS values at the RA 0° wrap, high northern and southern declinations, and the nonprojectable opposite hemisphere. Also checked that `fieldCorners` projects back to its requested tangent-plane square, including a 30′ field enclosing the north pole. The existing math agreed to better than 1e-9 degrees in the tested coordinates, so it was preserved. Added `scratch/test_explorer_geometry.mjs` with the reference values and inverse checks.

Found a real Sky Explorer empty-result problem while extending `scratch/browser_sky_archive.cjs`: a valid zero-product response left “Analyze field in workspace” active, although no observation could be selected. The browser test failed on that link, then passed after `skyExplorer.js` began hiding and removing it for empty results and showing a clear no-products message. Saved, failed and valid live-response behavior still passes. A zero-product response was simulated; an actual empty IRSA field was not queried. Independent simulator geometry and model-output review remain open.

Verification: all 16 `scratch/test_*.mjs` scripts exited zero; `python -m pytest backend -q` passed 118 tests with the existing Astropy HIERARCH warning; `scratch/browser_sky_archive.cjs`, `scratch/browser_public_backend.cjs` and the self-hosted `scratch/browser_layout_audit.cjs` passed. The layout audit covered five pages, three themes and four widths.

## 2026-11-08 — simulator reference geometry and display precision

Compared `orbitScene` against an independent calculation with Astropy 8.0.2's built-in Earth-minus-Sun ephemeris at UTC MJD, a stationary target placed at the reference observer position plus distance along the ICRS direction, and Astropy TAN WCS for apparent offset. Cases covered RA 70°, Dec +15°, 500 AU over 180 days; RA 359.8°, Dec −45°, 52 AU over 183 days; and RA 120°, Dec +89°, 1000 AU over 91 days. The maximum offset difference was about 0.23 arcsecond and the maximum range difference was under 0.0001 AU in these cases. Existing `earthPositionAU` checks also compare three dates against Astropy. Added `scratch/test_simulator_geometry.mjs` with these reference values and no change to the geometry model.

The simulator previously printed Earth coordinates to 0.00001 AU and offsets to 0.01 arcsecond, finer than the approximate ephemeris supports in the tested cases. It now displays Earth coordinates and range to 0.001 AU, offsets to whole arcseconds below 1000 AU or tenths beyond, and says the readouts are rounded model values rather than predicted source positions. `scratch/browser_simulator_precision.cjs` first failed on the old precision, then passed default, scientific-view, invalid-input recovery, large-distance and RA-wrap checks at 375 px. This changes presentation only. The three cases do not establish a global ephemeris error bound, and spacecraft motion and target orbital motion remain omitted.

Verification: all 17 `scratch/test_*.mjs` scripts exited zero; `python -m pytest backend -q` passed 118 tests with the existing Astropy HIERARCH warning; `scratch/browser_simulator_precision.cjs` passed; and the self-hosted layout audit passed five pages across three themes and four widths.

## 2026-11-08 — catalogue service response integrity

The workspace's SIMBAD fetch accepted an HTTP 200 CSV response with the wrong columns as an empty object list. SkyBoT similarly accepted an unexpected HTTP 200 JSON object or a nonempty array with no usable positions as an empty list. These paths could misstate a failed catalogue check as a clear field. The fetchers now reject those response shapes with readable errors, while retaining valid zero-row SIMBAD tables, SkyBoT 204 and empty JSON arrays, and the tolerant pure parsers used elsewhere. The SIMBAD parser also accepts a UTF-8 BOM on the header. `scratch/test_catalogue.mjs` and `scratch/test_skybot.mjs` first failed on the malformed-response cases, then passed after the fix.

When some SkyBoT image-date requests fail, the workspace and candidate explanation now say that no match was found on the *checked* dates and give the number of unchecked dates. The observed-data browser check injects one valid empty SkyBoT response and failures for the remaining dates at 1280 px; the visible partial-coverage message passed on both the Barnard D2 and Epsilon Indi B D6 fields. The FITS files remain ignored local archive inputs; no catalogue response or FITS data was added to Git. No mover threshold, measurement, or catalogue matching radius changed.

Live read-only probes from this machine on 2026-11-08 returned three SIMBAD objects including Barnard's Star for RA 269.4462°, Dec +4.769°, 3′, and one SkyBoT body (2015 RW209) for the same centre at MJD 60908 and 0.2° radius. A separate SkyBoT query at RA 0°, Dec +89°, 0.01° radius returned HTTP 204 and zero bodies. These probes establish reachability and the current response shape for those queries only. Live outages, changed schemas, other fields, map tile fallbacks, and the actual public-origin browser remain untested.

Verification: all 17 `scratch/test_*.mjs` scripts passed; `python -m pytest backend -q` passed 118 tests with one existing HIERARCH warning; `scratch/browser_real_responsive.cjs` passed observed D2 and D6 workflows at 320, 375 and 1280 px, including the controlled partial SkyBoT check at 1280 px. The backend was served with `SPHEREX_DATA_DIR=backend/data/real` on 127.0.0.1:18773; the browser used headless Edge and blocked other external requests apart from the injected SkyBoT response. Browser navigation did not change.
