# SPHEREx Blink Cloud Deployment

This document describes the on-demand acquisition deployment. The owner explicitly approved production provisioning, IAM, policy enablement, and rollout on 15 Nov 2026. Future deployments, IAM changes, or policy expansions still require fresh owner approval.

## Current production state

Project `spherex-blink`, region `europe-west1`, private bucket `spherex-blink-blink3-products`, public read API `blink3-api`, and preparation job `blink3-prepare` already exist. Preserve existing GCS objects and the API serving configuration during future setup.

Canonical public service URL: `https://blink3-api-w3bm7ii4fq-ew.a.run.app`. API revision `blink3-api-00027-jxt` and orchestrator revision `blink3-orchestrator-00031-4s4` serve image tag `monthly-sampling-v4-20261115`; the `blink3-prepare` job uses `europe-west1-docker.pkg.dev/spherex-blink/blink3/job:monthly-sampling-v4-20261115`. Both Cloud Run services and the live policy retain the 20-job ceiling; the API still has `BLINK_SERVE_PIXELS=true`. Real-data FOV remains 1–10 arcmin, while synthetic demo fields remain separate.

Firestore database `blink3-policy` has enabled policy `spherex-dr1-owner-v4`, with processing version `blink3-cloud-3`, `maxConcurrentDownloads=20`, and compatibility for owner policy versions v1–v3. It retains the DR1 allowlist, official acknowledgement and DOI, 12-observation monthly cap, 32 MiB per-file cap, and 128 MiB per-detector cap. Older requests continue with the policy version and provenance recorded when they were created. The existing preparation job and private bucket were retained; the release did not replace or delete stored sequence objects.

Monthly processing is deployed and enabled. It selects one observation per available UTC month, up to the newest 12 months per detector, tries archive candidates chronologically until one verifies and covers the field, and records months that remain unavailable. Optional date bounds allow historical requests. The API also includes the bounded `/api/catalogue` route for 2MASS, AllWISE, and Gaia DR3. A small live Gaia DR3 request exceeded the 35-second verification window; it was not repeated, so a successful live catalogue response remains unverified.

### Monthly refresh of prepared legacy fields, 15 Nov

The owner-approved release and v4 policy migration were applied before creating monthly requests. The inventory contained 65 legacy request records; 51 unique exact fields had at least one ready detector and no active old-format work. Fifty monthly requests were submitted by this operation, in descending FOV order from 10′ to 1′. At the live check shortly after submission, all 51 eligible legacy fields had a corresponding monthly request; the API also showed one additional concurrent 10′ monthly request outside that legacy-field inventory, for 52 monthly requests total. Existing sequences and GCS objects were left intact.

At that snapshot, the 51 replacement requests were split between 11 discovering and 40 queued. Of the 66 detector records in discovery, 54 were retrying metadata after both IRSA SIA and TAP returned HTTP 502 proxy errors; the remaining 12 were on their first metadata attempt. No preparation execution was active, so those requests had not yet started FITS downloads. Cloud Tasks retains the discovery retries; do not create replacement requests for these same normalized fields. The first high-priority request is `fr-34774e9ba0cdca2437f6a04a6870986f` (RA 76.95659°, Dec +30.40129°, FOV 10′). Check status through `/api/field-requests/{requestId}` and wait for IRSA recovery before treating the metadata phase as a download.

The original Barnard's Star request `fr-9fe8d9f503e9ccca9f2964e5a9bba0ad` remains complete: 70 usable frames across six dynamic sequences, with no API rebuild. At the latest live status check, the durable global counter showed 11 of 20 detector-job slots active. Request `fr-037f143a2bc1dae77b60c2007d7e8905` (RA 269.44627, Dec 4.7682, FOV 6) is ready on all six detectors. Request `fr-911e7d9b64036cac0edb4fffb712dc01` (RA 133.75976, Dec -7.24219, FOV 10) is ready on all six detectors. Request `fr-dcb1a9266fcb9255fff34168065966b8` (same coordinates, FOV 5) has five detectors ready and D5 failed after repeated attempts. IRSA returned HTTP 422 during recovery; no further retry was started after the last check. This remaining detector failure is still being investigated and does not indicate a rollback of the concurrency setting. New products remain in private GCS with only registered display/data/mask assets exposed by the API.

