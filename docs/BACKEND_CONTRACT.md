# Backend contract and architecture — Blink 3.0

Owner-approved direction, 14 November 2026; production rollout active 15 November 2026. Read with AGENTS.md. Future agents must preserve these boundaries; a breaking change requires the owner's explicit approval and a migration plan.

## Boundaries

1. **Frontend:** the existing six-page static app on GitHub Pages. Synthetic mode works independently. Existing analysis workers, playback, coordinates, overlays, exports and measurements remain in place.
2. **Local API:** `backend/app.py` reads a local FITS archive and retains its existing behavior. No cloud account or Google library is required.
3. **Public Cloud API:** `backend/cloud_app.py` serves static approved and Firestore-registered immutable sequences; bounded interactive photometry reuses the local algorithm on privately stored, checksummed inputs (24 files / 128 MiB maximum, one measurement at a time). It creates durable requests and enqueues Cloud Tasks, but cannot execute Cloud Run Jobs. Anonymous access is intentional while GitHub Pages remains public; there is no sign-in or per-user/daily/monthly quota.
4. **Private orchestrator and preparation job:** `backend/orchestration_app.py` accepts only authenticated Cloud Tasks OIDC requests, discovers IRSA metadata, plans each detector, and launches the existing `blink3-prepare` job. Firestore tracks each detector, request, cache pointer and global semaphore. Source permits at most **20** active detector preparation jobs; the effective limit is the lower of the orchestrator environment cap and the centrally stored owner-policy cap. The job downloads within the enabled owner policy, calls the unchanged 3.0 builder, validates the generated manifest, and registers it dynamically. The API is not rebuilt for new fields.
5. **Storage:** local directories and native Google Cloud Storage share the same object interface. Use attached identities/ADC; never commit credentials. The bucket is private. Only registered display/data/mask assets have public API routes; original FITS objects do not.
6. **Live policy:** enabled policy `spherex-dr1-owner-v2` is in Firestore database `blink3-policy` and permits up to 20 concurrent detector jobs. It preserves SPHEREx DR1 only, D1–D6, newest 12 observations by default, optional date bounds, 32 MiB per file, 128 MiB per detector, the official acknowledgement and DOI `10.26131/IRSA678`. The source policy v3 targets `blink3-cloud-2` and selects up to 12 observations across available survey passes. The v3 policy template remains disabled by default and lists v1 and v2 as compatible so in-flight requests can finish. Applying it requires an owner-approved policy migration; the owner may disable or lower policy centrally, and the browser cannot alter it.

Real SPHEREx cutout requests support fields from 1 to 30 arcmin in the frontend and both local/cloud cutout APIs. Synthetic demonstration fields remain supported through 30 arcmin. The asynchronous real-data request validator enforces the same bound. Wide fields remain subject to the existing 1024-pixel processing-grid limit and download caps.

Science code is reused in this repository, not rewritten or imported from 4.0. `products.build` is the builder extracted from `app._build`; the latter remains an alias. Golden comparisons must prove byte-identical display images, float data and masks. Photometry must match `photometry.measure` on identical inputs.

## Compatibility

`GET /api/cutouts?ra=&dec=&fov=&det=` still returns `{frames: [...]}`. Required fields remain `mjd`, `dateISO`, `detector`, wavelength bounds in micrometres, `imageUrl`, `flags`; existing optional data/mask URLs, pixel scale, unit and **string** provenance keep their types. Cloud frames add `sequenceId` and `dataKind`. Do not replace string provenance with 4.0's object type.

The cloud cutout route requires an exact prepared centre and field size (absolute tolerance 1e-7 degrees/arcminutes); `det=all` or the prepared detector is accepted. `request_id` scopes frames to one asynchronous field request and allows partial detectors to appear immediately. Without it, legacy approved and newest matching dynamic detector data are combined. Other queries return 422, never unrelated pixels. Local cutouts retain arbitrary supported centres and enforce the same 30 arcmin real-data FOV limit.

