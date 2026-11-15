import json
from io import BytesIO
from urllib.error import HTTPError

import pytest

from spherex.cloud_workflow import (CloudRunJobLauncher, CloudTasksQueue, CloudWorkflow,
                                    PublicFieldRequests, WorkflowError, task_archive_fetch)
from spherex.field_requests import DETECTORS, normalize_request


def test_monthly_cache_requires_the_same_month_set_and_selected_archive_candidates():
    plan = {
        "requestedMonths": ["2025-01", "2025-02", "2025-03"],
        "monthGroups": [
            {"month": "2025-01", "obsIds": ["jan-a", "jan-b"]},
            {"month": "2025-02", "obsIds": ["feb-a"]},
        ],
    }
    manifest = {
        "originals": [{"obsId": "jan-b"}, {"obsId": "feb-a"}],
        "monthlySelection": {
            "mode": "one-per-utc-month", "requestedMonths": plan["requestedMonths"],
            "missingMonths": ["2025-03"],
            "monthResults": [
                {"month": "2025-01", "status": "ready", "selectedObsId": "jan-b"},
                {"month": "2025-02", "status": "ready", "selectedObsId": "feb-a"},
                {"month": "2025-03", "status": "unavailable", "selectedObsId": None},
            ],
        },
    }
    expected = {"2025-01": {"jan-a", "jan-b"}, "2025-02": {"feb-a"}}
    assert CloudWorkflow._monthly_cache_matches(manifest, expected, plan)

    older_window = {**plan, "requestedMonths": ["2024-12", "2025-01", "2025-02"]}
    assert not CloudWorkflow._monthly_cache_matches(manifest, expected, older_window)
    unavailable_candidate = {"2025-01": {"jan-a"}, "2025-02": {"feb-a"}}
    assert not CloudWorkflow._monthly_cache_matches(manifest, unavailable_candidate, plan)


def test_cloud_task_archive_fetch_uses_one_attempt_and_leaves_backoff_to_queue(monkeypatch):
    seen = {}
    def fake_metadata(url, **kwargs):
        seen.update(url=url, **kwargs)
        return b"bounded response"
    monkeypatch.setattr("spherex.cloud_workflow.metadata", fake_metadata)
    result = task_archive_fetch("https://irsa.ipac.caltech.edu/SIA?")
    assert result == b"bounded response"
    assert seen == {"url": "https://irsa.ipac.caltech.edu/SIA?", "max_attempts": 1}


class FakeState:
    def __init__(self, request, policy):
        self.request = request
        self._policy = policy
        self.locks = set()

    def policy(self, **_kwargs):
        return self._policy

    def get_request(self, _request_id):
        return self.request if self.request.get("requestId") == _request_id else None

    def update_request(self, _request_id, values):
        self.request.update(values)
        return self.request

    def update_detector(self, _request_id, detector, values):
        self.request["detectors"][detector].update(values)
        return self.request

    def claim_work_lock(self, lock_id, owner, **_kwargs):
        if lock_id in self.locks:
            return False
        self.locks.add(lock_id)
        return True

    def release_work_lock(self, lock_id, _owner):
        self.locks.discard(lock_id)
        return True

    def claim_slot(self, _request_id, _detector, _attempt_id, max_active=20):
        self.max_active = max_active
        return "claimed"

    def attach_execution(self, *_args):
        return None

    def catalog_for_field(self, *_args, **_kwargs):
        return []


class FakeTasks:
    def __init__(self):
        self.enqueued = []

    def enqueue(self, path, payload, name):
        self.enqueued.append((path, payload, name))
        return name


class FakeStore:
    def __init__(self, metadata_rows):
        self.objects = {"requests/test/archive-metadata.json": metadata_rows}

    def json(self, key, **_kwargs):
        return self.objects[key]

    def put_json(self, key, value):
        self.objects[key] = value


class FakeResponse:
    status_code = 200

    def __init__(self, value):
        self.value = value

    def json(self):
        return self.value


class FakeRunSession:
    def __init__(self, executions):
        self.executions = executions
        self.requests = []

    def post(self, url, *, json, timeout):
        self.requests.append((url, json, timeout))
        return FakeResponse({"name": "operations/op-1", "metadata": {"name": "executions/ex-1"}})

    def get(self, url, *, timeout):
        return FakeResponse({"executions": self.executions})