Twenty 2-vCPU/4-GiB preparations can request up to 40 vCPU and 80 GiB concurrently; regional quota may delay or reject launches. A global concurrency cap is not a hard spending cap. The $25 budget alert only notifies.
### Orchestrator capacity incident, 15 Nov

Slow synchronous IRSA and Google token-validation calls were running directly inside async request handlers, blocking the event loop. The task routes now offload synchronous network/database work to a worker thread. Discovery and planning make one bounded archive attempt per task delivery so Cloud Tasks provides durable backoff; the preparation downloader keeps its eight-attempt retry/resume behavior. The Cloud Scheduler reconciliation job was refreshed and verified HTTP 200. The event-loop issue was mitigated, then the global ceiling was raised and verified at 18 of 20 active slots. Current request-level recovery status and the remaining detector failure are recorded in the production state above and the latest `docs/CODEX_PROGRESS.md` entry.

### IRSA metadata retry incident, 15 Nov

A read-only check found seven durable field requests (42 detector records) waiting in metadata discovery. The global job semaphore had one active slot, so detector-download concurrency was not blocking these requests. Cloud Tasks showed HTTP 500 deliveries; the orchestrator logs identified IRSA's SIA endpoint returning HTTP 502 through a proxy. Before the fix, that transient exception released the request lock but did not write a retry reason into Firestore, so the frontend continued to show a generic metadata phase while Cloud Tasks retried. The source now records the metadata attempt and error, displays the retry state, maps transient 408/429/500/502/503/504 and network failures to HTTP 503, and forwards a bounded `Retry-After` to Cloud Tasks. After 100 failed metadata attempts, it marks unfinished detectors failed; an explicit retry starts a new attempt. Permanent HTTP errors or malformed VOTable responses also fail unprepared detectors with an explanation. The diagnosis did not start, retry, or cancel any preparation jobs and did not download FITS files. Recheck the affected requests after release; no individual request is manually retried by deployment.

At the initial metadata-retry release snapshot, a read-only Firestore check showed 47 field requests total, 13 in `discovering`, and 9 with `metadataRetrying=true`; four more were between attempts. The underlying IRSA 502 condition was still present in that snapshot, so recovery was not yet confirmed. The follow-up retry-hardening build `7cd46410-dcdb-46d2-8449-c5ce12c3c57e` produced image `metadata-retry-cap-v1-20261115`; it updated only API revision `blink3-api-00025-d96` and orchestrator revision `blink3-orchestrator-00026-nfv`. API health returned HTTP 200 with six sequences, and prepared request `fr-037f143a2bc1dae77b60c2007d7e8905` still returned all six detectors ready. The `blink3-prepare` job, environment, policy, IAM, queue, and stored data were unchanged; no request or job was started.

### TAP fallback rollout and recovery

The source implementation keeps SIA as the primary metadata provider and calls IRSA TAP only after transient SIA failures (502/503/504 or timeout/network failure). It does not use TAP for a successful empty SIA result or a permanent SIA error. TAP plane/artifact rows are normalized to the archive candidates consumed by monthly planning and pass the same URL, collection, detector, date, byte, and manifest checks. If the first TAP query succeeds but returns no candidates, the current Cloud Tasks delivery is retried once through the queue's normal backoff; that full delivery tries SIA again and falls back to TAP only if SIA is still transient. A second empty TAP result means no matching coverage. If both providers fail, discovery remains retryable and status records an explicit metadata-search-unavailable error with both provider failures.

The TAP fallback was deployed to the private orchestrator only on 15 Nov 2026. Revision `blink3-orchestrator-00027-r8x` exposed that Firestore stores detector statuses as a map; revision `blink3-orchestrator-00028-jbr` fixed the adapter to accept that persisted shape. Both revisions used dedicated image tags `tap-fallback-v1-20261115` and `tap-fallback-v2-20261115`. The public API remained `blink3-api-00025-d96`; the preparation job, owner policy, serving gate, and stored products were not changed.

