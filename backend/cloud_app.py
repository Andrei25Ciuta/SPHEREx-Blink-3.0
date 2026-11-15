"""Cloud serving only. Existing app.py remains the local FITS backend."""

from collections import OrderedDict
from contextlib import contextmanager
import hashlib
import json
import math
import os
import re
from pathlib import Path
import tempfile
import threading
import time
from urllib.parse import urlsplit

from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from spherex.storage import from_env, StoreError, download_verified
from spherex.query import read_frame_file
from spherex.photometry import measure
from spherex.cloud_workflow import WorkflowError, workflow_from_env
from spherex.firestore_state import StateUnavailable
from spherex.manifest import validate_manifest


class Guard:
    """Bound the entire response lifetime, not just the time until response headers."""

    def __init__(self, app, concurrent=8):
        self.app, self.concurrent = app, concurrent
        self.inflight = 0

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] == "OPTIONS":
            return await self.app(scope, receive, send)
        code = None
        if scope["method"] not in ("GET", "POST"):
            code, detail = 405, "This method is not supported."
        elif len(scope.get("query_string", b"")) > 2048:
            code, detail = 414, "Query is too long."
        elif int(dict(scope.get("headers", [])).get(b"content-length", b"0") or 0) > 16384:
            code, detail = 413, "Request body is too large."
        elif self.inflight >= self.concurrent:
            code, detail = 503, "Server busy. Retry shortly."
        if code:
            return await JSONResponse(
                {"detail": detail}, status_code=code, headers={"Retry-After": "60"}
            )(scope, receive, send)
        self.inflight += 1
        try:
            await self.app(scope, receive, send)
        finally:
            self.inflight -= 1


