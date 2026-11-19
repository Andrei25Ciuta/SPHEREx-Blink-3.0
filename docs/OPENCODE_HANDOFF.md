# SPHEREx Blink 3.0 — OpenCode handoff

## Resume here

- **Checkout:** the existing `Iooonut/SPHEREx-Blink-3.0` fork, branch `sky-browse-pilot`. `origin` is the fork; Matei’s repository is its GitHub parent but is not configured as a local `upstream`. Do not clone again or change remotes for this handoff.
- **Base:** `94e0b648b2a9cd88683f7f86d0fb4e47460ca89d`. **Last tested implementation checkpoint:** `f8deecfa3bce93682e4b002b77770fe6e1c87528`; the H1 documentation commit follows it. Verify `git remote -v`, `git status --short --branch`, and `git log -5 --oneline` before editing. The local `.opencode/oh-my-opencode-slim/` instruction files are user-owned and intentionally untracked.
- **Completed locally:** P1 real map (`a9ff57c`), P2 draft and explicit submission (`6fbd35d`), P3 progress, playback, and restoration (`f8deecf`), and H1 ([task ledger](IMPLEMENTATION_PLAN.md)). Nothing in this pilot was pushed or deployed. No backend, schema, or scientific processing changes were made.
- **Single next task:** harden the observed request lifecycle offline before connecting the showcase to cloud acquisition. Astra Oracle became available and reviewed `1a308d8`; see the release gates in the current [progress entry](CODEX_PROGRESS.md). A push, deployment, production verification, or new live field request still requires fresh authorization.

Read [AGENTS.md](../AGENTS.md), [the task ledger](IMPLEMENTATION_PLAN.md), [the backend contract](BACKEND_CONTRACT.md), [the deployment guide](CLOUD_DEPLOYMENT.md), and [the progress log](CODEX_PROGRESS.md). The older `CHAT_HANDOFF.md` describes Matei’s checkout and historical production observations; it is not a current fork handoff.

## What the pilot does

The feature is now integrated into the **normal Science Workspace**. The offline showcase is `index.html#workspace`: choose a zone with the original 1–30′ slider and select **Request this zone** to generate synthetic frames locally. The optional map shows real imagery for context only. The separate API mock URL is `index.html?data=api&api=http%3A%2F%2F127.0.0.1%3A8765#workspace` if the mock service is running. Both hand off to the original player on successful explicit submission; the older pilot link remains supported. See the latest [progress entry](CODEX_PROGRESS.md) for checkpoints and evidence.

| Task | Main files | Behavior and evidence |
|---|---|---|
| P1 | `frontend/js/features/skyBrowse.js`, `skyContext.js`, `frontend/index.html` | Opens IRSA’s real DR1 **0.753 µm** display layer (first, unsuffixed PNG plane) at 12° around Barnard’s Star using the existing Aladin Lite 3.6.5 pin. Labels the 2MASS color fallback from ESA. Rendered pan, zoom, and fallback verified in desktop and phone-emulated Chromium. |
| P2 | `frontend/js/features/skyZone.js`, `frontend/js/main.js` | The reticle and editable ICRS coordinates define a draft. The width is 1–10′, default 5′, independent of map zoom. Only **Request this zone** submits DR1/D1–D6. The normalized field sent to the existing API is the field saved in the URL. Invalid coordinates, pan, zoom, editing, or reload never POST. |
| P3 | `frontend/js/data/skyZoneRequest.js`, `frontend/js/urlState.js`, `frontend/js/main.js`, `frontend/css/styles.css` | Status and scoped cutout GETs populate the existing detector cards and player as detectors become ready. An acknowledged `request_id` restores through status GET only, after matching the returned ID and exact numeric centre and width. Unknown and mismatched links do not load cutouts or submit. Explicit retry sends one retry POST, then resumes GETs on the same ID. New requests invalidate old progress, frames, and errors. |

The real mosaic is for browsing, not evidence of usable coverage or a photometry input. The local mock cutouts are labelled synthetic. Normal Workspace URLs, embed, Results, and synthetic Learn Mode still work.

## Local preview and verification

