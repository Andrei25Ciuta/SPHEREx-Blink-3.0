# Merge notes: two lines of Blink 2.0 in one repository (10 Nov 2026)

This repository (`SPHEREx-Blink-2.0`) and the branch `blink-2.0` of `mateibut/SPHEREx` both started from `main` at `3f1e538` and were developed separately.
They were merged here on 10 Nov 2026 (merge of `33e37c8` into `1144edf`). Everything below can be checked with `git log` and the commands named.

## What came in from the branch `blink-2.0` of `SPHEREx`
The three-panel workspace with a timeline, zoom and pan, the readout under the pointer and the layer list; four colour themes; provenance on every result and export; the
explainer; the Solar System simulator and the sky explorer as sections of the page; the Planet X Lab; the live IRSA survey search (`GET /api/survey`); *Find everything*
with the catalogue cross-match; the results page made by a command (`scratch/make_results.mjs`); text analysis as tables; the keyboard and screen-reader audit
(`scratch/a11y_audit.mjs`, 18 checks); the reproducibility bundle and its replay; the uncertainty budget of a velocity and the real-data check of the error (VALIDATION 20);
cancel and a size estimate for the long searches; a caption printed into every saved picture and video; the backend skips byte-identical copies of a file. The documents of
that line are appended below the documents of this one, under a marked separator (`AGENTS.md`, `docs/ARCHITECTURE.md`, `CODEX_PROGRESS.md`, `FEATURE_STATUS.md`,
`IMPLEMENTATION_ROADMAP.md`, `PROJECT_AUDIT.md`, `SCIENTIFIC_LIMITATIONS.md`); `docs/VALIDATION.md` of that line replaces nothing here (the two had different sections).

## What was already here and is kept
The standalone pages `planet-x.html`, `sky.html`, `simulator.html`; the Candidate Explorer on the results page (`features/resultsExplorer.js`); IRSA SIA2 observation
search (`GET /api/observations`); FITS provenance carried into the workspace and exports; the public site never asks a visitor's own machine for a backend
(`CAN_USE_LOCAL_BACKEND`); the north-up TAN mapping of the pointer position on real data; the guided tour as a modal; the refined parallax fit with a profile range;
the rule that a flagged peak needs support on good pixels (`hasGoodWing`); photometry errors labelled as nominal; the data-source switch; brightness, contrast and
crosshair of the picture on screen; their Playwright scripts `scratch/browser_*.cjs`.

## Where the two did the same thing differently, and what was chosen
| Matter | Chosen | What changed for the other side |
|---|---|---|
| Workspace layout | the three-panel layout with a timeline | the "Observation" list is kept beside the timeline; the zoom `<select>` and the pixel readout of the other layout are gone (real zoom and pan, and the readout under the pointer, do that) |
| Colour themes | one system (`features/theme.js`, key `spherex-blink-theme`); the standalone pages use `js/theme.js` with the same names and key | the theme `light-research` is now `light`; a new default theme, **Nebula (violet)**, was added on 10 Nov 2026 |
| What the data are called | the cautious wording of this repository: "SPHEREx-format FITS data (served by the backend; verify archive provenance)" | the other line said "real SPHEREx data (served by the project's backend)"; its tests and the caption of saved pictures were changed to say the cautious thing |
| `ctx.provenance` | it is the record of how a search was run (input, settings, version, time); the tag of the FITS source is `ctx.dataSource` | this repository used `provenance` for the tag |
| Candidate Explorer | both: the sources table of the results page and the explorer of the archived validation | |
| Standalone pages and sections | both exist; the workspace links to the standalone pages | the Planet X Lab, the sky explorer and the simulator exist twice (a section of the workspace and a page); they are two implementations |

## What is not settled by this merge (say it before you rely on it)
- **Numbers measured on one line were not re-measured with the other line's code.** The calibration and validation of `docs/VALIDATION.md` (sections 10, 14-16, 20) were made
  without the `hasGoodWing` rule and with the earlier parallax fit; the Planet X Lab's ranges and the completeness map were checked again only by `test_planetlab.mjs` (it caught
  two real incompatibilities, fixed in `planetLab.js`: the range reference and the choice of the fine scan). Re-run `scratch/calibrate_real.mjs` and
  `scratch/validate_uncertainty_real.mjs` before quoting those numbers for the merged detector.
- `scratch/browser_*.cjs` need Playwright and were **not run**; `browser_workspace.cjs`, `browser_real_responsive.cjs` and `browser_layout_audit.cjs` use controls that
  were replaced (`#image-zoom`, `#pixel-readout`, the old settings block) and will need new selectors.
- The new palette was checked by `scratch/test_theme.mjs` (contrast per theme) and by `scratch/a11y_audit.mjs` in two themes; the violet tint of the photo is a CSS filter
  and was looked at on one screen size only.

## Checked after the merge (this tree)
`for f in scratch/test_*.mjs`: 42 files, 1256 checks pass; `pytest backend`: 190 pass; `scratch/e2e_smoke.mjs`: 17 of 17; `scratch/a11y_audit.mjs`: 18 of 18 (also with
`--theme light`). Not run: the Playwright scripts, the real-data backend, the public Pages deployment.
