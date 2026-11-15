"""Private Cloud Tasks target for field discovery, execution dispatch and recovery."""
import os
import re

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from spherex.cloud_limits import MAX_ACTIVE_DOWNLOAD_JOBS
from spherex.cloud_workflow import CloudWorkflow, WorkflowError
from spherex.firestore_state import StateUnavailable

app = FastAPI(title="SPHEREx Blink private orchestrator", docs_url=None, redoc_url=None, openapi_url=None)
workflow = CloudWorkflow(max_active_jobs=int(os.getenv(
    "BLINK_MAX_ACTIVE_DOWNLOAD_JOBS", str(MAX_ACTIVE_DOWNLOAD_JOBS))))


@app.exception_handler(WorkflowError)
async def workflow_failure(request, exc):
    headers = {}
    if exc.status_code in (429, 503):
        headers["Retry-After"] = str(exc.retry_after or 5)
    return JSONResponse({"detail": str(exc)}, status_code=exc.status_code,
                        headers=headers)


@app.exception_handler(StateUnavailable)
async def state_failure(request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=503, headers={"Retry-After": "60"})


async def task_payload(request: Request):
    email = os.getenv("BLINK_TASK_SERVICE_ACCOUNT", "")
    audience = os.getenv("BLINK_ORCHESTRATION_URL", "").rstrip("/")
    if not email or not audience:
        raise HTTPException(503, "Task identity configuration is missing.")
    # JWT verification may fetch Google's signing certificates; keep that
    # synchronous network operation off the ASGI event loop.
    await run_in_threadpool(workflow.validate_task_request, request, audience, email)
    try:
        return await request.json()
    except Exception as exc:
        raise HTTPException(400, "Task body must be valid JSON.") from exc


@app.post("/internal/tasks/discover")
async def discover(request: Request):
    payload = await task_payload(request)
    request_id = payload.get("requestId", "")
    if not re.fullmatch(r"fr-[a-f0-9]{32}", request_id):
        raise HTTPException(400, "Invalid request ID.")
    await run_in_threadpool(workflow.discover, request_id, payload.get("leaseId"))
    return {"accepted": True}


@app.post("/internal/tasks/detector")
async def detector(request: Request):
    payload = await task_payload(request)
    request_id, detector_id = payload.get("requestId", ""), payload.get("detector", "")
    if not re.fullmatch(r"fr-[a-f0-9]{32}", request_id) or detector_id not in ("D1", "D2", "D3", "D4", "D5", "D6"):
        raise HTTPException(400, "Invalid detector task.")
    result = await run_in_threadpool(workflow.dispatch_detector, request_id, detector_id)
    if result == "retry":
        raise HTTPException(503, "Global detector execution slots are busy; retry shortly.")
    return {"result": result}


@app.post("/internal/tasks/plan")
async def plan(request: Request):
    payload = await task_payload(request)
    request_id, detector_id = payload.get("requestId", ""), payload.get("detector", "")
    metadata_key = payload.get("metadataKey", "")
    if (not re.fullmatch(r"fr-[a-f0-9]{32}", request_id)
            or detector_id not in ("D1", "D2", "D3", "D4", "D5", "D6")
            or not re.fullmatch(r"requests/fr-[a-f0-9]{32}/archive-metadata\.json", metadata_key)):
        raise HTTPException(400, "Invalid detector planning task.")
    result = await run_in_threadpool(
        workflow.plan_detector, request_id, detector_id, metadata_key, payload.get("leaseId"))
    return {"result": result}


@app.post("/internal/tasks/reconcile")
async def reconcile(request: Request):
    await task_payload(request)
    return await run_in_threadpool(workflow.reconcile)


@app.get("/internal/health")
def health():
    return {"status": "ok", "service": "private-orchestrator"}
