"""Cloud Tasks/Firestore orchestration for on-demand SPHEREx DR1 fields."""
from __future__ import annotations

from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import logging
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
import xml.etree.ElementTree as ET

from .archive_plan import make_plan, metadata, open_archive, votable
from .cloud_limits import MAX_ACTIVE_DOWNLOAD_JOBS
from .field_requests import PROCESSING_VERSION, normalize_request, sequence_id
from .firestore_state import FirestoreState
from .storage import from_env

class WorkflowError(RuntimeError):
    def __init__(self, detail, status_code=503, retry_after=None):
        super().__init__(detail)
        self.status_code = status_code
        self.retry_after = retry_after


RETRYABLE_METADATA_HTTP = frozenset((408, 429, 500, 502, 503, 504))
DEFAULT_METADATA_MAX_ATTEMPTS = 100


def metadata_retry_after(exc):
    """Return a bounded Retry-After delay for a Cloud Tasks retry response."""
    headers = getattr(exc, "headers", None)
    value = headers.get("Retry-After") if headers is not None else None
    if not value:
        return None
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        try:
            retry_at = parsedate_to_datetime(value)
            if retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=timezone.utc)
            seconds = (retry_at - datetime.now(timezone.utc)).total_seconds()
        except (TypeError, ValueError, OverflowError):
            return None
    if seconds <= 0:
        return None
    return min(300, max(1, int(seconds + 0.999)))


def task_archive_fetch(url):
    """Make one bounded IRSA attempt; Cloud Tasks supplies durable retries.

    Keeping retries inside a long-lived HTTP handler pins a Cloud Run request.
    A single 30-second attempt lets the authenticated task return/retry while
    preserving the queue's exponential backoff. The FITS downloader retains
    its separate eight-attempt resume behavior.
    """
    return metadata(url, max_attempts=1)


class CloudTasksQueue:
    def __init__(self, client=None, *, project=None, region=None, queue=None,
                 service_url=None, service_account=None):
        if client is None:
            from google.cloud import tasks_v2
            client = tasks_v2.CloudTasksClient()
        self.client = client
        self.project = project or os.getenv("GOOGLE_CLOUD_PROJECT", "spherex-blink")
        self.region = region or os.getenv("BLINK_REGION", "europe-west1")
        self.queue = queue or os.getenv("BLINK_TASK_QUEUE", "blink3-acquisition")
        self.service_url = (service_url or os.getenv("BLINK_ORCHESTRATION_URL", "")).rstrip("/")
        self.service_account = service_account or os.environ["BLINK_TASK_SERVICE_ACCOUNT"]

    def enqueue(self, path, payload, name):
        if not self.service_url:
            raise WorkflowError("The private orchestration URL is not configured.")
        from google.api_core.exceptions import AlreadyExists
        parent = self.client.queue_path(self.project, self.region, self.queue)
        task_name = re.sub(r"[^A-Za-z0-9_-]", "-", name)[:450]
        body = json.dumps(payload, separators=(",", ":")).encode()
        task = {
            "name": f"{parent}/tasks/{task_name}",
            "dispatch_deadline": {"seconds": 1800},
            "http_request": {
                "http_method": "POST",
                "url": f"{self.service_url}{path}",
                "headers": {"Content-Type": "application/json"},
                "body": body,
                "oidc_token": {
                    "service_account_email": self.service_account,
                    "audience": self.service_url,
                },
            },
        }
        try:
            return self.client.create_task(request={"parent": parent, "task": task}).name
        except AlreadyExists:
            return task["name"]
        except Exception as exc:
            logging.exception("Cloud Tasks enqueue failed for %s", path)
            raise WorkflowError("The data request could not be queued. Retrying is safe.", 503) from exc