def test_cloud_tasks_queue_can_boot_before_private_url_exists(monkeypatch):
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    monkeypatch.delenv("BLINK_ORCHESTRATION_URL", raising=False)
    queue = CloudTasksQueue(client=object(), service_account="blink3-tasks@example.iam.gserviceaccount.com")
    assert queue.project == "spherex-blink"
    assert queue.service_url == ""
    with pytest.raises(WorkflowError, match="orchestration URL is not configured"):
        queue.enqueue("/internal/tasks/discover", {}, "discover")


def test_cloud_tasks_request_uses_task_level_dispatch_deadline():
    class Client:
        request = None

        def queue_path(self, project, region, queue):
            return f"projects/{project}/locations/{region}/queues/{queue}"

        def create_task(self, *, request):
            self.request = request
            return type("Task", (), {"name": request["task"]["name"]})()

    client = Client()
    queue = CloudTasksQueue(
        client=client, project="p", region="europe-west1", queue="q",
        service_url="https://orchestrator.example", service_account="tasks@example.iam.gserviceaccount.com",
    )

    task_name = queue.enqueue("/internal/tasks/discover", {"requestId": "fr-test"}, "discover-test")

    task = client.request["task"]
    assert task_name.endswith("/tasks/discover-test")
    assert task["dispatch_deadline"] == {"seconds": 1800}
    assert "dispatch_deadline" not in task["http_request"]


def _votable_all_detectors():
    fields = ["obs_collection", "energy_bandpassname", "t_min", "obs_id", "access_url", "access_format", "access_estsize"]
    declarations = "".join(f'<FIELD name="{name}" datatype="char" arraysize="*"/>' for name in fields)
    rows = "".join(
        "<TR>" + "".join(f"<TD>{value}</TD>" for value in (
            "spherex_dr1", f"SPHEREx-D{i}", str(61000 + i), f"obs-d{i}",
            f"https://irsa.ipac.caltech.edu/ibe/data/spherex/obs-d{i}.fits",
            "application/fits", "10",
        )) + "</TR>"
        for i in range(1, 7)
    )
    return f"<VOTABLE><RESOURCE><TABLE>{declarations}<DATA><TABLEDATA>{rows}</TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>".encode()


def test_detector_plan_is_written_once_and_dispatches_only_the_missing_detector(tmp_path, monkeypatch):
    approved = tmp_path / "approved.json"
    approved.write_text(json.dumps({"approved": []}))
    monkeypatch.setenv("BLINK_APPROVED_FILE", str(approved))
    normalized = normalize_request({"ra": 10, "dec": -10, "fov": 5})
    detectors = {
        detector: {"status": "queued", "progress": 0.0, "attempt": 0}
        for detector in DETECTORS
    }
    request = {
        "requestId": normalized["requestId"], "fieldKey": normalized["fieldKey"],
        "query": normalized["query"], "collection": normalized["collection"],
        "processingVersion": normalized["processingVersion"], "samplingMode": normalized["samplingMode"],
        "policyVersion": "policy-v1",
        "selection": "latest", "metadataKey": "requests/test/archive-metadata.json",
        "detectors": detectors,
    }
    row = {
        "obs_collection": "spherex_dr1", "energy_bandpassname": "SPHEREx-D1",
        "t_min": "61000", "obs_id": "obs-d1", "access_url": "https://irsa.ipac.caltech.edu/ibe/data/spherex/obs-d1.fits",
        "access_format": "application/fits", "access_estsize": "10",
    }
    policy = {
        "version": "policy-v1", "acknowledgement": "Approved official SPHEREx DR1 acknowledgement.", "dataDoi": "10.26131/IRSA678",
        "maxObservationsPerDetector": 12, "maxFileBytes": 32 * 1024**2,
        "maxTotalBytesPerDetector": 128 * 1024**2,
    }
    store, tasks = FakeStore([row]), FakeTasks()
    workflow = CloudWorkflow(state=FakeState(request, policy), tasks=tasks,
                             launcher=object(), store=store, max_active_jobs=3)

    assert workflow.plan_detector(request["requestId"], "D1", request["metadataKey"], "plan-test") == "queued"
    assert workflow.plan_detector(request["requestId"], "D1", request["metadataKey"], "duplicate") == "already-planned"
    assert request["detectors"]["D1"]["status"] == "queued"
    assert request["detectors"]["D1"]["totalFiles"] == 1
    assert request["detectors"]["D1"]["samplingMode"] == "monthly"
    assert request["detectors"]["D1"]["requestedMonths"]
    assert request["detectors"]["D1"]["planKey"] == f"plans/{request['requestId']}/d1.json"
    stored_plan = store.json(request["detectors"]["D1"]["planKey"])
    assert stored_plan["samplingMode"] == "monthly"
    assert len(stored_plan["requestedMonths"]) == 1
    assert stored_plan["monthGroups"][0]["obsIds"] == ["obs-d1"]
    assert len(tasks.enqueued) == 1
    assert tasks.enqueued[0][0] == "/internal/tasks/detector"
    assert tasks.enqueued[0][1] == {"requestId": request["requestId"], "detector": "D1"}
    assert all(item["status"] == "queued" for item in request["detectors"].values() if item is not request["detectors"]["D1"])