Pending Cloud Tasks retried against the stable orchestrator URL after deployment. Some requests advanced through SIA; requests that reached TAP continued to receive HTTP 502 from IRSA's upstream proxy. A direct metadata-only TAP query from the development environment also returned HTTP 502, so the archive fallback could not be verified successful in production. As of 12:08 UTC, 20 requests still had no metadata key. The unresolved request IDs were `fr-1373338420dfbb179ffd88c675416e51`, `fr-15bc42f40861d5e50ec6d1128d64966b`, `fr-187c84573a1c6639a325213403561348`, `fr-1ad5be6773212d0597760cb634d829a6`, `fr-2189ec09a953067d56ad7ca6e575fa51`, `fr-29afa9a14eda8f113570bba473d78198`, `fr-36d01ae7dc89f1e3151acca9be5edba8`, `fr-4ea43678603c90d97d94a92f6fef66f0`, `fr-57356a4974b1edf3e18f9e7b9aa76bde`, `fr-5cdf265ec46d97811a56543129b5ec46`, `fr-66e77c9157a86099ab93336382b1a2e4`, `fr-6ed8ecfc875073c4421c37d113d6c0a4`, `fr-8b690ca922c0eb5cf00eda474cb93315`, `fr-9511463281819a4ab240154c0346eb3c`, `fr-9551056c3b4b6e7333573d8ac16e669d`, `fr-a98d3d76190812a37f42e20cf86d57be`, `fr-acdf527e12ea0d8c7c86f133b694619b`, `fr-b6e7cc268874b3c1421554b33dbd22c1`, `fr-c08c40e9ec4983b56e451434d7a7e088`, and `fr-fef5c8ed2bad68232c76a7f85a1cf3c2`. Nine had persisted both SIA HTTP 502 and TAP HTTP 502; several others still showed earlier detector-shape errors or had not yet stored provider-specific details. Their discovery tasks remained present in the queue with scheduled retry times. No stale request was re-enqueued while its task remained active.

At 12:08 UTC, the production queue policy had only `roles/cloudtasks.enqueuer`; no task-read permission was present then. After the owner explicitly approved the exact recovery binding on 15 Nov, project custom role `blink3TaskInspector` (only `cloudtasks.tasks.get`) was created and bound to `blink3-orchestrator` on `blink3-acquisition`. It does not grant task reads on other queues. The first reconciliation run after the permission update reached stale request planning and exposed a separate compatibility bug for a pre-monthly request missing `samplingMode`; see the follow-up progress entry below. Do not change the owner policy, monthly processing version, preparation job, or data as part of this TAP fallback rollout.

### Recovery follow-up: live processing resumed

After the owner-approved queue permission was applied, the two-minute reconciliation endpoint returned HTTP 200. A legacy field request without `samplingMode` had been crashing plan tasks with `KeyError: requestedMonths`; planning now derives the sampling mode from the generated plan and only adds monthly fields to monthly plans. The regression test covers the legacy shape. Private orchestrator revision `blink3-orchestrator-00029-zvd` (image tag `tap-fallback-v3-20261115`) contains this fix and updates only the orchestrator.

Live job executions then downloaded, processed, and published detector sequences. `GET /api/cutouts` returned HTTP 200 for both verified fields: request `fr-c08c40e9ec4983b56e451434d7a7e088` (RA 155.0°, Dec +10.0°, FOV 8′) returned 72 frames, 12 per detector; request `fr-35323ab392cdbe84a8510604a825346f` (RA 179.86861°, Dec +30.87591°, FOV 10′) returned 65 frames (D1 11, D2 10, D3 11, D4 10, D5 11, D6 12). Both requests reached `ready` across D1–D6. The API service and preparation job were not redeployed for this fix.

Other pending metadata requests continue to retry, but live SIA and TAP calls still return IRSA HTTP 502 proxy errors. The fallback now reports that provider failure and Cloud Tasks keeps retrying; it cannot produce new plans until IRSA responds successfully. A successful TAP response has still not been observed. Job logs also contain Astropy's existing warning about SIP coefficients with CTYPE lacking the `-SIP` suffix; this recovery did not change the image/WCS science path.

