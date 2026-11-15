# Real-data search coverage implementation plan

**Goal:** Let real-data searches use wide fields and observations distributed across available survey passes, so Find movers and the distant-body search can run when the archive contains enough epochs.

**Architecture:** Raise the real-data FOV ceiling to 30 arcmin consistently in the frontend and local/cloud APIs. Keep the per-detector cap at 12 images, but select archive products across available 30-day survey-pass groups before filling remaining slots; report the actual pass count so the existing UI gate remains scientifically honest.

**Tech Stack:** Vanilla JavaScript frontend, FastAPI, Python archive planner, documentation.

**Spec:** User approved preparing real data fields through 30′ and selecting observations across at least three available passes; do not initiate FITS downloads or deploy/push in this work.

## Global Constraints

- Real observations remain labelled as real and are never replaced silently by synthetic data.
- Keep a maximum of 12 selected observations per detector and existing 32 MiB/file and 128 MiB/detector preparation caps.
- Keep the existing three-pass requirement in the science algorithms; do not lower thresholds.
- Do not initiate new IRSA FITS downloads or deploy Cloud Run.

## Files and responsibilities

- `frontend/js/features/fieldLimits.js`, `frontend/js/main.js`: expose the 30′ range for real data.
- `backend/app.py`, `backend/cloud_app.py`, `backend/spherex/field_requests.py`: accept the same 1–30′ limit locally and in cloud mode.
- `backend/spherex/archive_plan.py`: choose observations from separate available passes, then fill the remaining selection slots to the 12-frame cap.
- `docs/BACKEND_CONTRACT.md`, `docs/CLOUD_DEPLOYMENT.md`, `docs/FEATURE_STATUS.md`, `docs/CODEX_PROGRESS.md`: document the new field bound, pass-spread selection, operational gates, and verification limits.

## Review focus

- Fewer than three available passes: report the true count and keep searches disabled.
- More passes than selection slots: select passes across the time span and retain the newest endpoint.
- FOV above 30′ or below 1′: continue rejecting it at both request and cutout APIs.
- Wide-field image dimensions: preserve the existing 1024-pixel processing limit and per-file/per-detector caps.
- Stable request identity: preserve exact query/date/collection reuse semantics.

## Tasks

1. Implement pass-aware selection in `archive_plan.make_plan` for both latest and date-range requests, preserving date filters and a 12-file maximum.
2. Raise all real-data FOV validators to 30′ in local and cloud APIs and the frontend.
3. Version the changed selection as `blink3-cloud-2` so old cached products cannot be treated as new results; prepare (but do not apply) the matching owner policy revision.
4. Update the API and status documentation, then inspect the final diff for consistent limits and selection wording.

Automated tests and live-browser checks were not authorized in this work scope and are therefore not planned here.
