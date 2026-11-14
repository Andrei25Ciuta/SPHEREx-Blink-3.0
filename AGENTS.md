# Developing SPHEREx Blink

Work in this checkout. This is SPHEREx-Blink-4.0 on `codex/blink4-education`, derived from Blink 3.0 and synced to its published `main` interface at `06ac378`. Learn Mode is an addition to the Science Mode baseline. Read docs/CODEX_PROGRESS.md, docs/IMPLEMENTATION_ROADMAP.md and docs/FEATURE_STATUS.md, then verify HEAD and the working tree. Historical instructions imported below describe earlier repositories; the current user's destination and scope take precedence. Do not publish unless the user asks.

Serve frontend/ over HTTP. Preserve index.html, results.html, query parameters and embedded mode. Keep Science Mode tools and analysis intact. The default workspace is synthetic and must remain explicitly labelled. Learn Mode progress is local to the browser; do not imply cloud sync or a connected AI model. Read docs/VALIDATION.md before changing scientific methods, units, or thresholds.

Run every scratch/test_*.mjs with Node and run python -m pytest backend -q with backend/requirements-dev.txt installed. Run the browser regression for navigation changes. Record commands, fixture provenance and untested paths in the progress log.

---

<!-- Everything below comes from the branch blink-2.0 of mateibut/SPHEREx, a second line of Blink 2.0 work that was merged into this repository on 10 Nov 2026. Where the two halves describe the same thing differently, they describe two different implementations: see docs/MERGE_NOTES.md. -->

# AGENTS.md: durable instructions for anyone (human or agent) working on SPHEREx Blink

Read this, then `docs/CODEX_PROGRESS.md` (where the work stands), then `git status` and `git log`. Do not trust a note that the repository
contradicts; check.

## What this is

A NASA Space Apps 2026 project ("Planet X and SPHEREx"): a blink comparator and mover/source finder for SPHEREx infrared images. Vanilla ES
modules in `frontend/` (no build step, no npm), a FastAPI + astropy backend in `backend/` (optional), Node and pytest tests. Map of the code:
`docs/ARCHITECTURE.md`. What works and what does not: `docs/FEATURE_STATUS.md`. Limits: `docs/SCIENTIFIC_LIMITATIONS.md`. Plan: `docs/IMPLEMENTATION_ROADMAP.md`.

## Rules that must not be broken

1. **Real or synthetic, always labelled.** Never present synthetic data, a simulation or a model output as an observation. Never fall back
   silently from real data to synthetic: show what failed. Real SPHEREx files and pixels are **never committed or published**
   (`backend/data/` is git-ignored; the data licence is unchecked). The results page shows derived numbers only.
2. **No invented science.** No made-up FITS columns, endpoints, units, catalogue matches or validation numbers. A number in the docs comes from a
   command that can be re-run (`docs/VALIDATION.md` names it). Facts written from memory are marked as such. A candidate is a lead, never a discovery.
3. **Do not download new FITS files** without the author's explicit yes (file, source, size first). Catalogue queries (SIMBAD, Gaia, IRSA TAP, SkyBoT) are fine.
4. **Never force-push, rewrite history or delete branches.** Push only after the author's fresh, explicit yes, as a plain push to this repository
   (`mateibut/SPHEREx-Blink-3.0`, the branch the author names; an approval for one push does not cover the next). Work on a branch, not on `main`. (The text that stood
   here said "never push, work on the branch `blink-2.0`": that came from an earlier repository and is replaced.) Commit only when asked or when a task says to;
   messages end with the co-author line the tool gives you.
5. **Keep it working.** Existing URLs (`?ra=&dec=&fov=&det=&mode=`, `?data=api&api=`, `?embed=1`) and existing features stay. Run the tests before and after.
6. **Honest tests.** Never mark a test as passing without running it; never weaken a check to make it pass (change it only when the behaviour it
   encodes was meant to change, and say so).

## Commands

```bash
for f in scratch/test_*.mjs; do node "$f" | tail -1; done          # Node tests: PASS/FAIL lines, exit code != 0 on failure
backend/.venv/Scripts/python.exe -m pytest backend -q               # backend tests (Python 3.14 venv; `py` is the launcher, `python` is a broken alias)
node scratch/e2e_smoke.mjs                                          # the page in headless Chrome (synthetic demo, Node 22+, no install; not part of the test_*.mjs set); docs/BENCHMARKS.md section 3
node scratch/benchmark.mjs --check                                  # the digests of three searches against scratch/benchmark_baseline.json; --write only when a scientific change was meant
# the Playwright regression (a TEST-ONLY tool, pinned: `npm install playwright@1.59.1` in a folder OUTSIDE the repository, then NODE_PATH=<that folder>/node_modules):
#   py scripts/serve_frontend.py 8765   then   BLINK_BROWSER=chrome node scratch/browser_navigation.cjs   (also browser_layout_audit, _tour_modal, _public_backend, _sky_archive, _simulator_precision,
#   _candidate_roundtrip, _workspace, _all; BLINK_URL=http://127.0.0.1:8765/ is the default). A bare index.html redirects to overview.html: use index.html#workspace or a query string.
#   browser_real, _real_responsive and _provenance need the real-data backend (BLINK_REAL_URL) and are not run in CI.

py scripts/serve_frontend.py 8765                                   # frontend, no stale cache (also .claude/launch.json "frontend")
node scratch/calibrate_astrometry.mjs                               # the injection tables of VALIDATION §15 (a minute); scratch/check_astrometry_real.mjs: the same errors on the real fields (needs backend-real)
node scratch/make_results_sources.mjs                               # remake frontend/data/real_sources.json (needs "backend-real" and internet): do it when discovery.js VERSION or a threshold changes, test_results.mjs fails on a stale file
# real-data runs need a real-only backend:  SPHEREX_DATA_DIR=backend/data/real  uvicorn on port 8003  ("backend-real" in .claude/launch.json),
# then e.g.  node scratch/validate_discovery.mjs --mode real --field "Barnard D2"      (VALIDATION.md §14)
```

Open the page with real data: `http://localhost:8765/?data=api&api=http://localhost:8003&ra=269.4462&dec=4.769&fov=5&det=D2`.
`?theme=midnight|nebula|deep-space|observatory|light|classic` picks a colour theme for one visit (Midnight / dark is the default on a first visit; the other five are the Paper palettes).

## Conventions

- UI text and documents in **English**; the author chats in Romanian (answer in Romanian, explain astronomy basics, say what is certain and what is from memory).
- Colours only through the CSS tokens in `frontend/css/styles.css` section 1 (`scratch/test_theme.mjs` checks contrast per theme). Charts keep a dark ground in every theme.
- Analysis code is **pure** (no DOM, no network, `fetch` injectable) in `frontend/js/features/`, so Node can test it; the DOM part is a separate module.
- New feature = code + tests (Node or pytest) + a line in `docs/FEATURE_STATUS.md` + limits in `docs/SCIENTIFIC_LIMITATIONS.md`; a measured claim goes in `docs/VALIDATION.md` with its command.
- Scratch scripts that need real files print a report and are not run in CI. Windows: Git Bash heredocs choke on some quotes; write files with the editor tool.
- Libraries are added only with a pinned version and a licence line in `CREDITS.md`; nothing is deployed or published without the author asking.

## Open decisions (the author's, not code's)

Which repository is final: on 12 Nov 2026 the author named **SPHEREx-Blink-3.0** for later changes (SPHEREx-Blink-2.0 holds a parallel line of work that is not merged here yet); eligibility of work begun before the hackathon (`docs/TODO.md` §1); the data licence and
acknowledgement wording (`CREDITS.md`).
