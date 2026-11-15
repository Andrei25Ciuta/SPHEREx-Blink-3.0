#!/usr/bin/env bash
# Prepares the one-time orchestration resources. Never run against production without explicit owner approval.
set -euo pipefail
project=spherex-blink
region=europe-west1
queue=blink3-acquisition
bucket=spherex-blink-blink3-products
state_db=blink3-state
policy_db=blink3-policy

if [[ "${1:-}" != "--apply" ]]; then
  cat <<'EOF'
Dry run only. This setup adds Firestore, Cloud Tasks, orchestration/task identities,
and narrowly scoped permissions. It does not touch existing Barnard products, deploy
services, enable the acquisition policy, or launch a preparation job. Review docs/CLOUD_DEPLOYMENT.md.
Run with --apply only after explicit owner approval.
EOF
  exit 0
fi

gcloud config set project "$project" >/dev/null
gcloud services enable run.googleapis.com firestore.googleapis.com cloudtasks.googleapis.com cloudscheduler.googleapis.com \
  storage.googleapis.com --project="$project"

ensure_service_account() {
  local name="$1" display="$2"
  if ! gcloud iam service-accounts describe "$name@$project.iam.gserviceaccount.com" --project="$project" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$name" --display-name="$display" --project="$project"
  fi
}

ensure_service_account blink3-orchestrator 'Blink 3 private acquisition orchestrator'
ensure_service_account blink3-tasks 'Blink 3 Cloud Tasks identity'

ensure_firestore_database() {
  local database="$1"
  if ! gcloud firestore databases describe --database="$database" --project="$project" >/dev/null 2>&1; then
    gcloud firestore databases create --database="$database" --location="$region" --type=firestore-native --project="$project"
  fi
}
ensure_firestore_database "$state_db"
ensure_firestore_database "$policy_db"
if ! gcloud tasks queues describe "$queue" --location="$region" --project="$project" >/dev/null 2>&1; then
  gcloud tasks queues create "$queue" --location="$region" --project="$project" \
    --max-attempts=100 --max-retry-duration=86400s --min-backoff=5s --max-backoff=300s \
    --max-doublings=8 --max-dispatches-per-second=10 --max-concurrent-dispatches=20
fi

# Equality/order index used by fieldCatalog queries in the state database. Do not wait
# for Firestore's long-running build operation; setup can complete while it builds.
if gcloud firestore indexes composite list --project="$project" --database="$state_db" --format=json \
  | python3 -c 'import json,sys; expected={"raKey":"ASCENDING","decKey":"ASCENDING","fovKey":"ASCENDING","collection":"ASCENDING","processingVersion":"ASCENDING","detector":"ASCENDING","latestMjd":"DESCENDING"}; indexes=json.load(sys.stdin); sys.exit(0 if any("/collectionGroups/fieldCatalog/" in i.get("name","") and i.get("state") in ("CREATING","READY") and all({f.get("fieldPath"):f.get("order") for f in i.get("fields",[])}.get(k)==v for k,v in expected.items()) for i in indexes) else 1)'; then
  echo 'Firestore catalog index already exists or is building.'
else
  gcloud firestore indexes composite create --project="$project" --database="$state_db" \
    --collection-group=fieldCatalog \
    --field-config=field-path=raKey,order=ascending \
    --field-config=field-path=decKey,order=ascending \
    --field-config=field-path=fovKey,order=ascending \
    --field-config=field-path=collection,order=ascending \
    --field-config=field-path=processingVersion,order=ascending \
    --field-config=field-path=detector,order=ascending \
    --field-config=field-path=latestMjd,order=descending --async
fi

api_sa="blink3-api@$project.iam.gserviceaccount.com"
orchestrator_sa="blink3-orchestrator@$project.iam.gserviceaccount.com"
job_sa="blink3-job@$project.iam.gserviceaccount.com"
tasks_sa="blink3-tasks@$project.iam.gserviceaccount.com"
grant_database_role() {
  local database="$1" member="$2" role="$3" title="$4" description="$5"
  gcloud projects add-iam-policy-binding "$project" --member="serviceAccount:$member" --role="$role" \
    --condition="expression=resource.name=='projects/$project/databases/$database',title=$title,description=$description"
}
for identity in "$api_sa" "$orchestrator_sa" "$job_sa"; do
  grant_database_role "$state_db" "$identity" roles/datastore.user blink3-state-access 'Runtime request and catalog data access limited to the state database'
  grant_database_role "$policy_db" "$identity" roles/datastore.viewer blink3-policy-read 'Read-only owner policy access limited to the policy database'