def test_emergency_disable_keeps_existing_exact_cache_queryable_but_blocks_new_work():
    normalized = normalize_request({"ra": 10, "dec": -10, "fov": 5})
    policy = {
        "enabled": False, "allowedCollections": ["spherex_dr1"],
        "processingVersion": normalized["processingVersion"],
        "version": "policy-v1", "collection": "spherex_dr1", "termsChecked": True,
        "acknowledgement": "Approved official SPHEREx DR1 acknowledgement.", "dataDoi": "10.26131/IRSA678",
    }
    request = {
        "requestId": normalized["requestId"], "status": "ready", "progress": 1.0,
        "query": normalized["query"], "detectors": {det: {"status": "ready"} for det in DETECTORS},
    }
    tasks = FakeTasks()
    facade = PublicFieldRequests(state=FakeState(request, policy), tasks=tasks)
    cached = facade.submit({"ra": 10, "dec": -10, "fov": 5})
    assert cached["cached"] is True
    assert cached["status"] == "ready"
    assert tasks.enqueued == []

    facade = PublicFieldRequests(state=FakeState({}, policy), tasks=tasks)
    try:
        facade.submit({"ra": 11, "dec": -10, "fov": 5})
    except WorkflowError as error:
        assert error.status_code == 503
    else:
        raise AssertionError("emergency disable must block new acquisition requests")


def test_repeated_queued_request_retries_idempotent_discovery_enqueue():
    normalized = normalize_request({"ra": 10, "dec": -10, "fov": 5})
    policy = {
        "enabled": True, "allowedCollections": ["spherex_dr1"],
        "processingVersion": normalized["processingVersion"],
        "version": "policy-v1", "collection": "spherex_dr1", "termsChecked": True,
        "acknowledgement": "Approved official SPHEREx DR1 acknowledgement.",
        "dataDoi": "10.26131/IRSA678",
    }
    request = {
        "requestId": normalized["requestId"], "status": "queued",
        "query": normalized["query"], "detectors": {det: {"status": "queued"} for det in DETECTORS},
    }
    tasks = FakeTasks()
    facade = PublicFieldRequests(state=FakeState(request, policy), tasks=tasks)

    result = facade.submit({"ra": 10, "dec": -10, "fov": 5})

    assert result["requestId"] == normalized["requestId"]
    assert len(tasks.enqueued) == 1
    assert tasks.enqueued[0][0] == "/internal/tasks/discover"
    assert tasks.enqueued[0][2] == f"discover-{normalized['requestId']}-a0"


def test_discovery_generates_one_idempotent_plan_task_for_each_detector(tmp_path, monkeypatch):
    approved = tmp_path / "approved.json"
    approved.write_text(json.dumps({"approved": []}))
    monkeypatch.setenv("BLINK_APPROVED_FILE", str(approved))
    normalized = normalize_request({"ra": 10, "dec": -10, "fov": 5})
    request = {
        "requestId": normalized["requestId"], "fieldKey": normalized["fieldKey"],
        "query": normalized["query"], "collection": normalized["collection"],
        "processingVersion": normalized["processingVersion"], "samplingMode": normalized["samplingMode"],
        "policyVersion": "policy-v1", "status": "queued",
        "detectors": {det: {"status": "queued", "attempt": 0} for det in DETECTORS},
    }
    policy = {"version": "policy-v1", "acknowledgement": "Approved official SPHEREx DR1 acknowledgement.", "dataDoi": "10.26131/IRSA678",
              "maxObservationsPerDetector": 12, "maxFileBytes": 32 * 1024**2,
              "maxTotalBytesPerDetector": 128 * 1024**2}
    store, tasks, calls = FakeStore([]), FakeTasks(), []
    workflow = CloudWorkflow(state=FakeState(request, policy), tasks=tasks,
                             launcher=object(), store=store,
                             archive_fetch=lambda url: (calls.append(url) or _votable_all_detectors()))

    workflow.discover(request["requestId"], "discover-test")
    workflow.discover(request["requestId"], "duplicate-delivery")
    planned = [payload["detector"] for path, payload, _name in tasks.enqueued if path == "/internal/tasks/plan"]
    assert len(calls) == 1
    assert len(planned) == 12  # Duplicate delivery re-enqueues stable task names; Cloud Tasks deduplicates them.
    assert set(planned) == set(DETECTORS)
    assert len({name for _path, _payload, name in tasks.enqueued}) == 6
    assert request["metadataKey"] == f"requests/{request['requestId']}/archive-metadata.json"


