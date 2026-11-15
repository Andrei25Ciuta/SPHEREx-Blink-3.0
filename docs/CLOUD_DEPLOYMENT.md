# SPHEREx Blink Cloud Deployment

This document describes the on-demand acquisition deployment. The owner explicitly approved production provisioning, IAM, policy enablement, and rollout on 15 Nov 2026. Future deployments, IAM changes, or policy expansions still require fresh owner approval.

## Current production state

Project `spherex-blink`, region `europe-west1`, private bucket `spherex-blink-blink3-products`, public read API `blink3-api`, and preparation job `blink3-prepare` already exist. Preserve existing GCS objects and the API serving configuration during future setup.

Canonical public service URL: `https://blink3-api-w3bm7ii4fq-ew.a.run.app`. API revision `blink3-api-00025-d96` and orchestrator revision `blink3-orchestrator-00026-nfv` serve image tag `metadata-retry-cap-v1-20261115`; `blink3-prepare` remains on `dr1-concurrency20-v1compat-20261115`. Both Cloud Run services retain `BLINK_MAX_ACTIVE_DOWNLOAD_JOBS=20`; the API still has `BLINK_SERVE_PIXELS=true`. The production image is Blink3 cloud processing version 1 and accepts real-data fields up to 10 arcmin; synthetic demo fields remain separate.

Firestore database `blink3-policy` now has enabled policy `spherex-dr1-owner-v2`, with `maxConcurrentDownloads=20` and `compatiblePolicyVersions=["spherex-dr1-owner-v1"]`. This compatibility entry lets requests created before migration finish with the policy version and provenance they recorded. The existing `blink3-prepare` job and private bucket are retained; the source release did not replace or delete any stored sequence objects.

The merged source retains the owner's 10 arcmin real-data maximum and now samples one image from each available UTC month, using processing version `blink3-cloud-3`. It keeps up to the newest 12 months per detector, tries archive candidates chronologically until one verifies and covers the field, and records months that remain unavailable. This source change requires the separate owner policy v4 migration below and has not been deployed. Production remains on processing version 1 and policy v2. The deployed API includes the bounded `/api/catalogue` route for 2MASS, AllWISE, and Gaia DR3. A small live Gaia DR3 request exceeded the 35-second verification window; it was not repeated, so a successful live catalogue response remains unverified.

The original Barnard's Star request `fr-9fe8d9f503e9ccca9f2964e5a9bba0ad` remains complete: 70 usable frames across six dynamic sequences, with no API rebuild. At the latest live status check, the durable global counter showed 11 of 20 detector-job slots active. Request `fr-037f143a2bc1dae77b60c2007d7e8905` (RA 269.44627, Dec 4.7682, FOV 6) is ready on all six detectors. Request `fr-911e7d9b64036cac0edb4fffb712dc01` (RA 133.75976, Dec -7.24219, FOV 10) is ready on all six detectors. Request `fr-dcb1a9266fcb9255fff34168065966b8` (same coordinates, FOV 5) has five detectors ready and D5 failed after repeated attempts. IRSA returned HTTP 422 during recovery; no further retry was started after the last check. This remaining detector failure is still being investigated and does not indicate a rollback of the concurrency setting. New products remain in private GCS with only registered display/data/mask assets exposed by the API.

Twenty 2-vCPU/4-GiB preparations can request up to 40 vCPU and 80 GiB concurrently; regional quota may delay or reject launches. A global concurrency cap is not a hard spending cap. The $25 budget alert only notifies.
### Orchestrator capacity incident, 15 Nov

Slow synchronous IRSA and Google token-validation calls were running directly inside async request handlers, blocking the event loop. The task routes now offload synchronous network/database work to a worker thread. Discovery and planning make one bounded archive attempt per task delivery so Cloud Tasks provides durable backoff; the preparation downloader keeps its eight-attempt retry/resume behavior. The Cloud Scheduler reconciliation job was refreshed and verified HTTP 200. The event-loop issue was mitigated, then the global ceiling was raised and verified at 18 of 20 active slots. Current request-level recovery status and the remaining detector failure are recorded in the production state above and the latest `docs/CODEX_PROGRESS.md` entry.

### IRSA metadata retry incident, 15 Nov