done
gcloud tasks queues add-iam-policy-binding "$queue" --location="$region" --project="$project" \
  --member="serviceAccount:$api_sa" --role=roles/cloudtasks.enqueuer
gcloud tasks queues add-iam-policy-binding "$queue" --location="$region" --project="$project" \
  --member="serviceAccount:$orchestrator_sa" --role=roles/cloudtasks.enqueuer
gcloud iam service-accounts add-iam-policy-binding "$tasks_sa" --project="$project" \
  --member="serviceAccount:$api_sa" --role=roles/iam.serviceAccountUser
gcloud iam service-accounts add-iam-policy-binding "$tasks_sa" --project="$project" \
  --member="serviceAccount:$orchestrator_sa" --role=roles/iam.serviceAccountUser
gcloud storage buckets add-iam-policy-binding "gs://$bucket" --member="serviceAccount:$orchestrator_sa" \
  --role=roles/storage.objectUser \
  --condition="expression=resource.name.startsWith('projects/_/buckets/$bucket/objects/blink3/plans/') || resource.name.startsWith('projects/_/buckets/$bucket/objects/blink3/requests/'),title=blink3-orchestrator-work-objects,description=Read and write acquisition plans and archive metadata"
gcloud storage buckets add-iam-policy-binding "gs://$bucket" --member="serviceAccount:$orchestrator_sa" \
  --role=roles/storage.objectViewer \
  --condition="expression=resource.name.startsWith('projects/_/buckets/$bucket/objects/blink3/sequences/'),title=blink3-orchestrator-catalog,description=Read immutable manifests for exact-cache matching"
gcloud storage buckets add-iam-policy-binding "gs://$bucket" --member="serviceAccount:$api_sa" \
  --role=roles/storage.objectViewer \
  --condition="expression=resource.name.startsWith('projects/_/buckets/$bucket/objects/blink3/sequences/'),title=blink3-api-sequences,description=Read only immutable manifests and prepared assets"
gcloud storage buckets add-iam-policy-binding "gs://$bucket" --member="serviceAccount:$job_sa" \
  --role=roles/storage.objectUser \
  --condition="expression=resource.name.startsWith('projects/_/buckets/$bucket/objects/blink3/plans/') || resource.name.startsWith('projects/_/buckets/$bucket/objects/blink3/staging/') || resource.name.startsWith('projects/_/buckets/$bucket/objects/blink3/sequences/'),title=blink3-job-objects,description=Read plans and publish private staged inputs and immutable products"

# This role is bound to the single existing job in deploy/release.sh, not at project scope.
if ! gcloud iam roles describe blink3JobExecutor --project="$project" >/dev/null 2>&1; then
  gcloud iam roles create blink3JobExecutor --project="$project" --title='Blink 3 named-job executor' \
    --description='Run and inspect the existing blink3-prepare job and executions.' \
    --permissions=run.jobs.run,run.jobs.runWithOverrides,run.jobs.get,run.executions.get,run.executions.list --stage=GA
fi
gcloud run jobs add-iam-policy-binding blink3-prepare --project="$project" --region="$region" \
  --member="serviceAccount:$orchestrator_sa" --role="projects/$project/roles/blink3JobExecutor"
gcloud iam service-accounts add-iam-policy-binding "$job_sa" --project="$project" \
  --member="serviceAccount:$orchestrator_sa" --role=roles/iam.serviceAccountUser

project_number=$(gcloud projects describe "$project" --format='value(projectNumber)')
tasks_service_agent="service-$project_number@gcp-sa-cloudtasks.iam.gserviceaccount.com"
scheduler_service_agent="service-$project_number@gcp-sa-cloudscheduler.iam.gserviceaccount.com"
gcloud iam service-accounts add-iam-policy-binding "$tasks_sa" --project="$project" \
  --member="serviceAccount:$tasks_service_agent" --role=roles/iam.serviceAccountTokenCreator
gcloud iam service-accounts add-iam-policy-binding "$tasks_sa" --project="$project" \
  --member="serviceAccount:$scheduler_service_agent" --role=roles/iam.serviceAccountTokenCreator

echo 'Initial service roles are configured. Configure Firestore indexes, deploy the services, then bind blink3-tasks as invoker on blink3-orchestrator.'
echo 'The policy remains disabled until deploy/configure_policy.py is explicitly run with --apply --enable.'