class Catalog:
    def __init__(self, store, approved, pixels, registry=None):
        self.store, self.approved, self.pixels = store, approved, pixels
        self.registry = registry
        self.docs = None
        self.dynamic_docs = OrderedDict()
        self.lock = threading.RLock()
        self.bytes = OrderedDict()
        self.cache_size = 0
        self.measure_lock = threading.Lock()

    def load(self):
        with self.lock:
            if self.docs is not None:
                return self.docs
            docs = {}
            for entry in self.approved:
                if entry.get("termsChecked") is not True:
                    continue
                doc = self.store.json(entry["manifest"])
                validate_manifest(doc)
                if (
                    doc.get("version") != 1
                    or doc["sequenceId"] != entry["sequenceId"]
                    or doc.get("termsChecked") is not True
                    or not doc.get("acknowledgement")
                    or not 1 <= len(doc["frames"]) <= 24
                ):
                    raise StoreError("Invalid approved sequence")
                if doc["sequenceId"] in docs:
                    raise StoreError("Duplicate approved sequence")
                docs[doc["sequenceId"]] = doc
            self.docs = docs
            return docs

    def doc(self, sid):
        doc = self.load().get(sid)
        if doc is None and self.registry is not None:
            with self.lock:
                cached = self.dynamic_docs.get(sid)
                if cached:
                    self.dynamic_docs.move_to_end(sid)
                    return cached
            pointer = self.registry.catalog_doc(sid)
            if pointer:
                doc = self.store.json(pointer["manifest"], limit=2 * 1024**2)
                validate_manifest(doc)
                if (doc.get("sequenceId") != sid or doc.get("revision") != pointer.get("revision")
                        or doc.get("termsChecked") is not True or not doc.get("acknowledgement")):
                    raise StoreError("Dynamic catalog pointer does not match its manifest")
                with self.lock:
                    self.dynamic_docs[sid] = doc
                    while len(self.dynamic_docs) > 128:
                        self.dynamic_docs.popitem(last=False)
                return doc
        if doc is None:
            raise HTTPException(404, "No prepared sequence with that ID.")
        return doc

    def matching(self, ra, dec, fov, det="all", request_id=None):
        if request_id and self.registry is not None:
            docs = []
            request = self.registry.get_request(request_id)
            for detector, state in (request or {}).get("detectors", {}).items():
                if state.get("status") != "ready" or not state.get("sequenceId"):
                    continue
                if det not in ("all", detector):
                    continue
                doc = self.doc(state["sequenceId"])
                q = doc["query"]
                if (abs(q["ra"]-ra) < 1e-7 and abs(q["dec"]-dec) < 1e-7
                        and abs(q["fov"]-fov) < 1e-7):
                    docs.append(doc)
            return docs
        by_detector = {}
        for doc in self.load().values():
            q = doc["query"]
            if (abs(q["ra"]-ra) < 1e-7 and abs(q["dec"]-dec) < 1e-7
                    and abs(q["fov"]-fov) < 1e-7 and det in ("all", q["det"])):
                current = by_detector.get(q["det"])
                if current is None or self._latest_mjd(doc) > self._latest_mjd(current):
                    by_detector[q["det"]] = doc
        if self.registry is not None:
            for pointer in self.registry.catalog_for_field(ra, dec, fov, det, limit=1):
                doc = self.doc(pointer["sequenceId"])
                detector = doc["query"]["det"]
                current = by_detector.get(detector)
                if current is None or self._latest_mjd(doc) > self._latest_mjd(current):
                    by_detector[detector] = doc
        return [by_detector[detector] for detector in sorted(by_detector)]

    @staticmethod
    def _latest_mjd(doc):
        values = [item.get("mjd") for item in doc.get("originals", [])]
        return max((float(value) for value in values if value is not None), default=float("-inf"))

    def containing(self, ra, dec, det="all"):
        docs = list(self.load().values())
        if self.registry is not None:
            token = None
            while True:
                dynamic, token = self.registry.list_catalog(100, token)
                docs.extend(self.doc(item["sequenceId"]) for item in dynamic)
                if not token:
                    break
        matches = []
        for doc in docs:
            q = doc["query"]
            dra = (ra - q["ra"] + 180) % 360 - 180
            distance = math.hypot(dra * math.cos(math.radians(dec)), dec - q["dec"])
            if det in ("all", q["det"]) and distance <= q["fov"] / 120:
                matches.append(doc)
        return matches

    def require_pixels(self):
        if not self.pixels:
            raise HTTPException(
                403, "Real image serving is not enabled for this release."
            )

    def asset(self, sid, name):
        self.require_pixels()
        asset = self.doc(sid)["assets"].get(name)
        if not asset:
            raise HTTPException(404, "No such product.")
        key = asset["key"]
        with self.lock:
            if key in self.bytes:
                self.bytes.move_to_end(key)
                return self.bytes[key]
        payload = self.store.read(key, limit=8 * 1024**2)
        if (
            len(payload) != asset["sizeBytes"]
            or hashlib.sha256(payload).hexdigest() != asset["sha256"]
        ):
            raise StoreError("Product checksum mismatch")
        with self.lock:
            if key not in self.bytes:
                self.bytes[key] = payload
                self.cache_size += len(payload)
            while self.cache_size > 128 * 1024**2:
                _, gone = self.bytes.popitem(last=False)
                self.cache_size -= len(gone)
        return payload

    @contextmanager
    def originals(self, doc):
        self.require_pixels()
        if not self.measure_lock.acquire(blocking=False):
            raise HTTPException(503, "A measurement is already running. Retry shortly.")
        try:
            inputs = doc["originals"]
            if len(inputs) > 24 or sum(x["sizeBytes"] for x in inputs) > 128 * 1024**2:
                raise HTTPException(
                    422,
                    "This sequence exceeds the interactive measurement input limit.",
                )
            with tempfile.TemporaryDirectory(prefix="blink-measure-") as tmp:
                frames = []
                for i, item in enumerate(inputs):
                    path = Path(tmp) / (
                        f"{i}.fits.gz" if item["key"].endswith(".gz") else f"{i}.fits"
                    )
                    download_verified(self.store, item, path, 128 * 1024**2)
                    frame = read_frame_file(path)
                    if doc["dataKind"] == "synthetic":
                        frame.provenance = "synthetic"
                    frames.append(frame)
                yield frames
        finally:
            self.measure_lock.release()