`GET /api/photometry` retains the existing response, aperture radius, optional epoch and proper-motion parameters and uncertainty model. Only positions within an approved field are eligible in the cloud. No new calibrated-accuracy claim is made. The serving image needs Astropy/NumPy because this feature is retained. Detection stays in the browser; the preparation job does not need Node.

Pixel data remain little-endian float32, with the existing background subtraction, orientation and NaN conventions; masks and PNGs use the existing functions. Never measure flux from display PNGs. No silent fallback between observed and synthetic data.

## Additive prepared-sequence API and release format

- `GET /api/health`: safe status/profile/source/count, no local paths or credentials. It checks approved manifests; it is not proof every asset exists.
- `GET /api/sequences`: approved IDs, exact query, data kind, collection, immutable revision and acknowledgement.
- `GET /api/sequences/{id}`: those metadata plus existing 3.0 frames and processing version.
- `GET /api/sequences/{id}/assets/{revision}/{name}`: only checksummed registered assets; the immutable revision prevents stale browser cache reuse after a release.
- `GET /api/catalogue?cat=&ra=&dec=&radius=&minpm=` is available in both local and cloud APIs. The cloud route reuses the bounded server-side TAP relay for 2MASS, AllWISE, and Gaia DR3 and preserves the local response shape; SIMBAD remains queried by the browser. Other unsupported local-only archive, survey, footprint, and HiPS routes explicitly return 501. Unknown routes return 404. The cloud service is not a replacement for every local research tool.

Stored manifest version **1**: `sequenceId`, `revision`, `dataKind`, `query {ra,dec,fov,det}`, collection, frames, assets `{name:{key,sizeBytes,sha256}}`, private originals `{key,sizeBytes,sha256,obsId,sourceUrl,mjd}`, processing version/time, request ID, policy version, selection, terms flag, official acknowledgement and `dataDoi`. Layout: `sequences/<id>/<revision>/{assets,private}/...`, with `manifest.json` written last. Existing approval-file entries continue to pin static manifests. Dynamic manifests are added to Firestore only after integrity, provenance, detector, collection, policy, byte/frame-count and acknowledgement/DOI validation. No arbitrary bucket listing or per-sequence API rebuild is needed.

The centrally stored `config/acquisition-policy` in Firestore database `blink3-policy` is owner-controlled and versioned. Live policy v2 remains enabled. Source policy v3 authorizes only SPHEREx DR1, D1–D6, the official acknowledgement, up to 12 observations distributed across available passes, optional UTC date bounds, 32 MiB per FITS and 128 MiB per detector. It lists policy v1 and v2 as compatible for in-flight requests. Applying v3 requires a separately approved migration. `enabled=false` is the safe default. Disabling it is the emergency stop for new requests; previously completed exact requests and existing data serving remain available. The frontend cannot set approval flags, the application exposes no policy mutation endpoint, and runtime identities have only read access to the separate policy database. State collections are kept in `blink3-state`. A new collection is rejected until the owner updates the policy after review. Dynamic data serving still requires the existing pixel-serving gate; the initial production rollout must preserve current Barnard serving behavior.

Cloud runtime settings do not impose per-user or daily/monthly quotas. The 20-job maximum global Firestore semaphore, policy switch, archive host/HTTPS checks, detector/FOV/file/frame bounds, task authentication and private bucket remain required.

## Regression obligations

Run the repository tests, benchmark digests and relevant browser checks. Cloud tests must cover checksums, input caps, denied access, incomplete publication, revision changes, scientific parity, exact-query matching, HTTPS URLs, CORS and visible failures. Test fake/local stores without credentials; separately record any actual cloud/archive checks. See `docs/CLOUD_DEPLOYMENT.md` and the latest `docs/CODEX_PROGRESS.md` entry for current production verification and remaining gates.
