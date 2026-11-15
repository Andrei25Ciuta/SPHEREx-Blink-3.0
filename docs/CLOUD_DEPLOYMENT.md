# SPHEREx Blink Cloud Deployment

This document describes the on-demand acquisition deployment. The owner explicitly approved production provisioning, IAM, policy enablement, and rollout on 15 Nov 2026. Future deployments, IAM changes, or policy expansions still require fresh owner approval.

## Current production state

Project `spherex-blink`, region `europe-west1`, private bucket `spherex-blink-blink3-products`, public read API `blink3-api`, and preparation job `blink3-prepare` already exist. The user’s working tree includes local D1–D6 Barnard sequence registration and manifest review files. Do not overwrite these local files, change existing GCS revisions, or replace serving configuration as part of setup.

Canonical public service URL: `https://blink3-api-w3bm7ii4fq-ew.a.run.app`. Initial 15 Nov release used API revision `blink3-api-00019-dw9`, orchestrator `blink3-orchestrator-00015-8vt`, and job image `dr1-auto-20261115e`. The current orchestrator is `blink3-orchestrator-00017-pkn` (image `dr1-async-20261114b`), with max instances 3. `BLINK_SERVE_PIXELS=true` and all six static Barnard sequences remain available. Firestore policy `spherex-dr1-owner-v1` is enabled. Live request `fr-9fe8d9f503e9ccca9f2964e5a9bba0ad` for Barnard's Star (RA 269.4462, Dec 4.769, FOV 5) completed: six detectors prepared 12 newest files each, yielding 70 usable frames. `/api/sequences` now reports 12 sequences (six static and six dynamically registered), with no API rebuild. Production checks covered partial serving while jobs ran and no more than three active slots. New products remain in private GCS with only registered display/data/mask assets exposed by the API.

The source branch now allows real-data fields up to 30 arcmin, matching the asynchronous request validator and local/cloud cutout routes. Wide fields remain bounded by the existing 1024-pixel processing grid and byte caps. This source change has not been deployed; production still runs its existing revision and policy.

The source patch in this checkout raises the supported global detector-job cap to 20. Production still uses the three-job `spherex-dr1-owner-v1` policy and its existing Cloud Run revision until a separately approved release and policy migration are applied. Twenty active preparations can request up to 40 vCPU and 80 GiB of memory at the current 2-vCPU/4-GiB job size; regional quotas may reject or delay launches.

### Orchestrator capacity incident, 15 Nov

Slow synchronous IRSA and Google token-validation calls were running directly inside async request handlers, blocking the event loop. The task routes now offload synchronous network/database work to a worker thread. Discovery and planning make one bounded archive attempt per task delivery so Cloud Tasks provides durable backoff; the preparation downloader keeps its eight-attempt retry/resume behavior. The Cloud Scheduler reconciliation job was refreshed and verified HTTP 200. Two requests supplied during debugging are recovering: the 5′ request reached planning and has detector dispatch tasks waiting behind the three active global job slots; the 20′ request still encounters IRSA metadata timeouts and is being retried by Cloud Tasks. No duplicate detector executions were launched for those requests. See the current incident entry in `docs/CODEX_PROGRESS.md` for exact request IDs and verification limits.

## Architecture

- **GitHub Pages frontend:** submits coordinates, FOV (1–30 arcmin for real data), optional UTC date bounds and the fixed D1–D6 detector set. Planning selects up to 12 observations across available survey passes, then fills remaining slots with additional observations. It polls real Firestore progress every few seconds and loads detector frames as soon as each is ready. No GCP credentials are present in the browser. Synthetic mode remains available up to 30 arcmin.
- **Public Cloud Run `blink3-api`:** serves existing static and Firestore-registered immutable image products, creates/reuses request documents, enqueues Cloud Tasks and reports request status. It has no permission to execute Cloud Run Jobs.
- **Private Cloud Run `blink3-orchestrator`:** accepts only OIDC-authenticated Cloud Tasks/Cloud Scheduler calls. It queries IRSA metadata, writes private detector plans, enforces a transactional global semaphore capped at 20 detector jobs, launches the existing `blink3-prepare` job, and reconciles stalled executions. Cloud Tasks dispatch concurrency is a separate setting.
- **Cloud Run Job `blink3-prepare`:** runs the existing FITS validation and scientific processing unchanged. It retries transient archive failures up to eight attempts, resumes verified private staging files, writes a versioned manifest last, validates it against the current owner policy, then registers it in Firestore.
- **Firestore:** `blink3-state` stores stable field requests, per-detector progress, coordination and dynamic manifest index. `blink3-policy` stores the centrally managed owner policy. Runtime accounts have write access only to the state database and read-only access to the policy database. **Cloud Tasks:** delivers reliable authenticated work. **GCS:** stays private and holds plans, staging FITS, originals, manifests and products.