class CloudRunJobLauncher:
    """Launch the existing Cloud Run Job with per-execution plan/context overrides."""
    def __init__(self, session=None, *, project=None, region=None, job=None):
        if session is None:
            import google.auth
            from google.auth.transport.requests import AuthorizedSession
            credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
            session = AuthorizedSession(credentials)
        self.session = session
        self.project = project or os.environ.get("GOOGLE_CLOUD_PROJECT", "spherex-blink")
        self.region = region or os.getenv("BLINK_REGION", "europe-west1")
        self.job = job or os.getenv("BLINK_PREPARE_JOB", "blink3-prepare")

    def launch(self, request_id, detector, plan_key, attempt):
        base = f"https://run.googleapis.com/v2/projects/{self.project}/locations/{self.region}/jobs/{self.job}"
        args = ["--stored-plan", "--plan", plan_key, "--confirm-download",
                "--request-id", request_id, "--detector", detector, "--attempt", str(attempt)]
        response = self.session.post(
            f"{base}:run",
            json={"overrides": {"containerOverrides": [{"args": args}]}},
            timeout=30,
        )
        if response.status_code >= 400:
            raise WorkflowError("Cloud Run could not start the preparation job.")
        operation = response.json()
        metadata = operation.get("metadata") or {}
        execution_name = metadata.get("name") or (operation.get("response") or {}).get("name")
        return {"operationName": operation.get("name"), "executionName": execution_name}

    def execution_status(self, name):
        if not name:
            return "unknown"
        if not name.startswith(("projects/", "/projects/")) and "/operations/" not in name:
            name = (f"projects/{self.project}/locations/{self.region}/jobs/{self.job}/executions/"
                    f"{name.rsplit('/', 1)[-1]}")
        import google.auth
        from google.auth.transport.requests import AuthorizedSession
        if not hasattr(self.session, "get"):
            credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
            self.session = AuthorizedSession(credentials)
        response = self.session.get(f"https://run.googleapis.com/v2/{name.lstrip('/')}" , timeout=20)
        if response.status_code == 404:
            return "unknown"
        if response.status_code >= 400:
            return "unavailable"
        execution = response.json()
        if "/operations/" in name:
            if not execution.get("done"):
                return "launching"
            if execution.get("error"):
                return "failed"
            target = (execution.get("response") or {}).get("name")
            if target:
                return self.execution_status(target)
            return "unknown"
        conditions = execution.get("conditions") or []
        completed = next((c for c in conditions if c.get("type") == "Completed"), None)
        if completed and completed.get("state") in ("CONDITION_FAILED", "CONDITION_SUCCEEDED"):
            reason = str(completed.get("executionReason", completed.get("reason", ""))).lower()
            message = str(completed.get("message", "")).lower()
            if "cancel" in reason or "cancel" in message:
                return "cancelled"
            if completed.get("state") == "CONDITION_FAILED":
                return "failed"
        if execution.get("failedCount", 0):
            return "failed"
        if execution.get("succeededCount", 0) and execution.get("completionTime"):
            return "succeeded"
        return "running"

    def find_execution(self, request_id, detector, attempt):
        if not hasattr(self.session, "get"):
            import google.auth
            from google.auth.transport.requests import AuthorizedSession
            credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
            self.session = AuthorizedSession(credentials)
        url = f"https://run.googleapis.com/v2/projects/{self.project}/locations/{self.region}/jobs/{self.job}/executions?pageSize=100"
        response = self.session.get(url, timeout=20)
        if response.status_code >= 400:
            return "unavailable"
        for execution in response.json().get("executions", []):
            # In Cloud Run v2, Execution.template is the TaskTemplate and owns containers directly.
            containers = ((execution.get("template") or {}).get("containers") or [])
            args = containers[0].get("args", []) if containers else []
            try:
                rid = args[args.index("--request-id") + 1]
                det = args[args.index("--detector") + 1]
                run_attempt = int(args[args.index("--attempt") + 1])
            except (ValueError, IndexError):
                continue
            if (rid, det, run_attempt) == (request_id, detector, int(attempt)):
                return execution.get("name")
        return None


def verify_task_identity(request, *, audience, service_account):
    """Verify Cloud Tasks OIDC rather than trusting public request headers."""
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        return False
    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token
        claims = id_token.verify_oauth2_token(auth[7:], google_requests.Request(), audience=audience)
        return claims.get("email") == service_account and claims.get("email_verified") is True
    except Exception:
        return False