The current loopback preview, if still running, is [the mock pilot](http://127.0.0.1:8765/index.html?data=api&sky_browse=1&api=http%3A%2F%2F127.0.0.1%3A8765#workspace). The map is real; request records, progress, retry, and frames are synthetic fixtures with no cloud access. The temporary script `/tmp/opencode/blink-p1/preview_p3.py` can be restarted with `python -B /tmp/opencode/blink-p1/preview_p3.py "$PWD/frontend"` if present and port 8765 is free. Its in-memory request IDs survive a browser reload, not a server restart. Do not substitute a live API for the mock.

On a fresh Linux session, use Python 3.14, Node 22+, and Chromium or Chrome. The frontend has no build step. The guarded Playwright fixture is checked in; it does not depend on the temporary preview script. Run these setup commands only if the test dependencies are missing:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements-dev.txt
npm install --prefix /tmp/opencode/blink-pilot-test playwright@1.59.1 --no-audit --no-fund --ignore-scripts
```

From the repository root:

```bash
( set -e; for t in scratch/test_*.mjs; do node "$t"; done )
node scratch/benchmark.mjs --check
git diff --check
```

The tested backend run blocked sockets and DNS because an existing test can reach an unmocked TAP fallback. To reproduce without live archive traffic:

```bash
PYTHONDONTWRITEBYTECODE=1 timeout 120 .venv/bin/python -B - <<'PY'
import socket
import pytest

def offline(*args, **kwargs):
    raise OSError("External networking disabled for regression tests")

socket.getaddrinfo = offline
connect = socket.socket.connect

def guarded_connect(s, address):
    if s.family in (socket.AF_INET, socket.AF_INET6):
        offline()
    return connect(s, address)

socket.socket.connect = guarded_connect
raise SystemExit(pytest.main(["backend", "-q", "-p", "no:cacheprovider"]))
PY
```

Start a static loopback server in one terminal and run the guarded browser walkthrough from another:

```bash
python3 -B -m http.server 8772 --bind 127.0.0.1 --directory frontend
# Other terminal:
NODE_PATH=/tmp/opencode/blink-pilot-test/node_modules \
  CHROME_PATH=/usr/bin/chromium BLINK_URL=http://127.0.0.1:8772/ \
  node scratch/browser_sky_browse.cjs
```

The walkthrough installs Playwright route guards **before** navigation. It allows public read-only map resources but fulfills field creation, retry, status, and cutouts only with local fixtures. `BLINK_SKY_LIFECYCLE_ONLY=1` selects the lifecycle scenario. The optional local FITS API (`.venv/bin/python -m uvicorn app:app --app-dir backend --port 8001`) is a separate API and cannot simulate on-demand acquisition by itself.

**Final implementation results:** 64 Node scripts, all three science benchmark digests, 264 backend tests (two warnings), and the guarded Playwright pilot passed. Workspace, navigation, Sky Explorer, synthetic smoke, and accessibility regressions passed separately. See the P3 entry in [the progress log](CODEX_PROGRESS.md) for commands and failed attempts: public tile timeouts, a backend run blocked on TAP, and two corrected browser fixture assumptions. Actual handsets, other browser engines, live cloud acquisition, and production CORS were not exercised by the pilot. The historical localhost CORS limitation is not a reason to change production configuration.

## Working rules

Keep the existing public FastAPI contract, durable Firestore state and owner policy, authenticated Cloud Tasks orchestration, `blink3-prepare` job, and private GCS products. Do not change production CORS, IAM, policy, secrets, storage, or science for this pilot. Do not download FITS without separate approval. Keep real observations, synthetic frames, and fallback surveys labelled distinctly.

Use GPT-6.2 Sol Medium for coordination, Luna Fast High for Explorer/Designer, Luna Fast XHigh for isolated Fixer work, Sol High for Developer, and Astra High for critical review. Writers can work in parallel on separate files; one writer owns `main.js`, URL state, and the request lifecycle. Each specialist makes one path-scoped **local** commit after its contribution works and passes focused tests; the coordinator reviews those checkpoints and runs final integration checks. Context7 was verified in Explorer; gh_grep answered in the coordinator; browser verification used Playwright 1.59.1 with system Chromium.