There is no sign-in, per-user quota, daily/monthly limit or CAPTCHA. The source cap is **20** active detector preparation jobs for testing and presentation; the live policy still limits production to three until migrated. Keep the emergency policy disable switch, DR1-only allowlist, FOV/frame/file bounds and private bucket. The existing $25 budget alert notifies; it is not a hard spend cap.

## Owner policy and data selection

`config/acquisition-policy` is versioned and written by `deploy/configure_policy.py`. It starts disabled. Source policy v3 targets processing version `blink3-cloud-2`, preserves D1–D6 and the official SPHEREx DR1 acknowledgement/DOI, selects up to 12 observations across available passes, and retains optional date bounds, 32 MiB per FITS file, 128 MiB per detector and at most 20 concurrent detector jobs. The website cannot set policy or approval fields. Other collections are rejected. The active live v1 policy remains unchanged until an owner-approved migration; this code update does not apply it.

The emergency stop is `enabled=false` on the Firestore policy. It prevents new requests; previously completed exact requests and existing serving remain available. The application exposes no policy-mutation endpoint, and browser input cannot set approval fields. The separate `blink3-policy` database and database-scoped read-only runtime grants prevent those services from changing the owner policy. Configure access through the documented policy script using an administrator identity. Manifests record the policy version and acknowledgement that authorized them.

## One-time setup (completed 15 Nov 2026)

The commands below were applied with owner approval. Review them and obtain explicit owner approval before changing production resources or IAM again.

```bash
bash deploy/setup.sh --apply
```

