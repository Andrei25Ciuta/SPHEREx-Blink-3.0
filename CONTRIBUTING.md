# Contributing to SPHEREx Blink

A blink comparator and mover finder for SPHEREx infrared images (NASA Space Apps 2026, "Planet X and SPHEREx"). Vanilla ES modules in `frontend/`
(no build step, no npm), an optional FastAPI + astropy backend in `backend/`, Node and pytest tests. [AGENTS.md](AGENTS.md) holds the same rules for
agents; this file is the short version for people. Where things are: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). What works and what does not:
[docs/FEATURE_STATUS.md](docs/FEATURE_STATUS.md). Limits: [docs/SCIENTIFIC_LIMITATIONS.md](docs/SCIENTIFIC_LIMITATIONS.md).

## The rules that protect the project

1. **Real or synthetic, always labelled.** Never show synthetic data, a simulation or a model output as an observation, and never fall back silently from
   real to synthetic: show what failed. Real SPHEREx files and pixels are never committed or published (`backend/data/` is git-ignored; the data licence is
   unchecked). A results page shows derived numbers only.
2. **No invented science.** No made-up FITS columns, endpoints, units, catalogue matches or validation numbers. A number in a document comes from a command
   that can be re-run ([docs/VALIDATION.md](docs/VALIDATION.md) names it). A fact written from memory is marked as such. A candidate is a lead, never a discovery.
3. **Do not download new FITS files** without the author's explicit yes. Catalogue and ephemeris queries (SIMBAD, Gaia, IRSA TAP, SkyBoT, JPL Horizons) are fine.
4. **Keep it working.** The URLs (`?ra=&dec=&fov=&det=&mode=`, `?data=api&api=`, `?embed=1`, `?theme=`) and the existing features stay. Run the tests before and after.
5. **Honest tests.** Never mark a test as passing without running it. Never weaken a check to make it pass: change a check only when the behaviour it encodes
   was meant to change, and say so in the commit.
6. **Libraries** only with a pinned version and a licence line in [CREDITS.md](CREDITS.md). Nothing is deployed or published without the author asking.

## Running things

```bash
py scripts/serve_frontend.py 8765                                   # the frontend, with no-cache headers
for f in scratch/test_*.mjs; do node "$f" | tail -1; done           # the Node tests (Node 20+; no install)
backend/.venv/Scripts/python.exe -m pytest backend -q               # the backend tests (pip install -r backend/requirements-dev.txt first)
node scratch/e2e_smoke.mjs                                          # the page in a real browser (Node 22+, Chrome or Edge); not part of the set above
node scratch/benchmark.mjs --check                                  # the outputs of three searches against their golden digests (docs/BENCHMARKS.md)
```

`py` is the Windows Python launcher; on other systems use `python3`. Real-data scripts in `scratch/` print a report and are not run in CI; they need the
author's local files and a real-only backend (see AGENTS.md and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

## How the code is organised

- **Analysis code is pure** (no DOM, no network, `fetch` injectable) and lives in `frontend/js/features/`, so Node can test it. The part that touches the
  page is a separate module (`*View.js`). Long searches are tasks in `searchTasks.js`, run in a worker with the same code as the fallback.
- **Colours only through the CSS tokens** in `frontend/css/styles.css` section 1; `scratch/test_theme.mjs` checks the contrast of every theme. Charts keep a
  dark ground in every theme.
- **UI text and documents in English.**
- A scientific output that must not change by accident has a golden digest (`scratch/benchmark_baseline.json`). Write a new one only when the change
  was meant (`node scratch/benchmark.mjs --write`), and say so.

## A new feature is

code, **plus** tests (Node or pytest), **plus** a line in `docs/FEATURE_STATUS.md`, **plus** its limits in `docs/SCIENTIFIC_LIMITATIONS.md`; a measured
claim goes in `docs/VALIDATION.md` together with the command that measures it. Say what you did **not** check (a screen reader, a real touch screen,
other browsers) instead of leaving it out.

## Branches and commits

Blink 2.0 is on the branch `blink-2.0`; `main` is the reference and holds the demo that is published. Do not rewrite the history of `main`; do not
force-push. A commit message says what changed and why, and for work done with an AI assistant ends with the co-author line the tool gives; the project
describes that use truthfully (the notice at the top of the README and the last section of [CREDITS.md](CREDITS.md)). The author pushes and opens pull requests.

## Reporting a problem

Open an issue with the URL (the query string carries the field), the data kind shown in the badge (synthetic or live), the browser and what you expected.
Please do not attach real SPHEREx pixels.
