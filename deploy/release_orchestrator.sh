#!/usr/bin/env bash
# Builds and updates only blink3-orchestrator. It leaves blink3-api,
# blink3-prepare, acquisition policy, IAM and stored products untouched.
set -euo pipefail
if [[ "${1:-}" != "--apply" || -z "${2:-}" ]]; then
  echo 'Usage (after explicit deployment approval): bash deploy/release_orchestrator.sh --apply RELEASE_TAG'
  exit 0
fi
tag="$2"
[[ "$tag" =~ ^[a-z0-9][a-z0-9.-]{0,60}$ ]] || { echo 'Invalid release tag'; exit 1; }
project=spherex-blink
region=europe-west1
images="$region-docker.pkg.dev/$project/blink3"

gcloud builds submit . --project="$project" --region="$region" \
  --config=deploy/cloudbuild-orchestrator.yaml \
  --service-account="projects/$project/serviceAccounts/blink3-build@$project.iam.gserviceaccount.com" \
  --substitutions="_IMAGE_BASE=$images,_TAG=$tag"

gcloud run services update blink3-orchestrator --project="$project" --region="$region" \
  --image="$images/api:$tag"

echo "Updated only the private blink3-orchestrator service in $region with $images/api:$tag"