A read-only check found seven durable field requests (42 detector records) waiting in metadata discovery. The global job semaphore had one active slot, so detector-download concurrency was not blocking these requests. Cloud Tasks showed HTTP 500 deliveries; the orchestrator logs identified IRSA's SIA endpoint returning HTTP 502 through a proxy. Before the fix, that transient exception released the request lock but did not write a retry reason into Firestore, so the frontend continued to show a generic metadata phase while Cloud Tasks retried. The source now records the metadata attempt and error, displays the retry state, maps transient 408/429/500/502/503/504 and network failures to HTTP 503, and forwards a bounded `Retry-After` to Cloud Tasks. After 100 failed metadata attempts, it marks unfinished detectors failed; an explicit retry starts a new attempt. Permanent HTTP errors or malformed VOTable responses also fail unprepared detectors with an explanation. The diagnosis did not start, retry, or cancel any preparation jobs and did not download FITS files. Recheck the affected requests after release; no individual request is manually retried by deployment.

At the initial metadata-retry release snapshot, a read-only Firestore check showed 47 field requests total, 13 in `discovering`, and 9 with `metadataRetrying=true`; four more were between attempts. The underlying IRSA 502 condition was still present in that snapshot, so recovery was not yet confirmed. The follow-up retry-hardening build `7cd46410-dcdb-46d2-8449-c5ce12c3c57e` produced image `metadata-retry-cap-v1-20261115`; it updated only API revision `blink3-api-00025-d96` and orchestrator revision `blink3-orchestrator-00026-nfv`. API health returned HTTP 200 with six sequences, and prepared request `fr-037f143a2bc1dae77b60c2007d7e8905` still returned all six detectors ready. The `blink3-prepare` job, environment, policy, IAM, queue, and stored data were unchanged; no request or job was started.

## Architecture

- **GitHub Pages frontend:** submits coordinates, FOV (1–10 arcmin for real data), optional UTC date bounds and the fixed D1–D6 detector set. Source-only processing version 3 selects one image per available UTC month, tries candidates in chronological order after failures, and caps each detector at 12 months. Date bounds can target historical periods. Production remains on processing version 1 pending the separately approved policy v4 migration. It polls real Firestore progress every few seconds and loads detector frames as soon as each is ready. No GCP credentials are present in the browser. Synthetic mode remains available up to 30 arcmin.
- **Public Cloud Run `blink3-api`:** serves existing static and Firestore-registered immutable image products, creates/reuses request documents, enqueues Cloud Tasks and reports request status. It has no permission to execute Cloud Run Jobs.
- **Private Cloud Run `blink3-orchestrator`:** accepts only OIDC-authenticated Cloud Tasks/Cloud Scheduler calls. It queries IRSA metadata, writes private detector plans, enforces a transactional global semaphore capped at 20 detector jobs, launches the existing `blink3-prepare` job, and reconciles stalled executions. Cloud Tasks dispatch concurrency is a separate setting.
- **Cloud Run Job `blink3-prepare`:** runs the existing FITS validation and scientific processing unchanged. It retries transient archive failures up to eight attempts, resumes verified private staging files, writes a versioned manifest last, validates it against the current owner policy, then registers it in Firestore.
- **Firestore:** `blink3-state` stores stable field requests, per-detector progress, coordination and dynamic manifest index. `blink3-policy` stores the centrally managed owner policy. Runtime accounts have write access only to the state database and read-only access to the policy database. **Cloud Tasks:** delivers reliable authenticated work. **GCS:** stays private and holds plans, staging FITS, originals, manifests and products.

There is no sign-in, per-user quota, daily/monthly limit or CAPTCHA. The live source and owner-policy caps are both **20** active detector preparation jobs for testing and presentation. Keep the emergency policy disable switch, DR1-only allowlist, FOV/frame/file bounds and private bucket. The existing $25 budget alert notifies; it is not a hard spend cap.

## Owner policy and data selection

`config/acquisition-policy` is versioned and written by `deploy/configure_policy.py`. It starts disabled. Source policy v4 targets processing version `blink3-cloud-3`, preserves D1–D6 and the official SPHEREx DR1 acknowledgement/DOI, selects one observation per available month up to the newest 12 months per detector, and retains optional date bounds, archive-ordered candidate fallback, 32 MiB per FITS file, 128 MiB per detector and at most 20 concurrent detector jobs. Candidate plans are bounded to 24 total entries per detector. The website cannot set policy or approval fields. Other collections are rejected. Live policy v2 remains enabled for 20 jobs and accepts in-flight requests created under v1. Applying the source v4 policy requires a separately approved migration; this implementation does not apply it.

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

