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