At 13:01 UTC, a status check of the 20 requests previously missing metadata found four fully ready (`fr-187c84573a1c6639a325213403561348`, `fr-2189ec09a953067d56ad7ca6e575fa51`, `fr-66e77c9157a86099ab93336382b1a2e4`, and `fr-c08c40e9ec4983b56e451434d7a7e088`), two partial (`fr-15bc42f40861d5e50ec6d1128d64966b` with 3/6 detectors ready and `fr-36d01ae7dc89f1e3151acca9be5edba8` with 2/6), and 14 still in metadata retry with 0/6 ready. The remaining discovery failures report SIA and TAP HTTP 502 from IRSA. Request `fr-35323ab392cdbe84a8510604a825346f`, outside that original set, also completed D1–D6 and passed the same 65-frame cutouts API check noted above. Requests already underway continue to advance automatically; the API was not manually republished for each field.

## Architecture

- **GitHub Pages frontend:** submits coordinates, FOV (1–10 arcmin for real data), optional UTC date bounds and the fixed D1–D6 detector set. Live processing version 3 selects one image per available UTC month, tries candidates in chronological order after failures, and caps each detector at the newest 12 months by default. Date bounds can target historical periods. It polls real Firestore progress every few seconds and loads detector frames as soon as each is ready. No GCP credentials are present in the browser. Synthetic mode remains available up to 30 arcmin.
- **Public Cloud Run `blink3-api`:** serves existing static and Firestore-registered immutable image products, creates/reuses request documents, enqueues Cloud Tasks and reports request status. It has no permission to execute Cloud Run Jobs.
- **Private Cloud Run `blink3-orchestrator`:** accepts only OIDC-authenticated Cloud Tasks/Cloud Scheduler calls. It queries IRSA metadata, writes private detector plans, enforces a transactional global semaphore capped at 20 detector jobs, launches the existing `blink3-prepare` job, and reconciles stalled executions. Cloud Tasks dispatch concurrency is a separate setting.
- **Cloud Run Job `blink3-prepare`:** runs the existing FITS validation and scientific processing unchanged. It retries transient archive failures up to eight attempts, resumes verified private staging files, writes a versioned manifest last, validates it against the current owner policy, then registers it in Firestore.
- **Firestore:** `blink3-state` stores stable field requests, per-detector progress, coordination and dynamic manifest index. `blink3-policy` stores the centrally managed owner policy. Runtime accounts have write access only to the state database and read-only access to the policy database. **Cloud Tasks:** delivers reliable authenticated work. **GCS:** stays private and holds plans, staging FITS, originals, manifests and products.

There is no sign-in, per-user quota, daily/monthly limit or CAPTCHA. The live source and owner-policy caps are both **20** active detector preparation jobs for testing and presentation. Keep the emergency policy disable switch, DR1-only allowlist, FOV/frame/file bounds and private bucket. The existing $25 budget alert notifies; it is not a hard spend cap.

## Owner policy and data selection

`config/acquisition-policy` is versioned and written by `deploy/configure_policy.py`. The live owner-approved v4 policy is enabled and targets processing version `blink3-cloud-3`. It preserves D1–D6 and the official SPHEREx DR1 acknowledgement/DOI, selects one observation per available month up to the newest 12 months per detector, and retains optional date bounds, archive-ordered candidate fallback, 32 MiB per FITS file, 128 MiB per detector and at most 20 concurrent detector jobs. Candidate plans are bounded to 24 total entries per detector. The website cannot set policy or approval fields. Other collections are rejected. Policy v4 accepts policy v1–v3 for in-flight requests.

The emergency stop is `enabled=false` on the Firestore policy. It prevents new requests; previously completed exact requests and existing serving remain available. The application exposes no policy-mutation endpoint, and browser input cannot set approval fields. The separate `blink3-policy` database and database-scoped read-only runtime grants prevent those services from changing the owner policy. Configure access through the documented policy script using an administrator identity. Manifests record the policy version and acknowledgement that authorized them.

## One-time setup (completed 15 Nov 2026)

The commands below were applied with owner approval. Review them and obtain explicit owner approval before changing production resources or IAM again.

```bash
bash deploy/setup.sh --apply
```

