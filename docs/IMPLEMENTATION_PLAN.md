# Continue the SPHEREx Blink 3.0 pilot and prepare the OpenCode handoff

## Verified starting point (historical Codex baseline)

The agreed next feature is **browsing IRSA’s real SPHEREx sky map in the Science Workspace and explicitly requesting a zone**. The Google Cloud acquisition backend already exists. The pilot connects to its existing contract and tests acquisition locally with fixtures.

The clean Matei checkout is at `94e0b648b2a9cd88683f7f86d0fb4e47460ca89d`. The older Iooonut checkout is at `427bfee85ec3a419b397777d71f62cd3a42897ee` and contains untracked work. There is no `sky_browse` implementation or OpenCode handoff in the inspected checkout. **All 61 Node test scripts passed, and all three scientific benchmark outputs matched.** Python and rendered browser checks were unexecuted in this pass. The default Python lacks the test dependencies, and Playwright is unavailable on Node’s default module path.

When execution begins, clone the [Iooonut fork](https://github.com/Iooonut/SPHEREx-Blink-3.0) into a new directory, add [Matei’s repository](https://github.com/mateibut/SPHEREx-Blink-3.0) as `upstream`, verify both remotes and their current heads, and branch `sky-browse-pilot` from `upstream/main`. Preserve both existing checkouts. Read `AGENTS.md`, the backend contract, the cloud deployment guide, and the latest progress entry before editing.

**Actual execution:** The fork was already cloned. At onboarding, the public `main` refs for the fork and parent both pointed to `94e0b648b2a9cd88683f7f86d0fb4e47460ca89d`. The pilot branch was created at that base in the existing checkout; `origin` still points to the fork, and no `upstream` remote was added. See the [OpenCode handoff](OPENCODE_HANDOFF.md) for the tested checkpoint, commands, and remaining release gates.

## Task ledger and implementation order

| ID | Status now | Scope, dependencies, and acceptance |
|---|---|---|
| **C1 — Cloud acquisition and serving** | **DONE** | `backend/cloud_app.py`, `backend/orchestration_app.py`, `backend/spherex/`, and `deploy/` already provide durable requests, per-detector progress, retries and recovery, validated monthly sequences, and dynamic serving. Preserve these contracts. Keep existing Python workflow, archive fallback, and science tests as regression gates. |
| **P1 — Browse the DR1 map** | **DONE — local** (`a9ff57c`) | **First implementation task.** Add `index.html?data=api&sky_browse=1#workspace`. Reuse Aladin Lite 3.6.5 and the existing Sky Context module. Use IRSA’s **0.753 µm** DR1 mosaic, open at a wide view centred on Barnard’s Star, and show a labelled 2MASS fallback if the DR1 layer fails. Acceptance requires visible real tiles, working pan and zoom, and zero field-request POSTs. Test the actual layer and the failure path on desktop and phone. [IRSA HiPS cube tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-hipscube/) |
| **P2 — Select and submit a zone** | **DONE — local, fixture submission** (`6fbd35d`) | Depends on P1. Use the centre reticle, editable ICRS coordinates, existing footprint geometry, and a separate **1–10′** zone size defaulting to **5′**. Only **Request this zone** commits the draft and sends one `POST /api/field-requests` for DR1 and D1–D6. Reuse Blink’s coordinate validation and send the same normalized values saved in the URL. Test bounds, keyboard selection, rapid clicks, and zero POSTs during pan, zoom, or draft adjustment. |
| **P3 — Progress, playback, and restore** | **DONE — local, fixture lifecycle** (`f8deecf`) | Depends on P2. Reuse the status API, detector cards, and cutout player. Keep the map usable while polling and show frames as detectors become ready. Save the committed request ID. Pilot links and reloads resume with GET only, after verifying the returned centre and size. Missing or mismatched IDs require explicit submission. Test partial playback, no coverage, explicit retry, stale responses, and existing Workspace and Learn Mode links. |
| **H1 — Plan and OpenCode handoff** | **DONE — local** | Record the agreed plan in `docs/IMPLEMENTATION_PLAN.md`. After the last coherent checkpoint, update the ledger with actual statuses and create [the OpenCode handoff](OPENCODE_HANDOFF.md). Include the exact branch, base, incomplete work, known failures, test commands and results, and the single next task. |

Use the existing field-request endpoints and payloads. Keep scientific processing, immutable manifests, ordinary Workspace links, and synthetic Learn Mode compatible. Accounts, tiers, payments, dedications, and catalogue name search belong to later work.

## What the handoff must preserve

- **Working cloud deployment.** Project `spherex-blink`, region `europe-west1`. GitHub Pages serves the static frontend. FastAPI service `blink3-api` exposes field submission, status, retry, cutouts, registered sequence assets, photometry, and catalogue lookups. Cloud Tasks queue `blink3-acquisition` dispatches to the private `blink3-orchestrator`, which discovers metadata through IRSA SIA with TAP fallback and launches `blink3-prepare`. Firestore `blink3-state` holds request, detector, and catalogue state; `blink3-policy` holds the owner policy. The private bucket is `spherex-blink-blink3-products`. Document the configuration and index declarations in `deploy/` and distinguish the local `backend/app.py` FITS API from the cloud service. [Existing API](https://blink3-api-w3bm7ii4fq-ew.a.run.app/api/health)
- **Verified limits and evidence.** Real fields support 1–10′. The deployed policy covers D1–D6, up to 20 concurrent detector jobs, and one usable image per available UTC month up to the latest 12 months per detector. Keep the 32 MiB per-file and 128 MiB per-detector limits. The prior read-only Barnard check at RA `269.4462`, Dec `4.769`, FOV `5′` returned 70 frames across six detectors. The API response lacked localhost CORS permission. Use intercepted requests for the pilot and record live reads separately. Keep credentials, original FITS files, and private bucket access out of the frontend and Git.
- **OpenCode coordination.** GPT-6.2 Sol coordinates the work, owns the shared Workspace wiring, and integrates changes. GPT-6 Luna researches the HiPS layer and existing request entry points. A separate Luna worker can own isolated mock fixtures or tests. The GPT-6.2 Sol developer owns request and restore integration after the draft interface is agreed. GPT-6.2 Astra reviews accidental job triggers, request races, and compatibility. Give one writer at a time ownership of `main.js`, shared URL state, and the request lifecycle. The coordinator promotes the next ledger task after its acceptance checks pass.
- **Documentation and operating rules.** Give every task an ID, status, relevant modules, dependencies, constraints, acceptance criteria, and verification commands. Mark historical results separately from new runs. Include local setup, external services, known limitations, and the next task. Keep all handoff and UI copy in English. Leave the colleagues’ Google Doc untouched.

## Linux verification and Git preparation

Use Python 3.14, Node 22 or newer, Git, and Chrome or Chromium. The static frontend needs no npm install. On Arch, install missing system packages with `sudo pacman -S --needed git python nodejs npm chromium`. Set up the app from the repository root:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements-dev.txt
python3 scripts/serve_frontend.py 8765
```

For the optional local FITS API, run `.venv/bin/python -m uvicorn app:app --app-dir backend --port 8001`. Document `SPHEREX_DATA_DIR` for an existing local FITS archive, `BLINK_URL` and `BLINK_BROWSER` for browser tests, and configuration names such as `GOOGLE_CLOUD_PROJECT`, `BLINK_GCS_BUCKET`, and `BLINK_CORS_ORIGINS` for cloud reference. Local pilot tests need no Google credentials. Install the repository’s pinned Playwright `1.59.1` outside the checkout and use a supported browser executable.

Run the Node suite, `node scratch/benchmark.mjs --check`, `.venv/bin/python -m pytest backend -q`, and the relevant Workspace, navigation, and sky browser regressions. The final browser walkthrough must show **real DR1 map → select a zone → one mocked submission → detector progress → playable frames**. Record failures and unexecuted checks. Review `git diff --check` and the changed file list for credentials, FITS, generated files, and unrelated edits. Leave the reviewed branch ready for a later commit and push. Production changes and publishing require separate authorization.
