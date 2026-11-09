# Deployment notes

How the pieces are run and published today, and what has **not** been done. Nothing here was deployed by the code or by an agent: publishing is the
author's decision (AGENTS.md). Facts below come from the files named next to them; what is from memory or untested is marked.

## 1. The static demo (GitHub Pages)

- `.github/workflows/pages.yml` publishes **only the folder `frontend/`**, on every push to `main` and on manual dispatch. The branch `blink-2.0` is **not**
  published by it (the trigger is `main`): Blink 2.0 reaches the public demo only when it is merged.
- The demo runs on **synthetic** data: the badge in the page header says "Synthetic demo data". There is no backend and no data file in the published folder.
- One-time setup on GitHub: Settings, Pages, Build and deployment, Source: "GitHub Actions" (the comment at the top of `pages.yml`).
- No build step. The page is ES modules and CSS; `frontend/js/searchWorker.js` and `planetLabWorker.js` are module workers, loaded with
  `new Worker(url, { type: "module" })`. A server must send `.js` files as JavaScript (`text/javascript`); Pages is believed to (from memory, not checked
  for these two files). If a worker cannot start, the page runs the same search on its own thread and the answer is the same
  (see [BENCHMARKS.md](BENCHMARKS.md) section 2).
- Outside requests the page makes: the web fonts (Google Fonts, optional: the page has fallbacks), and on demand Plotly, Aladin Lite and the world map
  from `cdn.jsdelivr.net` with pinned versions (`measure.js`, `skyContext.js`, `skyGeo.js`; listed in `CREDITS.md`). With synthetic data it asks no catalogue
  (`scratch/e2e_smoke.mjs` checks that no host but the server is asked, apart from the fonts).
- The results page (`results.html`) needs `data/real_results.json` and `data/real_sources.json` served next to it: derived numbers only, no pixel.

## 2. Running it locally

```bash
py scripts/serve_frontend.py 8765                       # the frontend, with no-cache headers (a plain `http.server` lets the browser keep old scripts)
pip install -r backend/requirements.txt                 # fastapi, uvicorn, astropy, numpy, pillow (Python 3.14 is what the backend was tested with)
python -m uvicorn app:app --app-dir backend --port 8001 # the backend on synthetic files (.claude/launch.json "backend")
```

With real data, the backend is started on a folder of real files: `SPHEREX_DATA_DIR=backend/data/real`, port 8003 (`.claude/launch.json`
"backend-real"). Open `http://localhost:8765/?data=api&api=http://localhost:8003&ra=269.4462&dec=4.769&fov=5&det=D2`. Environment variables the backend
reads: `SPHEREX_DATA_DIR` (the image files) and `SPHEREX_CACHE_DIR` (its cache); nothing else was found in `backend/` (`grep environ`).

## 3. What must not be published

- **Real SPHEREx files and pixels** are never committed or published. `backend/data/` is git-ignored. The data licence has not been checked (an open
  decision of the author: `CREDITS.md`). The results page and `real_sources.json` hold derived numbers only (`test_results.mjs` checks that no pixel
  and no local address is in them).
- **A backend that serves real cutouts must not be put on a public address.** `backend/app.py` allows any origin (`allow_origins=["*"]`, GET only), has
  no rate limit and no request size limit ([PROJECT_AUDIT.md](PROJECT_AUDIT.md) A3), and `/api/footprints` and the cutouts would expose the files
  (the footprints send an opaque id, no path, but the cutouts are pixels).
- `GET /api/survey` and `GET /api/catalogue` make a **live query of IRSA (or ESA) for whoever calls them**: with no rate limit, an exposed backend can be used to load those services (the answers are cached on disk, for a day for `/api/survey`). Another reason not to put the backend on a public address as it is.
- Links the page builds for sharing drop `data=` and `api=` (a link must not carry the address of a backend on someone's computer).

## 4. Not done, and not verified

- No backend is hosted anywhere. A hosted backend would need: HTTPS, a restricted CORS origin, rate limits, size limits, and the answer to the data-licence
  question. None of this was started.
- CI: all three jobs of `tests.yml` (`node` on Node 20.20.2, `backend` on Python 3.14, `e2e` on Node 22.23.4 with the runner's Chrome) passed on the pull
  request for commit `cdc96c5` (run 42711017130, 10 Nov 2026). The action versions were written from memory and worked; the logs warn that some of them
  (`actions/checkout@v4` and others) target Node.js 20, which is deprecated, and that GitHub runs them on Node 24 for now. Newer major versions were not looked up.
- The Pages deployment of Blink 2.0 has not been tried; `main` still has the old page. Where Blink 2.0 lives (this branch or a separate repository) is the
  author's decision ([IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md), "Decisions that belong to the author").
- Browsers: developed and checked in Chrome (and the Claude desktop app's browser pane). Firefox, Safari and phones were not tested, apart from a 375 px
  emulation.