The v1-to-v2 migration was applied on 15 Nov after the compatible Cloud Run image was deployed. The current source policy v4 is the reviewed monthly-sampling migration: it changes the processing version, keeps at most the newest 12 available months by default, supports bounded historical date requests, and accepts policy v1–v3 for in-flight requests. This code change has not been deployed or applied to Firestore. Do not run the command below until a separately approved release deploys the matching API, orchestrator and preparation job, and the owner explicitly approves the policy migration:

```bash
python3 deploy/configure_policy.py --project spherex-blink --apply --enable --migrate-policy-version
```

This command changes Firestore policy only; it does not deploy Cloud Run. The current live policy is v2 and already allows v1 requests in progress. The source policy v4 starts disabled unless `--enable` is passed. The release script sets `BLINK_MAX_ACTIVE_DOWNLOAD_JOBS=20`; the effective global limit is the lower of this value and Firestore's `maxConcurrentDownloads`.

Production deployment, IAM setup, policy activation, Cloud Run job executions and new FITS downloads were performed with the owner's explicit approval on 15 Nov 2026. The complete first-request result and tests are in the latest `docs/CODEX_PROGRESS.md` entry.

## API contract

- `POST /api/field-requests` validates and normalizes RA/Dec/FOV (1–10 arcmin), dates, D1–D6, and DR1; creates or reuses a stable Firestore request; returns `requestId`, `status`, `cached`, `statusUrl`, and available detector states. Requests above 10 arcmin receive HTTP 422. This is the explicit acquisition trigger.
- `GET /api/field-requests/{requestId}` returns durable overall and per-detector progress, file counts, bytes, frame counts, errors, serving readiness, and metadata retry attempt/error fields. It never initiates work.
- `POST /api/field-requests/{requestId}/retry` retries only failed detectors; it reuses their server-generated plans when possible.
- `GET /api/catalogue?cat=&ra=&dec=&radius=&minpm=` is deployed for bounded 2MASS, AllWISE, and Gaia DR3 cone searches, matching the local backend's response. The route is live; a successful Gaia upstream response still needs confirmation because the first bounded live probe exceeded its client timeout.
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

The first production request exercised: POST request; six detector plans; Firestore progress; dynamically published manifests; partial results through `request_id`; and latest-data selection. The 15 Nov concurrency release was then verified live at policy cap 20; the global counter reached 18 active jobs during recovery, demonstrating that the former three-job limit is no longer active. The initial dispatch uncovered and fixed three integration defects (Cloud Tasks deadline field nesting, request re-enqueue after task-create failure, and reading the owner policy from the wrong Firestore database). The published GitHub Pages Workspace was tested with the request URL and detector switching. Forced failure recovery, live refresh after a mid-download interruption, and live photometry/export remain untested. Do not repeat live archive downloads to run unit tests.

## Rollback and cleanup

Set the Firestore policy `enabled` to false to stop new acquisitions. Keep the API’s current pixel serving state, immutable approved manifests and existing D1–D6 objects. Roll back Cloud Run revisions if new request/status routes fail; the old static cutout contract remains. Do not delete the bucket or sequence products. `deploy/staging-lifecycle.json` describes a seven-day expiry only for `blink3/staging/`; review and merge it with the bucket’s existing lifecycle rules before applying. Orphan sequence assets are not covered by that rule and must only be cleaned after proving no published manifest references them.

## Known operational limits

- Live Cloud Tasks, Firestore request state, the field-catalog index, Cloud Run v2 execution overrides, OIDC invocation, dynamic registration and the 20-job cap have been exercised in production. A live snapshot reached 18 active detector slots. Forced failure/recovery and a complete browser refresh on the live field remain untested.
- Archive metadata size and processing workloads are bounded, but GCP billing alerts do not enforce a spending stop. No daily or monthly application cap is configured, per the owner's decision.
- Browser ad blockers or DNS filters may block the API; the UI should show the request error and never replace failed real data with synthetic frames.
- No real data is committed to Git. New dynamically produced data is stored only in the private bucket and Firestore catalog.
