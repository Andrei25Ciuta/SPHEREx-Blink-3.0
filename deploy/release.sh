#!/usr/bin/env bash
# Does not execute a preparation job, enable pixel serving, or enable acquisition policy.
set -euo pipefail
if [[ "${1:-}" != "--apply" || -z "${2:-}" ]]; then
  echo 'Usage (after explicit deployment approval): bash deploy/release.sh --apply RELEASE_TAG'
  exit 0
fi
tag="$2"
[[ "$tag" =~ ^[a-z0-9][a-z0-9.-]{0,60}$ ]] || { echo 'Invalid release tag'; exit 1; }
project=spherex-blink
region=europe-west1
images="$region-docker.pkg.dev/$project/blink3"
tasks_sa="blink3-tasks@$project.iam.gserviceaccount.com"
service_url=$(gcloud run services describe blink3-api --project="$project" --region="$region" --format='value(status.url)' 2>/dev/null || true)
gcloud builds submit . --project="$project" --region="$region" --config=deploy/cloudbuild.yaml \
  --service-account="projects/$project/serviceAccounts/blink3-build@$project.iam.gserviceaccount.com" \
  --substitutions="_IMAGE_BASE=$images,_TAG=$tag"
# Let private task handlers scale independently; Firestore and the owner policy cap active jobs at 20.
gcloud run deploy blink3-orchestrator --project="$project" --region="$region" --image="$images/api:$tag" \
  --command=uvicorn --args=orchestration_app:app,--app-dir,backend,--host,0.0.0.0,--port,8080 \
  --service-account="blink3-orchestrator@$project.iam.gserviceaccount.com" --no-allow-unauthenticated \
  --min=0 --max=3 --cpu=1 --memory=1Gi --concurrency=10 --timeout=1800 \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=$project,BLINK_GCS_BUCKET=spherex-blink-blink3-products,BLINK_GCS_PREFIX=blink3,BLINK_TASK_SERVICE_ACCOUNT=blink3-tasks@$project.iam.gserviceaccount.com,BLINK_FIRESTORE_DATABASE=blink3-state,BLINK_POLICY_FIRESTORE_DATABASE=blink3-policy,BLINK_REGION=$region,BLINK_PREPARE_JOB=blink3-prepare,BLINK_MAX_ACTIVE_DOWNLOAD_JOBS=20"
orchestrator_url=$(gcloud run services describe blink3-orchestrator --project="$project" --region="$region" --format='value(status.url)')
gcloud run services update blink3-orchestrator --project="$project" --region="$region" \
  --update-env-vars="BLINK_ORCHESTRATION_URL=$orchestrator_url"
gcloud run services add-iam-policy-binding blink3-orchestrator --project="$project" --region="$region" \
  --member="serviceAccount:blink3-tasks@$project.iam.gserviceaccount.com" --role=roles/run.invoker

gcloud run deploy blink3-api --project="$project" --region="$region" --image="$images/api:$tag" \
  --service-account="blink3-api@$project.iam.gserviceaccount.com" --allow-unauthenticated \
  --min=0 --max=1 --cpu=1 --memory=1Gi --concurrency=8 --timeout=60 \
  --update-env-vars="^|^GOOGLE_CLOUD_PROJECT=$project|BLINK_GCS_BUCKET=spherex-blink-blink3-products|BLINK_GCS_PREFIX=blink3|BLINK_CORS_ORIGINS=https://iooonut.github.io,https://mateibut.github.io,https://andrei25ciuta.github.io|BLINK_WORKFLOW_ENABLED=true|BLINK_PUBLIC_BASE_URL=$service_url|BLINK_ORCHESTRATION_URL=$orchestrator_url|BLINK_TASK_QUEUE=blink3-acquisition|BLINK_TASK_SERVICE_ACCOUNT=blink3-tasks@$project.iam.gserviceaccount.com|BLINK_FIRESTORE_DATABASE=blink3-state|BLINK_POLICY_FIRESTORE_DATABASE=blink3-policy|BLINK_REGION=$region|BLINK_MAX_ACTIVE_DOWNLOAD_JOBS=20"
service_url=$(gcloud run services describe blink3-api --project="$project" --region="$region" --format='value(status.url)')
gcloud run services update blink3-api --project="$project" --region="$region" --update-env-vars="BLINK_PUBLIC_BASE_URL=$service_url"
gcloud run jobs deploy blink3-prepare --project="$project" --region="$region" --image="$images/job:$tag" \
  --service-account="blink3-job@$project.iam.gserviceaccount.com" --tasks=1 --parallelism=1 --max-retries=0 \
  --cpu=2 --memory=4Gi --task-timeout=30m \
  --set-env-vars=GOOGLE_CLOUD_PROJECT=spherex-blink,BLINK_GCS_BUCKET=spherex-blink-blink3-products,BLINK_GCS_PREFIX=blink3,BLINK_FIRESTORE_DATABASE=blink3-state,BLINK_POLICY_FIRESTORE_DATABASE=blink3-policy,BLINK_REGION=europe-west1 \
  --args=--stored-plan,--plan,plans/barnard-d2.json
gcloud run jobs update blink3-prepare --project="$project" --region="$region" \
  --service-account="blink3-job@$project.iam.gserviceaccount.com" --set-env-vars=GOOGLE_CLOUD_PROJECT=spherex-blink,BLINK_GCS_BUCKET=spherex-blink-blink3-products,BLINK_GCS_PREFIX=blink3,BLINK_FIRESTORE_DATABASE=blink3-state,BLINK_POLICY_FIRESTORE_DATABASE=blink3-policy,BLINK_REGION=europe-west1
echo "API deployed with existing static pixel-serving gate retained, acquisition service available only to authenticated Cloud Tasks: $service_url"

# Optional recovery scheduler: it only reconciles durable Firestore/job state; it does not download data itself.
if ! gcloud scheduler jobs describe blink3-reconcile --location="$region" --project="$project" >/dev/null 2>&1; then
  gcloud scheduler jobs create http blink3-reconcile --location="$region" --project="$project" \
    --schedule='*/2 * * * *' --uri="$orchestrator_url/internal/tasks/reconcile" --http-method=POST \
    --message-body='{}' --oidc-service-account-email="$tasks_sa" --oidc-token-audience="$orchestrator_url"
fi