The script enables Firestore, Cloud Tasks and Cloud Scheduler APIs; creates separate native `blink3-state` and `blink3-policy` databases and the acquisition queue if missing; creates orchestration and task identities; and applies database-scoped IAM so runtime identities can write state but only read the owner policy. Google documents the per-database conditional binding format in its [Firestore database IAM guide](https://docs.cloud.google.com/firestore/native/docs/manage-databases#configure_per-database_access_permissions). It gives the public API queue enqueue rights and read-only access to the sequence prefix; grants the orchestrator the named-job execution role, plan/metadata read-write access and read-only sequence-manifest access; and grants the job bounded plan/staging/sequence object access. It does not enable the policy or launch a job. Inspect all existing IAM bindings before applying. The orchestrator’s custom job role is bound to `blink3-prepare`, not project-wide, and includes `run.jobs.runWithOverrides` because dispatch overrides the container arguments.

`deploy/setup.sh` requests the composite field-catalog index described by `deploy/firestore.indexes.json` in `blink3-state`. The dynamic catalog uses equality filters on normalized RA, Dec, FOV, collection, processing version and detector, then selects the newest prepared observation coverage by `latestMjd`. Wait until the index is ready before enabling acquisition. The index command follows the [official gcloud composite-index reference](https://docs.cloud.google.com/sdk/gcloud/reference/firestore/indexes/composite/create).

Deploy without resetting the current `BLINK_SERVE_PIXELS` value:

```bash
bash deploy/release.sh --apply cloud-v3
```

This builds the API and job images, deploys the private orchestrator and public API, binds the task identity as orchestrator invoker, and installs a two-minute reconciliation schedule. It does not execute `blink3-prepare`. The release script uses `--update-env-vars` for the existing API to retain its serving gate. Verify the deployed service URL, image digest, active revisions, D1–D6 static sequence responses, and current serving state before changing the policy.

Configure the DR1 policy in disabled mode first:

```bash
python3 deploy/configure_policy.py --project spherex-blink --apply
```

Once deployment, IAM, index readiness, static-data serving and no-download smoke checks are reviewed, the owner can enable ordinary user requests:

```bash
python3 deploy/configure_policy.py --project spherex-blink --apply --enable
```

To migrate the existing enabled v1 policy to source policy v3 after reviewing the processing-version change and selection behavior, use `--migrate-policy-version` explicitly:

```bash
python3 deploy/configure_policy.py --project spherex-blink --apply --enable --migrate-policy-version
```

This command changes Firestore policy only; it does not deploy Cloud Run. Do not run it until the matching code is deployed and the owner separately approves the policy migration. The release script sets `BLINK_MAX_ACTIVE_DOWNLOAD_JOBS=20`; the effective global limit is the lower of this value and Firestore's `maxConcurrentDownloads`.

Production deployment, IAM setup, policy activation, Cloud Run job executions and new FITS downloads were performed with the owner's explicit approval on 15 Nov 2026. The complete first-request result and tests are in the latest `docs/CODEX_PROGRESS.md` entry.

## API contract

- `POST /api/field-requests` validates and normalizes RA/Dec/FOV (1–30 arcmin), dates, D1–D6, and DR1; creates or reuses a stable Firestore request; returns `requestId`, `status`, `cached`, `statusUrl`, and available detector states. Requests above 30 arcmin receive HTTP 422. This is the explicit acquisition trigger.
- `GET /api/field-requests/{requestId}` returns durable overall and per-detector progress, file counts, bytes, frame counts, errors, and serving readiness. It never initiates work.
- `POST /api/field-requests/{requestId}/retry` retries only failed detectors; it reuses their server-generated plans when possible.
- Existing `GET /api/cutouts?ra=&dec=&fov=&det=` stays compatible and returns `{ "frames": [...] }`. Add `request_id` for request-scoped partial detector results. Existing `GET /api/photometry` still aggregates all requested detector sequences.

The UI updates only from backend progress events. Downloads expose completed/total files and bytes; processing uses completed product work. Progress is monotonic within one attempt; a retry creates a new attempt. No timer fabricates completion. Shared URLs and refreshes re-submit the same normalized request and attach to its persistent state. FOV slider changes submit on `change` (release), never each pointer event. Late prior-request responses are ignored.

## Checks before and after deployment

Local, deterministic checks use synthetic FITS fixtures and fake stores. They do not require GCP, IRSA or real FITS downloads:

```bash
.venv/bin/python -m pip install -r backend/requirements-dev.txt -r backend/requirements-cloud.txt
.venv/bin/python -m pytest backend -q
for test in scratch/test_*.mjs; do node "$test" || exit 1; done
node scratch/benchmark.mjs --check
node scratch/e2e_smoke.mjs
node scratch/a11y_audit.mjs
```

Browser layout checks use the agreed widths 320, 390, 768, 1024, 1366, 1440 and 1920 px. No new frontend dependency is needed. If the installed browser-test tooling is unavailable, report that separately from deterministic tests.

The first production request exercised: POST request; six detector plans; Firestore progress; no more than three active slots; dynamically published manifests; partial results through `request_id`; and latest-data selection. The initial dispatch uncovered and fixed three integration defects (Cloud Tasks deadline field nesting, request re-enqueue after task-create failure, and reading the owner policy from the wrong Firestore database). The published GitHub Pages Workspace was tested with the request URL and detector switching. Forced failure recovery, live refresh after a mid-download interruption, and live photometry/export remain untested. Do not repeat live archive downloads to run unit tests.

## Rollback and cleanup

Set the Firestore policy `enabled` to false to stop new acquisitions. Keep the API’s current pixel serving state, immutable approved manifests and existing D1–D6 objects. Roll back Cloud Run revisions if new request/status routes fail; the old static cutout contract remains. Do not delete the bucket or sequence products. `deploy/staging-lifecycle.json` describes a seven-day expiry only for `blink3/staging/`; review and merge it with the bucket’s existing lifecycle rules before applying. Orphan sequence assets are not covered by that rule and must only be cleaned after proving no published manifest references them.

## Known operational limits

- Live Cloud Tasks, Firestore request state, the field-catalog index, Cloud Run v2 execution overrides, OIDC invocation, dynamic registration and the three-job cap were exercised in production on the first request. Forced failure/recovery and a complete browser refresh on the live field remain untested.
- Archive metadata size and processing workloads are bounded, but GCP billing alerts do not enforce a spending stop. No daily or monthly application cap is configured, per the owner's decision.
- Browser ad blockers or DNS filters may block the API; the UI should show the request error and never replace failed real data with synthetic frames.
- No real data is committed to Git. New dynamically produced data is stored only in the private bucket and Firestore catalog.