def _metadata_request_fixture():
    normalized = normalize_request({"ra": 10, "dec": -10, "fov": 5})
    request = {
        "requestId": normalized["requestId"], "status": "queued",
        "query": normalized["query"], "collection": normalized["collection"],
        "detectors": {det: {"status": "queued", "progress": 0.0, "attempt": 0} for det in DETECTORS},
    }
    policy = {"version": "policy-v1", "acknowledgement": "Approved official SPHEREx DR1 acknowledgement.",
              "dataDoi": "10.26131/IRSA678"}
    return request, policy


@pytest.mark.parametrize("http_status", [408, 429, 500, 502, 503, 504])
def test_transient_metadata_http_errors_are_persisted_and_retried(http_status):
    request, policy = _metadata_request_fixture()
    state, tasks = FakeState(request, policy), FakeTasks()
    error = HTTPError("https://irsa.ipac.caltech.edu/SIA", http_status, "Temporary archive error",
                      {"Retry-After": "17"}, BytesIO())
    workflow = CloudWorkflow(state=state, tasks=tasks, launcher=object(), store=FakeStore([]),
                             archive_fetch=lambda _url: (_ for _ in ()).throw(error))

    with pytest.raises(WorkflowError, match="temporarily unavailable") as raised:
        workflow.discover(request["requestId"], "discover-test")

    assert raised.value.status_code == 503
    assert raised.value.retry_after == 17
    assert request["metadataAttemptCount"] == 1
    assert request["metadataRetrying"] is True
    assert request["metadataHttpStatus"] == http_status
    assert "Cloud Tasks will retry" in request["metadataError"]
    assert all(item["phase"] == "metadata-retrying" for item in request["detectors"].values())
    assert not state.locks
    assert tasks.enqueued == []

    status = PublicFieldRequests(state=state, tasks=tasks).status(request["requestId"])
    assert status["metadataRetrying"] is True
    assert status["metadataAttemptCount"] == 1
    assert status["metadataHttpStatus"] == http_status


def test_metadata_retry_success_clears_error_and_continues_planning():
    request, policy = _metadata_request_fixture()
    state, tasks = FakeState(request, policy), FakeTasks()
    error = HTTPError("https://irsa.ipac.caltech.edu/SIA", 503, "Unavailable",
                      {"Retry-After": "5"}, BytesIO())
    calls = 0

    def fetch(_url):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise error
        return _votable_all_detectors()

    workflow = CloudWorkflow(state=state, tasks=tasks, launcher=object(), store=FakeStore([]), archive_fetch=fetch)
    with pytest.raises(WorkflowError):
        workflow.discover(request["requestId"], "discover-first")

    workflow.discover(request["requestId"], "discover-second")

    assert request["metadataAttemptCount"] == 2
    assert request["metadataRetrying"] is False
    assert request["metadataError"] is None
    assert request["metadataHttpStatus"] is None
    assert request["metadataKey"] == f"requests/{request['requestId']}/archive-metadata.json"
    assert len([item for item in tasks.enqueued if item[0] == "/internal/tasks/plan"]) == 6