The script enables Firestore, Cloud Tasks and Cloud Scheduler APIs; creates separate native `blink3-state` and `blink3-policy` databases and the acquisition queue if missing; creates orchestration and task identities; and applies database-scoped IAM so runtime identities can write state but only read the owner policy. Google documents the per-database conditional binding format in its [Firestore database IAM guide](https://docs.cloud.google.com/firestore/native/docs/manage-databases#configure_per-database_access_permissions). It gives the public API queue enqueue rights and read-only access to the sequence prefix; grants the orchestrator the named-job execution role, plan/metadata read-write access and read-only sequence-manifest access; and grants the job bounded plan/staging/sequence object access. It does not enable the policy or launch a job. Inspect all existing IAM bindings before applying. The orchestrator’s custom job role is bound to `blink3-prepare`, not project-wide, and includes `run.jobs.runWithOverrides` because dispatch overrides the container arguments.

Discovery reconciliation must check the acquisition queue for an already-active named task before enqueueing recovery work. The orchestrator therefore needs `cloudtasks.tasks.get` on only the `blink3-acquisition` queue, in addition to its queue-scoped enqueue permission. Use the minimal `blink3TaskInspector` custom role containing that permission and bind it at the queue resource; do not grant project-wide `roles/cloudtasks.viewer` or broader project permissions. If task lookup fails, reconciliation must fail closed and suppress redispatch because it cannot rule out an active retry task. On 15 Nov 2026, the production queue policy was inspected and had only `roles/cloudtasks.enqueuer`; the task-read permission was absent at that time. The source setup script now creates the minimal project role and binds it only to the orchestrator on `blink3-acquisition`. Apply that binding only after checking the live queue policy, then verify the orchestrator can get a task by its full queue task name before relying on reconciliation.

`deploy/setup.sh` requests the composite field-catalog index described by `deploy/firestore.indexes.json` in `blink3-state`. The dynamic catalog uses equality filters on normalized RA, Dec, FOV, collection, processing version and detector, then selects the newest prepared observation coverage by `latestMjd`. Wait until the index is ready before enabling acquisition. The index command follows the [official gcloud composite-index reference](https://docs.cloud.google.com/sdk/gcloud/reference/firestore/indexes/composite/create).

Deploy without resetting the current `BLINK_SERVE_PIXELS` value:

```bash
bash deploy/release.sh --apply cloud-v3
```

This builds the API and job images, deploys the private orchestrator and public API, binds the task identity as orchestrator invoker, and installs a two-minute reconciliation schedule. It does not execute `blink3-prepare`. The release script uses `--update-env-vars` for the existing API to retain its serving gate. Verify the deployed service URL, image digest, active revisions, D1–D6 static sequence responses, and current serving state before changing the policy.

The minimal queue permission was applied after owner authorization. The dry run remains available with `bash deploy/grant_reconcile_task_read.sh`; it describes the single custom permission and queue binding.

For a TAP-fallback-only release, use `bash deploy/release_orchestrator.sh --apply tap-fallback-v1`. This uses `deploy/cloudbuild-orchestrator.yaml` to build the API image once and updates only the private `blink3-orchestrator` service. It leaves the public API, `blink3-prepare`, serving gate, owner policy, and stored products unchanged. After deployment, pending tasks continue to target the stable orchestrator service URL. Run the existing authenticated reconciliation schedule after verifying the new revision is ready; it checks each stale request's named task and work lock before recovering it. Do not apply the monthly-sampling policy migration as part of this TAP fallback release.

Configure the DR1 policy in disabled mode first:

```bash
python3 deploy/configure_policy.py --project spherex-blink --apply
```

Once deployment, IAM, index readiness, static-data serving and no-download smoke checks are reviewed, the owner can enable ordinary user requests:

```bash
python3 deploy/configure_policy.py --project spherex-blink --apply --enable
```

The v1-to-v2 migration was applied earlier on 15 Nov. The owner-approved v4 monthly-sampling migration was applied after deploying the matching API, orchestrator and preparation job image `monthly-sampling-v4-20261115`. Live policy v4 remains enabled and accepts policy v1–v3 for in-flight requests. It preserves the current DR1 terms, 12-observation cap, file/byte limits, and 20-job ceiling. No per-request policy change or redeployment is needed for subsequent field requests.

```bash
python3 deploy/configure_policy.py --project spherex-blink --apply --enable --migrate-policy-version
```

The command above records the migration that was applied; it changes Firestore policy only and does not deploy Cloud Run. Do not rerun it for ordinary requests. The release script sets `BLINK_MAX_ACTIVE_DOWNLOAD_JOBS=20`; the effective global limit is the lower of this value and Firestore's `maxConcurrentDownloads`.

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