class CloudWorkflow:
    def __init__(self, state=None, tasks=None, launcher=None, store=None,
                 *, max_active_jobs=MAX_ACTIVE_DOWNLOAD_JOBS,
                 task_identity_verifier=verify_task_identity,
                 archive_fetch=task_archive_fetch):
        self.state = state or FirestoreState()
        self.tasks = tasks or CloudTasksQueue()
        self.launcher = launcher or CloudRunJobLauncher()
        self.store = store or from_env()
        self.max_active_jobs = max(1, min(MAX_ACTIVE_DOWNLOAD_JOBS, int(max_active_jobs)))
        self.archive_fetch = archive_fetch
        self.verify_identity = task_identity_verifier
        self.metadata_max_attempts = max(1, min(
            DEFAULT_METADATA_MAX_ATTEMPTS, int(os.getenv("BLINK_METADATA_MAX_ATTEMPTS", DEFAULT_METADATA_MAX_ATTEMPTS))))
        approved_path = os.getenv("BLINK_APPROVED_FILE", os.path.join(os.path.dirname(__file__), "..", "approved_sequences.json"))
        try:
            self.approved_sequences = json.loads(open(approved_path, encoding="utf-8").read()).get("approved", [])
        except (OSError, ValueError):
            self.approved_sequences = []

    def _require_task(self, request, audience, service_account):
        if not self.verify_identity(request, audience=audience, service_account=service_account):
            raise WorkflowError("Task authentication failed.", 401)

    def _record_metadata_failure(self, request_id, attempt, message, *, http_status=None, retrying):
        request = self.state.get_request(request_id) or {}
        for detector, previous in request.get("detectors", {}).items():
            if previous.get("status") in ("ready", "unavailable"):
                continue
            values = {
                "status": "discovering" if retrying else "failed",
                "phase": "metadata-retrying" if retrying else "metadata-failed",
                "error": message,
                "metadataAttemptCount": attempt,
            }
            if not retrying:
                values["progress"] = 0.03
            self.state.update_detector(request_id, detector, values)
        self.state.update_request(request_id, {
            "status": "discovering" if retrying else "failed",
            "phase": "metadata-retrying" if retrying else "metadata-failed",
            "metadataAttemptCount": attempt,
            "metadataRetrying": retrying,
            "metadataError": message,
            "metadataHttpStatus": http_status,
        })
        if not retrying:
            self._refresh_request_status(request_id)

    def _retry_metadata(self, request_id, attempt, message, *, exc=None):
        http_status = exc.code if isinstance(exc, HTTPError) else None
        if attempt >= self.metadata_max_attempts:
            terminal = (f"IRSA archive search stopped after {attempt} failed attempts. "
                        "Use Retry failed detectors to start a fresh attempt.")
            self._record_metadata_failure(request_id, attempt, terminal,
                                          http_status=http_status, retrying=False)
            return "failed"
        self._record_metadata_failure(request_id, attempt, message,
                                      http_status=http_status, retrying=True)
        retry_after = metadata_retry_after(exc) if isinstance(exc, HTTPError) else None
        raise WorkflowError(message, 503, retry_after=retry_after) from exc

    def _fail_metadata(self, request_id, attempt, message, *, http_status=None):
        self._record_metadata_failure(request_id, attempt, message,
                                      http_status=http_status, retrying=False)
        return "failed"

    def discover(self, request_id, lease_id=None):
        request = self.state.get_request(request_id)
        if request is None:
            return
        self.state.policy()
        metadata_key = request.get("metadataKey")
        if not metadata_key:
            lock_id = f"discover-{request_id}"
            owner = lease_id or f"discover-{request_id}-a{request.get('discoveryAttempt', 0)}"
            if not self.state.claim_work_lock(lock_id, owner):
                return
            try:
                attempt = int(request.get("metadataAttemptCount", 0)) + 1
                if attempt > self.metadata_max_attempts:
                    return self._fail_metadata(
                        request_id, self.metadata_max_attempts,
                        f"IRSA archive search stopped after {self.metadata_max_attempts} failed attempts. "
                        "Use Retry failed detectors to start a fresh attempt.",
                        http_status=request.get("metadataHttpStatus"),
                    )
                self.state.update_request(request_id, {
                    "status": "discovering", "phase": "metadata", "metadataAttemptCount": attempt,
                    "metadataRetrying": False, "metadataError": None, "metadataHttpStatus": None,
                })
                for detector in request["detectors"]:
                    previous = request.get("detectors", {}).get(detector, {})
                    if previous.get("status") in ("ready", "unavailable"):
                        continue
                    self.state.update_detector(request_id, detector, {
                        "status": "discovering", "phase": "metadata", "progress": 0.03,
                        "error": None, "metadataAttemptCount": attempt,
                    })
                query = request["query"]
                params = urlencode({"COLLECTION": request["collection"],
                                    "POS": f"circle {query['ra']} {query['dec']} {query['fov'] / 120}",
                                    "MAXREC": 4096, "RESPONSEFORMAT": "votable"})
                archive_url = "https://irsa.ipac.caltech.edu/SIA?" + params
                try:
                    response = self.archive_fetch(archive_url)
                except HTTPError as exc:
                    if exc.code in RETRYABLE_METADATA_HTTP:
                        return self._retry_metadata(
                            request_id, attempt,
                            f"IRSA archive search is temporarily unavailable (HTTP {exc.code}); Cloud Tasks will retry.",
                            exc=exc,
                        )
                    return self._fail_metadata(
                        request_id, attempt,
                        f"IRSA rejected the metadata search (HTTP {exc.code}); no detector plans were created.",
                        http_status=exc.code,
                    )
                except (URLError, TimeoutError, ConnectionError) as exc:
                    return self._retry_metadata(
                        request_id, attempt,
                        "IRSA archive search timed out or could not connect; Cloud Tasks will retry.", exc=exc,
                    )
                except Exception as exc:
                    logging.exception("Unexpected IRSA metadata request failure for %s", request_id)
                    return self._retry_metadata(
                        request_id, attempt,
                        "IRSA archive search failed temporarily; Cloud Tasks will retry.", exc=exc,
                    )
                try:
                    rows = votable(response)
                except (ValueError, ET.ParseError) as exc:
                    return self._fail_metadata(
                        request_id, attempt,
                        f"IRSA returned an unusable metadata response: {str(exc)[:160]}",
                    )
                metadata_key = f"requests/{request_id}/archive-metadata.json"
                try:
                    self.store.put_json(metadata_key, rows)
                except Exception as exc:
                    logging.exception("Could not store IRSA metadata for %s", request_id)
                    return self._retry_metadata(
                        request_id, attempt,
                        "The archive response was received but could not be stored; Cloud Tasks will retry.",
                        exc=exc,
                    )
                self.state.update_request(request_id, {"metadataKey": metadata_key,
                                                        "status": "planning", "phase": "planning",
                                                        "metadataRetrying": False, "metadataError": None,
                                                        "metadataHttpStatus": None})
            finally:
                self.state.release_work_lock(lock_id, owner)
        for detector in request["detectors"]:
            previous = (self.state.get_request(request_id) or {}).get("detectors", {}).get(detector, {})
            if previous.get("status") in ("ready", "unavailable"):
                continue
            task_name = f"plan-{request_id}-{detector.lower()}-d{int(request.get('discoveryAttempt', 0))}"
            self.tasks.enqueue("/internal/tasks/plan",
                {"requestId": request_id, "detector": detector, "metadataKey": metadata_key,
                 "leaseId": task_name}, task_name)
        self._refresh_request_status(request_id)

    def plan_detector(self, request_id, detector, metadata_key, lease_id=None):
        request = self.state.get_request(request_id)
        if request is None or detector not in request.get("detectors", {}):
            return "missing"
        current = request["detectors"][detector]
        if current.get("status") in ("ready", "unavailable") or current.get("planKey"):
            return "already-planned"
        if request.get("metadataKey") != metadata_key:
            return "stale-metadata"
        policy = self.state.policy()
        lock_id = f"plan-{request_id}-{detector.lower()}"
        owner = lease_id or f"plan-{request_id}-{detector.lower()}-d{request.get('discoveryAttempt', 0)}"
        if not self.state.claim_work_lock(lock_id, owner):
            return "active"
        query = request["query"]
        self.state.update_detector(request_id, detector, {
            "status": "planning", "phase": "resolve-archive-products", "progress": 0.08,
        })
        try:
            plan = make_plan(
                self.store.json(metadata_key, limit=16 * 1024**2),
                ra=query["ra"], dec=query["dec"], fov=query["fov"],
                detector=detector, collection=request["collection"],
                count=int(policy.get("maxObservationsPerDetector", 12)),
                cutouts=True, newest=request.get("selection") == "latest",
                mjd_start=request.get("mjdStart"), mjd_end=request.get("mjdEnd"),
            )
        except ValueError as exc:
            unavailable = "No matching observations" in str(exc)
            self.state.update_detector(request_id, detector, {
                "status": "unavailable" if unavailable else "failed",
                "phase": "unavailable" if unavailable else "planning",
                "progress": 0.0,
                "error": ("No SPHEREx observations matched this detector and date range."
                          if unavailable else "Could not plan this detector's archive observations."),
            })
            self.state.release_work_lock(lock_id, owner)
            self._refresh_request_status(request_id)
            return "unavailable" if unavailable else "failed"
        except Exception:
            self.state.release_work_lock(lock_id, owner)
            raise
        try:
            cached = self._matching_cached_sequence(request, detector, plan, policy)
        except Exception:
            self.state.release_work_lock(lock_id, owner)
            raise
        if cached:
            self.state.update_detector(request_id, detector, {
                "status": "ready", "phase": "cached", "progress": 1.0,
                "sequenceId": cached["sequenceId"], "revision": cached["revision"],
                "frameCount": len(cached["frames"]), "cached": True,
                "sourcePolicyVersion": cached.get("policyVersion"), "error": None,
            })
            self.state.release_work_lock(lock_id, owner)
            self._refresh_request_status(request_id)
            return "cached"
        sid = sequence_id(request_id, detector)
        plan.update({
            "sequenceId": sid, "requestId": request_id,
            "fieldKey": request["fieldKey"], "policyVersion": request["policyVersion"],
            "selection": request["selection"], "dateFrom": request.get("dateFrom"),
            "dateTo": request.get("dateTo"),
            "maxFileBytes": int(policy.get("maxFileBytes", 32 * 1024**2)),
            "maxTotalBytes": int(policy.get("maxTotalBytesPerDetector", 128 * 1024**2)),
            "downloadApproved": True, "termsChecked": True,
            "acknowledgement": policy["acknowledgement"],
            "dataDoi": policy["dataDoi"],
        })
        plan_key = f"plans/{request_id}/{detector.lower()}.json"
        try:
            self.store.put_json(plan_key, plan)
        except Exception:
            self.state.release_work_lock(lock_id, owner)
            raise
        self.state.update_detector(request_id, detector, {
            "status": "queued", "phase": "queued", "progress": 0.08,
            "totalFiles": len(plan["files"]), "completedFiles": 0,
            "estimatedPasses": plan["passCount"], "planKey": plan_key,
        })
        self.state.release_work_lock(lock_id, owner)
        attempt = int(current.get("attempt", 0))
        self.tasks.enqueue("/internal/tasks/detector", {"requestId": request_id, "detector": detector},
                           f"dispatch-{request_id}-{detector.lower()}-a{attempt}")
        self._refresh_request_status(request_id)
        return "queued"

    def _matching_cached_sequence(self, request, detector, plan, policy):
        """Reuse an immutable prepared sequence only when its exact observation set matches."""
        from .manifest import validate_manifest
        candidates = []
        for pointer in self.state.catalog_for_field(
                request["query"]["ra"], request["query"]["dec"], request["query"]["fov"], detector, limit=100):
            candidates.append((pointer.get("manifest"), pointer.get("sequenceId")))
        for entry in self.approved_sequences:
            if entry.get("termsChecked") is True:
                candidates.append((entry.get("manifest"), entry.get("sequenceId")))
        expected = [item["obsId"] for item in plan["files"]]
        for key, expected_sequence in candidates:
            if not key:
                continue
            try:
                manifest = self.store.json(key, limit=2 * 1024**2)
                validate_manifest(manifest)
            except Exception:
                continue
            q = manifest.get("query", {})
            originals = manifest.get("originals", [])
            if (manifest.get("dataKind") != "real" or manifest.get("collection") != request["collection"]
                    or manifest.get("processingVersion") != request["processingVersion"]
                    or manifest.get("termsChecked") is not True
                    or manifest.get("acknowledgement") != policy.get("acknowledgement")
                    or q.get("det") != detector
                    or abs(float(q.get("ra", -999)) - request["query"]["ra"]) >= 1e-7
                    or abs(float(q.get("dec", -999)) - request["query"]["dec"]) >= 1e-7
                    or abs(float(q.get("fov", -999)) - request["query"]["fov"]) >= 1e-7
                    or [item.get("obsId") for item in originals] != expected
                    or len(originals) != len(expected)
                    or any(int(item.get("sizeBytes", 0)) > int(policy.get("maxFileBytes", 32 * 1024**2)) for item in originals)
                    or sum(int(item.get("sizeBytes", 0)) for item in originals) > int(policy.get("maxTotalBytesPerDetector", 128 * 1024**2))):
                continue
            if expected_sequence and expected_sequence != manifest.get("sequenceId"):
                continue
            return manifest
        return None

    def dispatch_detector(self, request_id, detector):
        request = self.state.get_request(request_id)
        if request is None or detector not in request.get("detectors", {}):
            return "missing"
        policy = self.state.policy()
        current = request["detectors"][detector]
        if current.get("status") in ("ready", "unavailable"):
            return "terminal"
        attempt = (int(current.get("attempt", 0)) if current.get("retryQueued")
                   else int(current.get("attempt", 0)) + 1)
        attempt_id = f"{request_id}:{detector}:{attempt}"
        claim = self.state.claim_slot(request_id, detector, attempt_id,
                                      max_active=min(self.max_active_jobs,
                                          int(policy.get("maxConcurrentDownloads",
                                                          MAX_ACTIVE_DOWNLOAD_JOBS))))
        if claim == "full":
            return "retry"
        if claim != "claimed":
            return claim
        self.state.update_detector(request_id, detector, {
            "status": "downloading", "phase": "starting", "attempt": attempt,
            "progress": 0.08, "attemptId": attempt_id, "retryQueued": False, "error": None,
        })
        plan_key = current.get("planKey")
        if not plan_key:
            self.state.release_slot(request_id, detector, attempt_id)
            self.state.update_detector(request_id, detector, {
                "status": "failed", "phase": "planning", "error": "The detector plan is missing."
            })
            return "failed"
        try:
            launched = self.launcher.launch(request_id, detector, plan_key, attempt)
            execution_name = launched.get("executionName") or launched.get("operationName")
            self.state.attach_execution(request_id, detector, attempt_id, execution_name)
            return "launched"
        except Exception:
            # Keep the lease until reconciliation resolves an ambiguous API timeout.
            self.state.update_detector(request_id, detector, {
                "status": "downloading", "phase": "launch-check",
                "attempt": attempt, "attemptId": attempt_id,
                "error": "Job launch response was inconclusive; checking execution state.",
            })
            return "retry"

    def reconcile(self):
        repaired = 0
        for slot in self.state.active_slots(limit=100):
            name = slot.get("executionName")
            if not name or "/operations/" in name:
                name = self.launcher.find_execution(slot["requestId"], slot["detector"],
                                                    slot["attemptId"].rsplit(":", 1)[-1])
                if name == "unavailable":
                    continue
                if name:
                    self.state.attach_execution(slot["requestId"], slot["detector"],
                                                slot["attemptId"], name)
            status = self.launcher.execution_status(name) if name else "unknown"
            if status == "unavailable":
                continue
            request_id, detector, attempt_id = slot["requestId"], slot["detector"], slot["attemptId"]
            if status in ("succeeded", "failed", "cancelled"):
                request = self.state.get_request(request_id) or {}
                current = request.get("detectors", {}).get(detector, {})
                if current.get("status") not in ("ready", "failed", "unavailable"):
                    self.state.update_detector(request_id, detector, {
                        "status": "failed", "phase": "failed", "error": "Preparation execution ended before publishing a valid sequence."
                    })
                self.state.release_slot(request_id, detector, attempt_id)
                repaired += 1
            elif status in ("unknown", "launching"):
                # Recover lost dispatcher/job-start events only after a generous grace window.
                if self.state.reset_expired_slot(slot, lease_seconds=600):
                    self.tasks.enqueue("/internal/tasks/detector",
                                       {"requestId": request_id, "detector": detector},
                                       f"dispatch-{request_id}-{detector.lower()}-recover-{attempt_id.rsplit(':', 1)[-1]}")
                    repaired += 1
        # Advance queued detectors after any completed job released its global slot.
        try:
            acquisitions_enabled = self.state.policy().get("enabled") is True
        except Exception:
            acquisitions_enabled = False
        for request in self.state.queued_requests(limit=100):
            request_id = request["requestId"]
            detectors = request.get("detectors", {})
            undiscovered = (not request.get("metadataKey") and any(
                item.get("status") in ("queued", "discovering", "planning") and not item.get("planKey")
                for item in detectors.values()))
            updated = request.get("updatedAt")
            age = ((datetime.now(timezone.utc) - updated.replace(tzinfo=timezone.utc)).total_seconds()
                   if updated else 0)
            stale = age > 600
            if acquisitions_enabled and undiscovered and stale and not self.state.work_lock_active(f"discover-{request_id}"):
                epoch = int(datetime.now(timezone.utc).timestamp() // 300)
                task_name = f"discover-{request_id}-reconcile-{epoch}"
                self.tasks.enqueue("/internal/tasks/discover",
                                   {"requestId": request_id, "leaseId": task_name}, task_name)
            for detector, item in request.get("detectors", {}).items():
                if (acquisitions_enabled and item.get("status") in ("queued", "planning")
                        and not item.get("planKey") and request.get("metadataKey") and stale
                        and not self.state.work_lock_active(f"plan-{request_id}-{detector.lower()}")):
                    epoch = int(datetime.now(timezone.utc).timestamp() // 300)
                    task_name = f"plan-{request_id}-{detector.lower()}-recover-{epoch}"
                    self.tasks.enqueue("/internal/tasks/plan",
                        {"requestId": request_id, "detector": detector, "metadataKey": request["metadataKey"],
                         "leaseId": task_name}, task_name)
                if acquisitions_enabled and item.get("status") == "queued" and item.get("planKey"):
                    attempt = int(item.get("attempt", 0))
                    epoch = int(datetime.now(timezone.utc).timestamp() // 60)
                    self.tasks.enqueue("/internal/tasks/detector",
                        {"requestId": request["requestId"], "detector": detector},
                        f"dispatch-{request['requestId']}-{detector.lower()}-a{attempt}-reconcile-{epoch}")
        return {"reconciled": repaired}

    def _refresh_request_status(self, request_id):
        request = self.state.get_request(request_id)
        if not request:
            return
        from .field_requests import aggregate_progress
        aggregate = aggregate_progress(request.get("detectors", {}))
        self.state.update_request(request_id, aggregate)

    def validate_task_request(self, request, audience, service_account):
        self._require_task(request, audience, service_account)


def workflow_from_env():
    enabled = os.getenv("BLINK_WORKFLOW_ENABLED", "false").lower() == "true"
    if not enabled:
        return None
    return PublicFieldRequests()


class PublicFieldRequests:
    """Public API façade: Firestore state and task enqueue only, no job launcher."""
    def __init__(self, state=None, tasks=None):
        self.state = state or FirestoreState()
        self.tasks = tasks or CloudTasksQueue()

    def submit(self, payload):
        # A previously completed exact request remains queryable while the emergency
        # switch is off. The switch gates only creation of new acquisition work.
        policy = self.state.policy(require_enabled=False)
        normalized = normalize_request(
            payload, allowed_collections=policy.get("allowedCollections", ["spherex_dr1"]),
            processing_version=policy.get("processingVersion", PROCESSING_VERSION),
        )
        request = self.state.get_request(normalized["requestId"])
        created = False
        if request is None:
            if policy.get("enabled") is not True:
                raise WorkflowError("New SPHEREx data requests are temporarily disabled.", 503)
            request, created = self.state.create_request(normalized, policy)
        if request.get("status") in ("failed", "unavailable"):
            if policy.get("enabled") is True:
                request = self.retry(normalized["requestId"])
                created = False
        elif (created or (policy.get("enabled") is True
                          and request.get("status") in ("queued", "discovering")
                          and not request.get("metadataKey"))):
            # The Firestore write can succeed while Cloud Tasks rejects the create.
            # Re-enqueueing a stable task name makes a repeated submit recover that gap.
            attempt = int(request.get("discoveryAttempt", 0))
            task_name = f"discover-{normalized['requestId']}-a{attempt}"
            self.tasks.enqueue("/internal/tasks/discover",
                               {"requestId": normalized["requestId"], "leaseId": task_name}, task_name)
        return {
            "requestId": normalized["requestId"], "status": request.get("status", "queued"),
            "cached": request.get("status") == "ready",
            "statusUrl": f"/api/field-requests/{normalized['requestId']}",
            "query": normalized["query"], "detectors": request.get("detectors", {}),
        }

    def status(self, request_id):
        request = self.state.get_request(request_id)
        if request is None:
            raise WorkflowError("No field request exists with that ID.", 404)
        detectors = request.get("detectors", {})
        ready = sum(value.get("status") == "ready" for value in detectors.values())
        return {"requestId": request_id, "status": request.get("status", "queued"),
                "progress": request.get("progress", 0.0), "query": request.get("query"),
                "selection": request.get("selection", "latest"),
                "policyVersion": request.get("policyVersion"), "readyDetectors": ready,
                "metadataAttemptCount": int(request.get("metadataAttemptCount", 0)),
                "metadataRetrying": request.get("metadataRetrying", False) is True,
                "metadataError": request.get("metadataError"),
                "metadataHttpStatus": request.get("metadataHttpStatus"),
                "acknowledgement": request.get("acknowledgement"),
                "dataDoi": request.get("dataDoi"),
                "detectors": detectors, "readyForServing": ready > 0,
                "updatedAt": request.get("updatedAt")}

    def retry(self, request_id):
        request = self.state.get_request(request_id)
        if request is None:
            raise WorkflowError("No field request exists with that ID.", 404)
        discovery_attempt = int(request.get("discoveryAttempt", 0)) + 1
        retried = False
        needs_discovery = False
        for detector, value in request.get("detectors", {}).items():
            if value.get("status") != "failed":
                continue
            retried = True
            self.state.update_detector(request_id, detector, {
                "status": "queued", "phase": "queued", "progress": 0.0, "error": None,
                "attempt": int(value.get("attempt", 0)) + 1, "retryQueued": True,
            })
            if value.get("planKey"):
                self.tasks.enqueue("/internal/tasks/detector",
                    {"requestId": request_id, "detector": detector},
                    f"dispatch-{request_id}-{detector.lower()}-retry-d{discovery_attempt}")
            else:
                needs_discovery = True
        if not retried:
            return request
        values = {"status": "queued", "progress": 0.0, "discoveryAttempt": discovery_attempt}
        if needs_discovery and not request.get("metadataKey"):
            values.update({"metadataAttemptCount": 0, "metadataRetrying": False,
                           "metadataError": None, "metadataHttpStatus": None})
        self.state.update_request(request_id, values)
        if needs_discovery:
            task_name = f"discover-{request_id}-a{discovery_attempt}"
            self.tasks.enqueue("/internal/tasks/discover",
                               {"requestId": request_id, "leaseId": task_name}, task_name)
        return self.state.get_request(request_id)