def test_permanent_metadata_http_error_fails_request_without_retrying():
    request, policy = _metadata_request_fixture()
    state, tasks = FakeState(request, policy), FakeTasks()
    error = HTTPError("https://irsa.ipac.caltech.edu/SIA", 404, "Not Found", {}, BytesIO())
    workflow = CloudWorkflow(state=state, tasks=tasks, launcher=object(), store=FakeStore([]),
                             archive_fetch=lambda _url: (_ for _ in ()).throw(error))

    assert workflow.discover(request["requestId"], "discover-test") == "failed"

    assert request["status"] == "failed"
    assert request["metadataRetrying"] is False
    assert request["metadataHttpStatus"] == 404
    assert all(item["status"] == "failed" for item in request["detectors"].values())
    assert tasks.enqueued == []


def test_metadata_retry_limit_fails_terminally_and_explicit_retry_starts_a_fresh_attempt():
    request, policy = _metadata_request_fixture()
    request["metadataAttemptCount"] = 99
    state, tasks = FakeState(request, policy), FakeTasks()
    error = HTTPError("https://irsa.ipac.caltech.edu/SIA", 503, "Unavailable", {}, BytesIO())
    workflow = CloudWorkflow(state=state, tasks=tasks, launcher=object(), store=FakeStore([]),
                             archive_fetch=lambda _url: (_ for _ in ()).throw(error))

    assert workflow.discover(request["requestId"], "discover-final") == "failed"
    assert request["metadataAttemptCount"] == 100
    assert request["metadataRetrying"] is False
    assert request["phase"] == "metadata-failed"
    assert all(item["status"] == "failed" for item in request["detectors"].values())
    assert not state.locks
    assert tasks.enqueued == []

    PublicFieldRequests(state=state, tasks=tasks).retry(request["requestId"])
    assert request["metadataAttemptCount"] == 0
    assert request["metadataRetrying"] is False
    assert request["metadataError"] is None
    assert request["status"] == "queued"
    assert any(path == "/internal/tasks/discover" for path, _, _ in tasks.enqueued)


def test_cloud_run_v2_launch_overrides_and_execution_discovery():
    request_id, detector, attempt = "fr-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "D3", 2
    session = FakeRunSession([{
        "name": "projects/p/locations/europe-west1/jobs/blink3-prepare/executions/ex-1",
        "template": {"containers": [{"args": [
            "--stored-plan", "--plan", "plans/field/d3.json", "--confirm-download",
            "--request-id", request_id, "--detector", detector, "--attempt", str(attempt),
        ]}]},
    }])
    launcher = CloudRunJobLauncher(session=session, project="p", region="europe-west1", job="blink3-prepare")
    launched = launcher.launch(request_id, detector, "plans/field/d3.json", attempt)
    assert launched["executionName"] == "executions/ex-1"
    url, payload, timeout = session.requests[0]
    assert url.endswith("/jobs/blink3-prepare:run")
    assert payload["overrides"]["containerOverrides"][0]["args"][-2:] == ["--attempt", "2"]
    assert timeout == 30
    assert launcher.find_execution(request_id, detector, attempt).endswith("/executions/ex-1")


def test_cloud_run_cancelled_execution_is_terminal_for_slot_reconciliation():
    session = FakeRunSession([])
    session.get = lambda _url, timeout: FakeResponse({"conditions": [
        {"type": "Completed", "state": "CONDITION_FAILED", "executionReason": "CANCELLED",
         "message": "Cancelled by user."},
    ]})
    launcher = CloudRunJobLauncher(session=session, project="p", region="europe-west1", job="blink3-prepare")
    assert launcher.execution_status("projects/p/locations/europe-west1/jobs/j/executions/e") == "cancelled"


def test_detector_dispatch_uses_owner_limit_and_persists_starting_state():
    normalized = normalize_request({"ra": 10, "dec": -10, "fov": 5})
    request = {
        "requestId": normalized["requestId"],
        "detectors": {"D1": {"status": "queued", "attempt": 0, "planKey": "plans/test/d1.json"}},
    }
    policy = {"enabled": True, "maxConcurrentDownloads": 20}

    class Launcher:
        def launch(self, request_id, detector, plan_key, attempt):
            assert (request_id, detector, plan_key, attempt) == (normalized["requestId"], "D1", "plans/test/d1.json", 1)
            return {"executionName": "executions/test"}

    state = FakeState(request, policy)
    workflow = CloudWorkflow(state=state, tasks=FakeTasks(), launcher=Launcher(), store=FakeStore([]))

    assert workflow.dispatch_detector(normalized["requestId"], "D1") == "launched"
    assert state.max_active == 20
    assert request["detectors"]["D1"]["status"] == "downloading"
    assert request["detectors"]["D1"]["attempt"] == 1
