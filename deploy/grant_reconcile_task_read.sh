#!/usr/bin/env bash
# Grants only Cloud Tasks get_task access on the acquisition queue to the private
# orchestrator. Does not modify service IAM, queue settings, or other resources.
set -euo pipefail
project=spherex-blink
region=europe-west1
queue=blink3-acquisition
orchestrator_sa="blink3-orchestrator@$project.iam.gserviceaccount.com"
role="projects/$project/roles/blink3TaskInspector"

if [[ "${1:-}" != "--apply" ]]; then
  cat <<EOF
Dry run only. This script creates/updates project custom role blink3TaskInspector
with only cloudtasks.tasks.get and binds it to $orchestrator_sa on queue $queue
in $region. It does not grant task read access on any other queue.
Run with --apply after explicit owner approval.
EOF
  exit 0
fi

if gcloud iam roles describe blink3TaskInspector --project="$project" >/dev/null 2>&1; then
  gcloud iam roles update blink3TaskInspector --project="$project" \
    --permissions=cloudtasks.tasks.get --stage=GA
else
  gcloud iam roles create blink3TaskInspector --project="$project" \
    --title='Blink 3 acquisition task inspector' \
    --description='Read named tasks in the Blink 3 acquisition queue for idempotent stale-request reconciliation.' \
    --permissions=cloudtasks.tasks.get --stage=GA
fi
gcloud tasks queues add-iam-policy-binding "$queue" --location="$region" --project="$project" \
  --member="serviceAccount:$orchestrator_sa" --role="$role"
