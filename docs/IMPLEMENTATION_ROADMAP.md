# Implementation roadmap: SPHEREx Blink 2.0

Ten phases, in order. Each is "done" only when it is implemented, works in the application, its tests pass, nothing existing broke, errors are
handled, the documents are updated and the scientific limits are stated. Status on 8 Nov 2026; current state in [CODEX_PROGRESS.md](CODEX_PROGRESS.md),
feature by feature in [FEATURE_STATUS.md](FEATURE_STATUS.md). The hackathon opens on 14 Nov 09:00 and the project closes on 15 Nov 23:59
(`docs/TODO.md`): anything started here must leave `main`'s demo working, so the work lives on the branch `blink-2.0`.

| Phase | Goal | Status | Acceptance (checked how) |
|---|---|---|---|
| 0 | Audit and baseline | **done** | [PROJECT_AUDIT.md](PROJECT_AUDIT.md), [ARCHITECTURE.md](ARCHITECTURE.md), [FEATURE_STATUS.md](FEATURE_STATUS.md), [SCIENTIFIC_LIMITATIONS.md](SCIENTIFIC_LIMITATIONS.md); all tests run first (480 Node checks, 143 pytest) |
| 1 | Design foundation: tokens, themes, typography, reusable components | **mostly done** (tokens, four themes, switch, persistence, typography: done and tested; dialogs, tooltips, icon system: not) | three themes switch and persist; every colour in `styles.css` comes from a token; contrast of text on every surface at least 4.5:1 in each theme (script check); no horizontal overflow at 375 px; existing URLs unchanged; `test_theme.mjs` passes |
| 2 | Workspace: three panels, viewer zoom/pan/inspection, layers, timeline, inspector | **mostly done** (viewer zoom, pan, pixel and sky readout, coordinate grid, centre on a candidate, scale bar, layer list with switch, colour key and count per layer, timeline with detector and wavelength labels and filtering, keyboard and touch: done and tested; three panels, collapsible side panels, inspector panel: not) | zoom and pan keep the image-to-sky mapping (`canvasToSky`) exact (`test_view.mjs`: 3000 random views, under 1e-10 degrees); layers toggle independently; keyboard operation; browser check on desktop (1100 px) and phone (375 px) |
| 3 | Results dashboard and Candidate Explorer | not started | every number comes from a data file or a live run, none typed in; candidate table sorts, filters, pages; each result carries its provenance (input, settings, algorithm version, time) |
| 4 | Scientific pipeline: sub-pixel centroids, uncertainty propagation, ranking | partly done (*Find everything* ranking and cross-match) | centroid accuracy and flux tests on injected sources; uncertainties checked against the scatter of repeated injections |
| 5 | Planet X Lab: model comparison, distance only when constrained, injection-recovery in the interface | not started | stationary / linear / parallax models compared by a documented statistic; completeness heat map from real injections, labelled synthetic |
| 6 | Spectral and multi-detector analysis | not started | uncertainty bands; side-by-side detectors; missing data shown as missing |
| 7 | Sky explorer with real observation footprints | not started | footprints from the metadata of files that exist, never invented; needs the backend to serve them |
| 8 | Solar System simulator (educational and scientific modes) | not started | scientific mode checked against the Earth-position tests of `test_parallax.mjs`; educational scale exaggeration labelled |
| 9 | Optional AI assistant | not started | works with no key; every sentence cites a measured value; output validated against the input data |
| 10 | Hardening: workers, benchmarks, Playwright, CI, deployment notes | not started | before/after timings with identical scientific output; E2E tests run in CI |

## Decisions that belong to the author (not made by code)

1. **Where Blink 2.0 lives.** The task text names a separate repository (`mateibut/SPHEREx-Blink-2.0`) and says to leave the original untouched.
   The working copy here has `origin` = `mateibut/SPHEREx`, so the work is on a local branch `blink-2.0`; `main` still points to `3f1e538`. Pushing the
   branch anywhere is the author's step.
2. **Default look.** The brief asks for a "Deep Space" blue/violet default and a light theme. The page used to be dark only, with a teal and orange identity.
   Phase 1 keeps that look as one theme ("Classic") and adds the new ones; **Deep Space is the default**, as the brief asks. Changing it is one constant in
   `js/features/theme.js` plus the `data-theme` attribute of the two pages (`test_theme.mjs` checks that they agree).
3. **Eligibility** of work started before the hackathon (`docs/TODO.md` §1) is unresolved and independent of any phase.
4. **External libraries** for later phases (Three.js, a chart library, Playwright): the project has no build step and no npm dependency today.
   Each addition needs a pinned version and a licence line in `CREDITS.md`.