def create_app(
    store=None, approved=None, *, pixels=None, origins=None, public_base=None,
    rate=None, workflow=None, registry=None
):
    store = store if store is not None else from_env()
    if approved is None:
        path = Path(
            os.getenv(
                "BLINK_APPROVED_FILE",
                Path(__file__).with_name("approved_sequences.json"),
            )
        )
        approved = json.loads(path.read_text())["approved"]
    if pixels is None:
        pixels = os.getenv("BLINK_SERVE_PIXELS", "false") == "true"
    public_base = (
        public_base
        if public_base is not None
        else os.getenv("BLINK_PUBLIC_BASE_URL", "")
    )
    if public_base and (
        urlsplit(public_base).scheme != "https"
        or not urlsplit(public_base).hostname
        or urlsplit(public_base).path not in ("", "/")
        or urlsplit(public_base).username
        or urlsplit(public_base).query
        or urlsplit(public_base).fragment
    ):
        raise ValueError("BLINK_PUBLIC_BASE_URL must be an HTTPS origin")
    origins = (
        origins
        if origins is not None
        else [
            s.strip()
            for s in os.getenv("BLINK_CORS_ORIGINS", "http://localhost:8765").split(",")
        ]
    )
    if "*" in origins:
        raise ValueError("Cloud CORS must list explicit origins")
    workflow = workflow if workflow is not None else workflow_from_env()
    registry = registry if registry is not None else (workflow.state if workflow else None)
    catalog = Catalog(store, approved, pixels, registry)
    app = FastAPI(
        title="SPHEREx Blink prepared observations",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.catalog = catalog
    app.add_middleware(Guard)
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"])
    app.state.workflow = workflow

    @app.exception_handler(StoreError)
    async def store_failure(request, exc):
        return JSONResponse(
            {"detail": "Prepared data could not be read. Retry later."}, status_code=503
        )

    @app.exception_handler(ValueError)
    async def bad_value(request, exc):
        return JSONResponse(
            {"detail": "Invalid request or product metadata."}, status_code=400
        )

    @app.exception_handler(WorkflowError)
    async def workflow_failure(request, exc):
        headers = {"Retry-After": "5"} if exc.status_code in (429, 503) else None
        return JSONResponse({"detail": str(exc)}, status_code=exc.status_code, headers=headers)

    @app.exception_handler(StateUnavailable)
    async def acquisition_unavailable(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=503, headers={"Retry-After": "60"})

    def require_workflow():
        if workflow is None:
            raise HTTPException(503, "On-demand acquisition is not configured yet.")
        return workflow

    @app.post("/api/field-requests")
    def create_field_request(payload: dict = Body(...)):
        from spherex.field_requests import RequestValidationError
        try:
            return require_workflow().submit(payload)
        except RequestValidationError as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.get("/api/field-requests/{request_id}")
    def field_request_status(request_id: str):
        if not re.fullmatch(r"fr-[a-f0-9]{32}", request_id):
            raise HTTPException(422, "Invalid field request ID.")
        return require_workflow().status(request_id)

    @app.post("/api/field-requests/{request_id}/retry")
    def retry_field_request(request_id: str):
        if not re.fullmatch(r"fr-[a-f0-9]{32}", request_id):
            raise HTTPException(422, "Invalid field request ID.")
        return require_workflow().retry(request_id)

    def summary(doc):
        return {
            k: doc[k]
            for k in (
                "sequenceId",
                "query",
                "dataKind",
                "collection",
                "revision",
                "acknowledgement",
            )
        }

    def frames_for(doc, request):
        catalog.require_pixels()
        base = (
            public_base.rstrip("/")
            if public_base
            else str(request.base_url).rstrip("/")
        )
        frames = []
        for f in doc["frames"]:
            result = dict(f)
            for k in ("imageUrl", "flagsUrl", "dataUrl", "maskUrl"):
                result[k] = (
                    f"{base}/api/sequences/{doc['sequenceId']}/assets/{doc['revision']}/{f[k]}"
                    if f.get(k)
                    else None
                )
            result["sequenceId"] = doc["sequenceId"]
            result["dataKind"] = doc["dataKind"]
            frames.append(result)
        return frames

    @app.get("/api/health")
    def health():
        docs = catalog.load()
        return {
            "profile": "prepared",
            "source": "cloud" if os.getenv("BLINK_GCS_BUCKET") else "local",
            "sequenceCount": len(docs),
            "servePixels": pixels,
            "status": "ok",
        }

    @app.get("/api/sequences")
    def sequences(limit: int = Query(50, ge=1, le=100), page_token: str | None = None):
        static = list(catalog.load().values()) if not page_token else []
        remaining = max(1, limit - len(static))
        dynamic, next_token = registry.list_catalog(remaining, page_token) if registry else ([], None)
        docs = static + [catalog.doc(item["sequenceId"]) for item in dynamic]
        result = {"sequences": [summary(d) for d in docs]}
        if next_token:
            result["nextPageToken"] = next_token
        return result

    @app.get("/api/sequences/{sid}")
    def sequence(sid: str, request: Request):
        doc = catalog.doc(sid)
        return {
            **summary(doc),
            "frames": frames_for(doc, request),
            "processingVersion": doc["processingVersion"],
        }

    @app.get("/api/sequences/{sid}/assets/{revision}/{name}")
    def asset(sid: str, revision: str, name: str):
        if revision != catalog.doc(sid)["revision"]:
            raise HTTPException(404, "No such product revision.")
        return Response(
            catalog.asset(sid, name),
            media_type="image/png"
            if name.endswith(".png")
            else "application/octet-stream",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    @app.get("/api/cutouts")
    def cutouts(
        request: Request,
        ra: float = Query(..., ge=0, lt=360),
        dec: float = Query(..., ge=-90, le=90),
        fov: float = Query(5, ge=1, le=10),
        det: str = "all",
        request_id: str | None = Query(None, alias="request_id"),
    ):
        if det not in ("all", "D1", "D2", "D3", "D4", "D5", "D6"):
            raise HTTPException(422, "Unknown detector.")

        if request_id and not re.fullmatch(r"fr-[a-f0-9]{32}", request_id):
            raise HTTPException(422, "Invalid field request ID.")
        frames = []
        for doc in catalog.matching(ra, dec, fov, det, request_id):
            frames.extend(frames_for(doc, request))

        if not frames:
            raise HTTPException(422, "This field, size or detector is not prepared.")

        frames.sort(key=lambda f: (f["mjd"], f["detector"]))

        return {"frames": frames}

    @app.get("/api/photometry")
    def photometry(
        ra: float = Query(..., ge=0, lt=360),
        dec: float = Query(..., ge=-90, le=90),
        det: str = "all",
        radius: float = Query(2, ge=0.5, le=6),
        epoch_mjd: float | None = None,
        pm_east: float = 0,
        pm_north: float = 0,
    ):
        if (
            not all(math.isfinite(x) for x in (ra, dec, pm_east, pm_north))
            or epoch_mjd is not None
            and not math.isfinite(epoch_mjd)
        ):
            raise HTTPException(400, "Invalid motion parameters.")
        if det not in ("all", "D1", "D2", "D3", "D4", "D5", "D6"):
            raise HTTPException(422, "Unknown detector.")
        points = []
        for doc in catalog.containing(ra, dec, det):
            q = doc["query"]
            dra = (ra - q["ra"] + 180) % 360 - 180
            if (
                det in ("all", q["det"])
            ):
                motion = (
                    None
                    if epoch_mjd is None
                    else {
                        "epoch_mjd": epoch_mjd,
                        "pm_east": pm_east,
                        "pm_north": pm_north,
                    }
                )
                with catalog.originals(doc) as frames:
                    # Aggregate every matching detector; never stop at the first sequence.
                    points.extend(measure(frames, ra, dec, radius, motion))
        if not points:
            raise HTTPException(422, "Measurement position is outside the prepared sequences.")
        points.sort(key=lambda point: (point.get("mjd", 0), point.get("detector", "")))
        return {"points": points}

    @app.get("/api/{path:path}")
    def unavailable(path: str):
        if path in (
            "footprints",
            "survey",
            "catalogue",
            "observations",
        ) or path.startswith("hips/"):
            raise HTTPException(
                501,
                "This prepared-data service does not provide that local-backend feature.",
            )
        raise HTTPException(404, "No such endpoint.")

    return app


app = create_app()
