# Chat handoff — 15 November 2026

Continue in the repository whose `origin` is `https://github.com/mateibut/SPHEREx-Blink-3.0.git`. Keep UI copy and conversation in English. The prior local Iooonut fork checkout and its untracked manifest artifacts are separate; do not overwrite or stage them.

## Current production state

- Project `spherex-blink`, region `europe-west1`; public Cloud Run API: `https://blink3-api-w3bm7ii4fq-ew.a.run.app`.
- API revision `blink3-api-00023-zpm`, private orchestrator revision `blink3-orchestrator-00024-s5j`, preparation job `blink3-prepare`, image tag `dr1-concurrency20-v1compat-20261115`.
- Firestore database `blink3-policy` has enabled policy `spherex-dr1-owner-v2`: SPHEREx DR1 only; D1–D6; 12 newest observations by default; optional date bounds; 32 MiB/file; 128 MiB/detector; 20 global detector jobs. It explicitly allows already-created v1 requests to finish with their original provenance. No login or per-user quotas. The private GCS bucket remains private.
- The first live on-demand request `fr-9fe8d9f503e9ccca9f2964e5a9bba0ad` completed for Barnard's Star (RA 269.4462, Dec 4.769, FOV 5). Each detector completed 12 planned files. The validated dynamic registry serves 70 usable frames across all six detectors; `GET /api/sequences` lists 12 sequences (six existing static plus six dynamic) without an API rebuild.
- GitHub Pages Workspace URL, tested with this backend:

  `https://iooonut.github.io/SPHEREx-Blink-3.0/index.html?data=api&api=https%3A%2F%2Fblink3-api-w3bm7ii4fq-ew.a.run.app&ra=269.4462&dec=4.769&fov=5&det=D2#workspace`

  Do not add `legacy_api=1`; that deliberately disables on-demand requests. Keep query separators as literal `&` characters.

## Current working tree and verification

The cloud system was built and deployed from the current local tree, but these source and documentation edits have not been committed or pushed. There are also pre-existing uncommitted user changes to `backend/approved_sequences.json`, `.barnard-manifest-review/`, `backend/approved_sequences.20261114T170314Z.backup.json`, `batch_barnard.py`, `blink3-api-before-d5.yaml`, `register_barnard_manifests(1).py`, and `test.py`; do not overwrite, stage, or commit those as part of another task.

Linux checks: backend suite **218 passed**; all `scratch/test_*.mjs` passed; benchmark comparison matched all three baseline digests; smoke test **17 passed**; accessibility audit **18 passed**. Published GitHub Pages was opened with the real API at 1440×1000 and 390×844: automatic request reuse, 6/6 detector status, thumbnail cards, playback image and Inspector metadata worked; selecting D3 updated the Inspector. At 390 px the six progress cards rendered without horizontal overflow or page errors. Screenshots: `/tmp/blink-cloud-workspace-live-d3.png` and `/tmp/blink-cloud-workspace-live-390.png`. One generic console 404 message on desktop had no corresponding failed response from the API, so its source remains unidentified. Live data export/photometry and 320 px mobile layout were not run.

## Implementation notes

The live test surfaced and fixed three integration issues: Cloud Tasks `dispatch_deadline` must be at the task level; repeated submissions must recover Firestore requests whose enqueue previously failed; and detector slot claiming must not read the owner policy from the separate policy database inside a state-database transaction. Reconciliation now rotates detector task names so Cloud Tasks' completed-name deduplication cannot strand queued work. A new dynamic-manifest test checks the separate official acknowledgement and DOI.

The latest observation IDs differed from the old static Barnard manifests, so the default-newest request correctly prepared newer products. Dynamic manifest validation, Firestore registration, partial results, and the three-job semaphore were exercised in production. No synthetic fallback or scientific pipeline changes were made.

See `docs/CLOUD_DEPLOYMENT.md`, `docs/BACKEND_CONTRACT.md`, and the newest entry in `docs/CODEX_PROGRESS.md` for deployment, APIs, IAM, tests, and remaining checks. The published UI currently displays the official acknowledgement; the local working tree additionally renders the DOI as a link, which will not appear on GitHub Pages until those edits are published.
