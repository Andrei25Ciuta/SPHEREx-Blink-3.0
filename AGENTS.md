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
4. **Never `git push`, force-push, delete branches or touch `main` history.** The author pushes. Work is on the branch `blink-2.0`; `main` is the reference.
   Commit only when asked or when a task says to; messages end with the co-author line the tool gives you.
5. **Keep it working.** Existing URLs (`?ra=&dec=&fov=&det=&mode=`, `?data=api&api=`, `?embed=1`) and existing features stay. Run the tests before and after.
6. **Honest tests.** Never mark a test as passing without running it; never weaken a check to make it pass (change it only when the behaviour it
   encodes was meant to change, and say so).

## Commands

```bash
for f in scratch/test_*.mjs; do node "$f" | tail -1; done          # Node tests: PASS/FAIL lines, exit code != 0 on failure
backend/.venv/Scripts/python.exe -m pytest backend -q               # backend tests (Python 3.14 venv; `py` is the launcher, `python` is a broken alias)
py scripts/serve_frontend.py 8765                                   # frontend, no stale cache (also .claude/launch.json "frontend")
# real-data runs need a real-only backend:  SPHEREX_DATA_DIR=backend/data/real  uvicorn on port 8003  ("backend-real" in .claude/launch.json),
# then e.g.  node scratch/validate_discovery.mjs --mode real --field "Barnard D2"      (VALIDATION.md §14)
```

Open the page with real data: `http://localhost:8765/?data=api&api=http://localhost:8003&ra=269.4462&dec=4.769&fov=5&det=D2`.
`?theme=light|observatory|classic|deep-space` picks a colour theme for one visit.

## Conventions

- UI text and documents in **English**; the author chats in Romanian (answer in Romanian, explain astronomy basics, say what is certain and what is from memory).
- Colours only through the CSS tokens in `frontend/css/styles.css` section 1 (`scratch/test_theme.mjs` checks contrast per theme). Charts keep a dark ground in every theme.
- Analysis code is **pure** (no DOM, no network, `fetch` injectable) in `frontend/js/features/`, so Node can test it; the DOM part is a separate module.
- New feature = code + tests (Node or pytest) + a line in `docs/FEATURE_STATUS.md` + limits in `docs/SCIENTIFIC_LIMITATIONS.md`; a measured claim goes in `docs/VALIDATION.md` with its command.
- Scratch scripts that need real files print a report and are not run in CI. Windows: Git Bash heredocs choke on some quotes; write files with the editor tool.
- Libraries are added only with a pinned version and a licence line in `CREDITS.md`; nothing is deployed or published without the author asking.

## Open decisions (the author's, not code's)

Where Blink 2.0 lives (separate repository or this branch); eligibility of work begun before the hackathon (`docs/TODO.md` §1); the data licence and
acknowledgement wording (`CREDITS.md`).
