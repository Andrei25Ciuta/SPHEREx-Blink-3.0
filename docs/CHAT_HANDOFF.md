# Chat handoff — 15 November 2026

Continue in the repository whose `origin` is `https://github.com/mateibut/SPHEREx-Blink-3.0.git`. Keep UI copy and conversation in English. The prior local Iooonut fork checkout and its untracked manifest artifacts are separate; do not overwrite or stage them.

## Current production state

- Project `spherex-blink`, region `europe-west1`; public Cloud Run API: `https://blink3-api-w3bm7ii4fq-ew.a.run.app`.
- API revision `blink3-api-00027-jxt`, private orchestrator revision `blink3-orchestrator-00031-4s4`, and preparation job `blink3-prepare` use release tag `monthly-sampling-v4-20261115`.
- Firestore database `blink3-policy` has enabled policy `spherex-dr1-owner-v4`: SPHEREx DR1 only; D1–D6; one observation per UTC month, up to the newest 12 months by default; optional date bounds; 32 MiB/file; 128 MiB/detector; 20 global detector jobs. It explicitly allows policy v1–v3 requests to finish with their recorded provenance. No login or per-user quotas. The private GCS bucket remains private.
- Monthly sampling is deployed and enabled. A refresh was submitted for every legacy field with at least one prepared detector, highest FOV first. Shortly after submission, 51 matching requests were in the catalog; 42 were discovering, 9 were queued, and the extra 10′ concurrent request was ready. IRSA SIA and TAP were both returning HTTP 502 for most discovery attempts; no preparation execution had started downloading at the latest check. See the newest `docs/CODEX_PROGRESS.md` entry before retrying or creating any more requests.
- The first live on-demand request `fr-9fe8d9f503e9ccca9f2964e5a9bba0ad` completed for Barnard's Star (RA 269.4462, Dec 4.769, FOV 5). Each detector completed 12 planned files. The validated dynamic registry serves 70 usable frames across all six detectors; `GET /api/sequences` lists 12 sequences (six existing static plus six dynamic) without an API rebuild.
- GitHub Pages Workspace URL, tested with this backend:

  `https://iooonut.github.io/SPHEREx-Blink-3.0/index.html?data=api&api=https%3A%2F%2Fblink3-api-w3bm7ii4fq-ew.a.run.app&ra=269.4462&dec=4.769&fov=5&det=D2#workspace`

  Do not add `legacy_api=1`; that deliberately disables on-demand requests. Keep query separators as literal `&` characters.

## Current working tree and verification

This handoff describes the `mateibut/SPHEREx-Blink-3.0` checkout on `mateibut-main-update`, based on the latest fetched `origin/main` commit `61279cc` before the current documentation update. The tree was clean at the start of this task; no user manifests or local data were modified. The Cloud Run release completed, both the existing `a.run.app` API hostname and the currently reported Cloud Run hostname returned HTTP 200 for `/api/sequences?limit=1`, and the v4 policy readback matched the reviewed policy. No preparation execution was active at the latest status check because IRSA SIA and TAP were both returning HTTP 502. No tests were run during this operational handoff.

## Implementation notes

The live test surfaced and fixed three integration issues: Cloud Tasks `dispatch_deadline` must be at the task level; repeated submissions must recover Firestore requests whose enqueue previously failed; and detector slot claiming must not read the owner policy from the separate policy database inside a state-database transaction. Reconciliation now rotates detector task names so Cloud Tasks' completed-name deduplication cannot strand queued work. A new dynamic-manifest test checks the separate official acknowledgement and DOI.

The latest observation IDs differed from the old static Barnard manifests, so the default-newest request correctly prepared newer products. Dynamic manifest validation, Firestore registration, partial results, and the three-job semaphore were exercised in production. No synthetic fallback or scientific pipeline changes were made.

See `docs/CLOUD_DEPLOYMENT.md`, `docs/BACKEND_CONTRACT.md`, and the newest entry in `docs/CODEX_PROGRESS.md` for deployment, APIs, IAM, tests, and remaining checks. The published UI currently displays the official acknowledgement; the local working tree additionally renders the DOI as a link, which will not appear on GitHub Pages until those edits are published.
