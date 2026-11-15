"""Operator-only retrieval + unchanged 3.0 processing. Publish the manifest last."""

import random
from email.utils import parsedate_to_datetime
import argparse
from datetime import datetime, timezone
import http.client
import hashlib
import json
import math
import os
from pathlib import Path
import re
import tempfile
import time
import uuid
from urllib.error import HTTPError, URLError

import numpy as np

from .archive_plan import MAX_PLAN_CANDIDATES, open_archive, safe_url
from .products import build, MIN_VALID_FRACTION
from .cutout import cutout, target_wcs
from .query import read_frame_file
from .storage import from_env, digest_file

ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
CODE_VERSION = "blink3-cloud-3"


def validate_plan(p):
    if p.get("version") != 1 or not ID.fullmatch(p.get("sequenceId", "")):
        raise ValueError("Invalid retrieval plan")
    q = p["query"]
    if not (
        0 <= q["ra"] < 360
        and -90 <= q["dec"] <= 90
        and 1 <= q["fov"] <= 10
        and q["det"] in [f"D{i}" for i in range(1, 7)]
    ):
        raise ValueError("Invalid field")
    files = p["files"]
    if not 1 <= len(files) <= 24 or len({f["obsId"] for f in files}) != len(files):
        raise ValueError("Invalid number of files or duplicate observation IDs")
    if len({f["name"] for f in files}) != len(files):
        raise ValueError("Duplicate filenames")
    for f in files:
        safe_url(f["url"])
        if not re.fullmatch(r"[A-Za-z0-9_-]+\.fits(?:\.gz)?", f["name"]):
            raise ValueError("Invalid filename")
        if not math.isfinite(f["mjd"]):
            raise ValueError("Invalid time")
    if p.get("samplingMode") == "monthly":
        groups = p.get("monthGroups")
        months = p.get("requestedMonths")
        if (len(files) > MAX_PLAN_CANDIDATES
                or not isinstance(groups, list) or not isinstance(months, list) or not months
                or len(months) > 12 or len(set(months)) != len(months)
                or months != sorted(months) or any(not MONTH.fullmatch(month) for month in months)):
            raise ValueError("Invalid monthly observation groups")
        records = {item["obsId"]: item for item in files}
        grouped_ids = []
        grouped_months = []
        for group in groups:
            month, obs_ids = group.get("month"), group.get("obsIds")
            if month not in months or not isinstance(obs_ids, list) or not obs_ids:
                raise ValueError("Invalid monthly candidate group")
            if month in grouped_months:
                raise ValueError("Duplicate monthly candidate group")
            grouped_months.append(month)
            if len(set(obs_ids)) != len(obs_ids) or any(obs_id not in records for obs_id in obs_ids):
                raise ValueError("Monthly candidate group references an unknown observation")
            for obs_id in obs_ids:
                if records[obs_id].get("month") != month:
                    raise ValueError("Monthly candidate has the wrong UTC month")
                actual_month = datetime.fromtimestamp(
                    (records[obs_id]["mjd"] - 40587) * 86400, timezone.utc).strftime("%Y-%m")
                if actual_month != month:
                    raise ValueError("Monthly candidate time falls in the wrong UTC month")
                grouped_ids.append(obs_id)
        if len(grouped_ids) != len(files) or set(grouped_ids) != set(records):
            raise ValueError("Monthly candidate groups do not cover the plan")
    elif p.get("samplingMode") not in (None, "pass-spread"):
        raise ValueError("Unsupported sampling mode")
    max_total = 128 * 1024**2 if p.get("samplingMode") == "monthly" else 512 * 1024**2
    if not 0 < p["maxFileBytes"] <= 128 * 1024**2 or not 0 < p["maxTotalBytes"] <= max_total:
        raise ValueError("Download caps exceed the job limits")
    return p


class ProductWriter:
    def __init__(self, root):
        self.root = Path(root)

    def save_bytes(self, key, name, data, ext):
        name = f"{key}_{name}.{ext}"
        (self.root / name).write_bytes(data)
        return name

    def save_png(self, key, name, data):
        return self.save_bytes(key, name, data, "png")


def prepare(plan, paths, store, *, fixture=False, progress=None):
    """Pure local-input processing + store writes; fixture mode is explicitly synthetic, never used by CLI."""
    validate_plan(plan)
    parsed, originals, seen = [], [], set()
    for record, path in zip(plan["files"], paths, strict=True):
        f = read_frame_file(path)
        if not fixture and f.provenance != "spherex_header":
            raise ValueError("Input does not have verified SPHEREx header structure")
        if f.detector != plan["query"]["det"] or abs(f.mjd - record["mjd"]) > 0.01:
            raise ValueError(
                "Input detector or time disagrees with selected observation"
            )
        if max(f.shape) > 4096:
            raise ValueError("Input image exceeds processing limits")
        sha = digest_file(path)
        if sha in seen:
            continue
        seen.add(sha)
        if fixture:
            f.provenance = "synthetic"
        parsed.append(f)
        originals.append(
            {
                "path": Path(path),
                "sha256": sha,
                "sizeBytes": Path(path).stat().st_size,
                "obsId": record["obsId"],
                "sourceUrl": record["url"],
                "mjd": float(record["mjd"]),
            }
        )
    if not parsed:
        raise ValueError("No unique inputs")
    q = plan["query"]
    scale = float(np.median([f.pixel_scale_arcsec for f in parsed]))
    if (
        not math.isfinite(scale)
        or scale <= 0
        or math.ceil(q["fov"] * 60 / scale) > 1024
    ):
        raise ValueError("Output grid exceeds processing limits")
    revision = uuid.uuid4().hex
    prefix = f"sequences/{plan['sequenceId']}/{revision}"
    assets = {}
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        if progress:
            progress({"status": "processing", "phase": "cutout", "progress": 0.82})
        frames = build(
            parsed, q["ra"], q["dec"], q["fov"], scale, "frame", ProductWriter(root),
            on_progress=(lambda done, total, phase: progress({
                "status": "processing", "phase": phase,
                "completedWork": done, "totalWork": total,
                "progress": 0.82 + 0.13 * done / max(1, total),
            })) if progress else None,
        )
        if not frames:
            raise ValueError("No input covers at least half the requested field")
        if progress:
            progress({"status": "publishing", "phase": "assets", "progress": 0.96})
        output_paths = list(root.iterdir())
        for index, path in enumerate(output_paths, 1):
            asset = {
                "key": f"{prefix}/assets/{path.name}",
                "sizeBytes": path.stat().st_size,
                "sha256": digest_file(path),
            }
            store.put_file(asset["key"], path)
            assets[path.name] = asset
            if progress:
                progress({"status": "publishing", "phase": "assets", "completedWork": index,
                          "totalWork": len(output_paths),
                          "progress": 0.96 + 0.025 * index / max(1, len(output_paths))})
        for i, o in enumerate(originals):
            path = o.pop("path")
            o["key"] = f"{prefix}/private/input-{i:03}.fits" + (
                ".gz" if path.name.endswith(".gz") else ""
            )
            store.put_file(o["key"], path)
        manifest = {
            "version": 1,
            "sequenceId": plan["sequenceId"],
            "revision": revision,
            "dataKind": "synthetic" if fixture else "real",
            "query": q,
            "collection": plan.get("collection"),
            "frames": frames,
            "assets": assets,
            "originals": originals,
            "processingVersion": plan.get("processingVersion", CODE_VERSION),
            "processedAt": datetime.now(timezone.utc).isoformat(),
            "termsChecked": plan.get("termsChecked") is True,
            "acknowledgement": plan.get("acknowledgement", ""),
            "dataDoi": plan.get("dataDoi"),
            "requestId": plan.get("requestId"),
            "policyVersion": plan.get("policyVersion"),
            "selection": plan.get("selection"),
            "dateFrom": plan.get("dateFrom"),
            "dateTo": plan.get("dateTo"),
            "samplingMode": plan.get("samplingMode"),
            "monthlySelection": plan.get("monthlySelection"),
        }
        key = f"{prefix}/manifest.json"
        store.put_json(
            key, manifest
        )  # single publication point; never overwrite an earlier version
    return key, manifest


def _retry_delay(exc, attempt):
    retry_after = exc.headers.get("Retry-After") if isinstance(exc, HTTPError) else None
    delay = min(60.0, 5.0 * (2 ** (attempt - 1)))
    if retry_after:
        try:
            requested = float(retry_after)
        except ValueError:
            retry_date = parsedate_to_datetime(retry_after)
            if retry_date.tzinfo is None:
                retry_date = retry_date.replace(tzinfo=timezone.utc)
            requested = max(0.0, (retry_date - datetime.now(timezone.utc)).total_seconds())
        delay = max(delay, requested)
    return delay + random.uniform(0, 2)


def _retryable(exc):
    if isinstance(exc, HTTPError):
        return exc.code in (429, 502, 503, 504)
    return isinstance(exc, (URLError, TimeoutError, ConnectionError, http.client.HTTPException))


def open_input(url, opener=open_archive, sleep=time.sleep, *, max_attempts=8):
    """Retry transient IRSA response-open failures; body retries are handled per file."""
    for attempt in range(1, max_attempts + 1):
        try:
            return opener(url)
        except (HTTPError, URLError, TimeoutError, ConnectionError, http.client.HTTPException) as exc:
            if not _retryable(exc) or attempt == max_attempts:
                raise
            delay = _retry_delay(exc, attempt)
            if delay > 300:
                raise
            print(json.dumps({"event": "archive_retry", "status": getattr(exc, "code", None),
                              "error": type(exc).__name__, "attempt": attempt,
                              "maxAttempts": max_attempts, "delaySeconds": round(delay, 1)}), flush=True)
            if isinstance(exc, HTTPError):
                exc.close()
            sleep(delay)
    raise AssertionError("unreachable")


def _download_file(url, path, *, max_file_bytes, already_downloaded, max_total_bytes,
                   opener, sleep, progress=None, file_index=1, file_count=1,
                   transfer_usage=None):
    """Restart interrupted bodies from byte zero and discard each incomplete attempt."""
    path = Path(path)
    partial = Path(str(path) + ".part")
    for attempt in range(1, 9):
        received = 0
        try:
            with open_input(url, opener, sleep, max_attempts=1) as response, partial.open("wb") as out:
                length = response.headers.get("Content-Length")
                length = int(length) if length else None
                if length and length > max_file_bytes:
                    raise ValueError("Archive file exceeds approved limit")
                if (length is not None
                        and already_downloaded + int((transfer_usage or {}).get("bytes", 0)) + length > max_total_bytes):
                    raise ValueError("Download exceeds approved limit")
                while True:
                    used = int(transfer_usage["bytes"]) if transfer_usage is not None else received
                    remaining = max_total_bytes - already_downloaded - used
                    if remaining <= 0:
                        # For unknown-length responses, allow an EOF probe at the
                        # exact cap. Any extra byte proves the source exceeded it.
                        if length is not None and received >= length:
                            break
                        if length is None and not response.read(1):
                            break
                        raise ValueError("Download exceeds approved limit")
                    block = response.read(min(1024 * 1024, remaining))
                    if not block:
                        break
                    received += len(block)
                    if transfer_usage is not None:
                        transfer_usage["bytes"] = used + len(block)
                    if received > max_file_bytes:
                        raise ValueError("Download exceeds approved limit")
                    out.write(block)
                    if progress:
                        fraction = ((file_index - 1) + min(0.99, received / max_file_bytes)) / file_count
                        progress({"status": "downloading", "phase": "download",
                                  "completedFiles": file_index - 1, "totalFiles": file_count,
                                  "downloadedBytes": already_downloaded + (transfer_usage["bytes"] if transfer_usage is not None else received),
                                  "currentFileBytes": received, "attempt": attempt,
                                  "progress": 0.08 + 0.70 * fraction})
            partial.replace(path)
            return received
        except (HTTPError, URLError, TimeoutError, ConnectionError, http.client.HTTPException) as exc:
            partial.unlink(missing_ok=True)
            if not _retryable(exc) or attempt == 8:
                raise
            delay = _retry_delay(exc, attempt)
            if delay > 300:
                raise
            print(json.dumps({"event": "archive_retry", "status": getattr(exc, "code", None),
                              "error": type(exc).__name__, "attempt": attempt,
                              "maxAttempts": 8, "delaySeconds": round(delay, 1)}), flush=True)
            if isinstance(exc, HTTPError):
                exc.close()
            sleep(delay)
    raise AssertionError("unreachable")


def _verify_download(path, plan, record):
    frame = read_frame_file(path)
    if (frame.provenance != "spherex_header" or frame.detector != plan["query"]["det"]
            or abs(frame.mjd - record["mjd"]) > 0.01 or max(frame.shape) > 4096):
        raise ValueError("Downloaded FITS failed provenance, detector, time or size verification")
    return digest_file(path)


def _monthly_candidate_is_usable(path, plan, record):
    """Require a verified FITS file that yields a real cutout for this request."""
    frame = read_frame_file(path)
    actual_month = datetime.fromtimestamp((frame.mjd - 40587) * 86400, timezone.utc).strftime("%Y-%m")
    if actual_month != record.get("month"):
        raise ValueError("The FITS observation time falls in a different UTC month")
    scale = float(frame.pixel_scale_arcsec)
    if not math.isfinite(scale) or scale <= 0:
        raise ValueError("The FITS file has no usable pixel scale")
    target, npix = target_wcs(plan["query"]["ra"], plan["query"]["dec"], plan["query"]["fov"], scale)
    image, _flags = cutout(frame, target, npix)
    return bool(np.isfinite(image).mean() >= MIN_VALID_FRACTION)


def execute(plan, store, *, opener=open_archive, sleep=time.sleep, progress=None,
            staging_prefix=None):
    validate_plan(plan)
    if plan.get("downloadApproved") is not True:
        raise ValueError("The download plan is not approved")
    if plan.get("samplingMode") == "monthly":
        return _execute_monthly(plan, store, opener=opener, sleep=sleep,
                                progress=progress, staging_prefix=staging_prefix)
    total, paths = 0, []
    with tempfile.TemporaryDirectory(prefix="blink-inputs-") as tmp:
        for index, f in enumerate(plan["files"], 1):
            print(json.dumps({"event": "download_start", "obsId": f["obsId"]}), flush=True)
            path = Path(tmp) / f["name"]
            staged_key = metadata_key = None
            if staging_prefix:
                obs_hash = hashlib.sha256(f["obsId"].encode()).hexdigest()
                staged_key = f"{staging_prefix}/{obs_hash}.fits"
                metadata_key = f"{staged_key}.json"
            staged = False
            if (staged_key and store.exists(staged_key) and store.exists(metadata_key)):
                metadata = store.json(metadata_key)
                size = int(metadata.get("sizeBytes", 0))
                if (metadata.get("obsId") == f["obsId"] and 0 < size <= plan["maxFileBytes"]
                        and total + size <= plan["maxTotalBytes"]):
                    path.write_bytes(store.read(staged_key, limit=plan["maxFileBytes"]))
                    staged = (path.stat().st_size == size
                              and digest_file(path) == metadata.get("sha256"))
                    if staged:
                        _verify_download(path, plan, f)
                if not staged:
                    path.unlink(missing_ok=True)
            if not staged:
                size = _download_file(
                    f["url"], path, max_file_bytes=plan["maxFileBytes"],
                    already_downloaded=total, max_total_bytes=plan["maxTotalBytes"],
                    opener=opener, sleep=sleep, progress=progress,
                    file_index=index, file_count=len(plan["files"]),
                )
            total += size
            if f.get("sha256") and digest_file(path) != f["sha256"]:
                raise ValueError("Archive checksum mismatch")
            digest = _verify_download(path, plan, f)
            if staged_key and not staged:
                store.put_file(staged_key, path)
                store.put_json(metadata_key, {"obsId": f["obsId"], "sizeBytes": size,
                                              "sha256": digest})
            paths.append(path)
            print(json.dumps({"event": "download_complete", "obsId": f["obsId"],
                              "bytes": size, "totalBytes": total}), flush=True)
            if progress:
                progress({"status": "downloading", "phase": "download",
                          "completedFiles": len(paths), "totalFiles": len(plan["files"]),
                          "downloadedBytes": total, "attempt": int(plan.get("attempt", 1)),
                          "reusedStagedFiles": int(staged),
                          "progress": 0.08 + 0.70 * len(paths) / len(plan["files"])})
        return prepare(plan, paths, store, progress=progress)


def _execute_monthly(plan, store, *, opener, sleep, progress, staging_prefix):
    """Try archive-ordered candidates until one usable image is secured per month."""
    records = {item["obsId"]: item for item in plan["files"]}
    candidate_count = len(records)
    completed_candidates = 0
    total_bytes = 0
    accounted_bytes = 0
    selected_files, selected_paths, month_results = [], [], []

    with tempfile.TemporaryDirectory(prefix="blink-monthly-inputs-") as tmp:
        for group in plan["monthGroups"]:
            month = group["month"]
            attempted = []
            selected = None
            for obs_id in group["obsIds"]:
                record = records[obs_id]
                attempted.append(obs_id)
                path = Path(tmp) / record["name"]
                staged_key = metadata_key = None
                if staging_prefix:
                    obs_hash = hashlib.sha256(obs_id.encode()).hexdigest()
                    staged_key = f"{staging_prefix}/{obs_hash}.fits"
                    metadata_key = f"{staged_key}.json"
                staged = False
                transfer_usage = {"bytes": 0}
                transfer_accounted = False
                try:
                    if staged_key and store.exists(staged_key) and store.exists(metadata_key):
                        metadata = store.json(metadata_key)
                        size = int(metadata.get("sizeBytes", 0))
                        if (metadata.get("obsId") == obs_id and 0 < size <= plan["maxFileBytes"]
                                and accounted_bytes + size <= plan["maxTotalBytes"]):
                            path.write_bytes(store.read(staged_key, limit=plan["maxFileBytes"]))
                            staged = (path.stat().st_size == size
                                      and digest_file(path) == metadata.get("sha256"))
                            if staged:
                                _verify_download(path, plan, record)
                                accounted_bytes += size
                                transfer_accounted = True
                    if not staged:
                        path.unlink(missing_ok=True)
                        size = _download_file(
                            record["url"], path, max_file_bytes=plan["maxFileBytes"],
                            already_downloaded=accounted_bytes, max_total_bytes=plan["maxTotalBytes"],
                            opener=opener, sleep=sleep, progress=progress,
                            file_index=completed_candidates + 1, file_count=candidate_count,
                            transfer_usage=transfer_usage,
                        )
                        accounted_bytes += transfer_usage["bytes"]
                        transfer_accounted = True
                        if record.get("sha256") and digest_file(path) != record["sha256"]:
                            raise ValueError("Archive checksum mismatch")
                        _verify_download(path, plan, record)
                    if not _monthly_candidate_is_usable(path, plan, record):
                        raise ValueError("The FITS file does not cover enough of the requested field")
                    if staged and not (0 < path.stat().st_size <= plan["maxFileBytes"]):
                        raise ValueError("The staged FITS file exceeds the approved limit")
                    if staged_key and not staged:
                        store.put_file(staged_key, path)
                        store.put_json(metadata_key, {"obsId": obs_id, "sizeBytes": path.stat().st_size,
                                                      "sha256": digest_file(path)})
                    selected = record
                    selected_files.append(record)
                    selected_paths.append(path)
                    total_bytes += path.stat().st_size
                    print(json.dumps({"event": "monthly_observation_selected", "month": month,
                                      "obsId": obs_id, "reusedStagedFile": staged}), flush=True)
                    break
                except (HTTPError, URLError, TimeoutError, ConnectionError,
                        http.client.HTTPException, ValueError, OSError) as exc:
                    if not transfer_accounted:
                        accounted_bytes += transfer_usage["bytes"]
                    path.unlink(missing_ok=True)
                    print(json.dumps({"event": "monthly_candidate_skipped", "month": month,
                                      "obsId": obs_id, "error": type(exc).__name__}), flush=True)
                finally:
                    completed_candidates += 1
                    if progress:
                        progress({"status": "downloading", "phase": "download",
                                  "completedFiles": completed_candidates, "totalFiles": candidate_count,
                                  "completedMonths": len(selected_files), "totalMonths": len(plan["requestedMonths"]),
                                  "currentMonth": month,
                                  "downloadedBytes": accounted_bytes,
                                  "attempt": int(plan.get("attempt", 1)),
                                  "progress": 0.08 + 0.70 * completed_candidates / candidate_count})
            month_results.append({
                "month": month,
                "status": "ready" if selected else "unavailable",
                "selectedObsId": selected["obsId"] if selected else None,
                "attemptedObsIds": attempted,
            })

        resolved_months = {item["month"] for item in month_results}
        # Metadata can contain a month whose product URL could not be resolved;
        # retain it in the coverage report instead of silently dropping it.
        for month in plan["requestedMonths"]:
            if month not in resolved_months:
                month_results.append({"month": month, "status": "unavailable",
                                      "selectedObsId": None, "attemptedObsIds": []})
        month_results.sort(key=lambda item: item["month"])
        if not selected_files:
            raise ValueError("No monthly SPHEREx observation could be downloaded and processed")
        prepared_plan = {
            **plan,
            "files": selected_files,
            "monthGroups": [{"month": item["month"], "obsIds": [item["selectedObsId"]]}
                            for item in month_results if item["selectedObsId"]],
            "monthlySelection": {
                "mode": "one-per-utc-month",
                "requestedMonths": list(plan["requestedMonths"]),
                "missingMonths": [item["month"] for item in month_results if item["status"] != "ready"],
                "monthResults": month_results,
            },
        }
        return prepare(prepared_plan, selected_paths, store, progress=progress)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--plan",
        required=True,
        help="Local JSON path or private store object key with --stored-plan",
    )
    p.add_argument("--stored-plan", action="store_true")
    p.add_argument("--confirm-download", action="store_true")
    p.add_argument("--request-id")
    p.add_argument("--detector", choices=[f"D{i}" for i in range(1, 7)])
    p.add_argument("--attempt", type=int, default=1)
    a = p.parse_args()
    store = from_env()
    plan = store.json(a.plan) if a.stored_plan else json.loads(Path(a.plan).read_text())
    validate_plan(plan)
    if not a.confirm_download:
        print(json.dumps(plan, indent=2))
        print("Dry run only. No FITS downloaded or products written.")
        return
    state = None
    attempt_id = None
    execution_name = None
    progress = None
    staging_prefix = None
    if a.request_id:
        from .firestore_state import FirestoreState
        from .manifest import validate_dynamic_manifest

        if not a.detector or plan.get("requestId") != a.request_id or plan["query"]["det"] != a.detector:
            raise ValueError("Cloud job arguments do not match the stored plan")
        execution_name = os.getenv("CLOUD_RUN_EXECUTION", "")
        if not execution_name:
            raise ValueError("Cloud Run execution identity is missing")
        state = FirestoreState()
        request = state.get_request(a.request_id)
        if not request:
            raise ValueError("Field request no longer exists")
        plan.setdefault("processingVersion", request.get("processingVersion", CODE_VERSION))
        plan.setdefault("samplingMode", request.get("samplingMode", "pass-spread"))
        policy = state.policy(require_enabled=False)
        request_policy_version = request.get("policyVersion")
        compatible_versions = policy.get("compatiblePolicyVersions", [])
        if (policy.get("version") != request_policy_version
                and (not isinstance(compatible_versions, list)
                     or request_policy_version not in compatible_versions)):
            raise ValueError("The acquisition policy changed during this request")
        expected_query = {**request["query"], "det": a.detector}
        if (plan.get("query") != expected_query or plan.get("fieldKey") != request.get("fieldKey")
                or plan.get("processingVersion") != request.get("processingVersion")
                or plan.get("collection") != request.get("collection")
                or plan.get("policyVersion") != request.get("policyVersion")
                or plan.get("sequenceId") != f"{a.request_id}-{a.detector.lower()}"
                or plan.get("samplingMode", "pass-spread") != request.get("samplingMode", "pass-spread")
                or plan.get("downloadApproved") is not True
                or plan.get("termsChecked") is not True
                or plan.get("acknowledgement") != policy.get("acknowledgement")
                or plan.get("dataDoi") != policy.get("dataDoi")
                or int(plan.get("maxFileBytes", 0)) > int(policy.get("maxFileBytes", 32 * 1024**2))
                or int(plan.get("maxTotalBytes", 0)) > int(policy.get("maxTotalBytesPerDetector", 128 * 1024**2))):
            raise ValueError("The preparation plan does not match the owner-authorized request")
        detector_state = request.get("detectors", {}).get(a.detector, {})
        attempt_id = detector_state.get("attemptId")
        if (int(detector_state.get("attempt", 0)) != a.attempt or not attempt_id
                or not state.claim_job_execution(a.request_id, a.detector, attempt_id, execution_name)):
            print(json.dumps({"event": "duplicate_execution_skipped", "requestId": a.request_id,
                              "detector": a.detector, "attempt": a.attempt}), flush=True)
            return
        state.attach_execution(a.request_id, a.detector, attempt_id, execution_name)
        staging_prefix = f"staging/{a.request_id}/{a.detector.lower()}"
        last_write = {"bytes": -4 * 1024**2, "time": 0.0}

        def progress(update):
            amount = int(update.get("downloadedBytes", 0))
            update["downloadAttempt"] = int(update.get("attempt", 1))
            now = time.monotonic()
            if (update.get("status") == "downloading" and amount - last_write["bytes"] < 4 * 1024**2
                    and now - last_write["time"] < 10 and not update.get("completedFiles")):
                return
            update["attempt"] = a.attempt
            update["attemptId"] = attempt_id
            state.update_detector(a.request_id, a.detector, update)
            state.heartbeat_slot(a.request_id, a.detector, attempt_id)
            last_write.update(bytes=amount, time=now)

    try:
        key, manifest = execute(plan, store, progress=progress, staging_prefix=staging_prefix)
        if state:
            validate_dynamic_manifest(
                manifest, policy_version=request.get("policyVersion"),
                acknowledgement=policy["acknowledgement"],
                data_doi=policy["dataDoi"],
                max_file_bytes=int(policy.get("maxFileBytes", 32 * 1024**2)),
                max_total_bytes=int(policy.get("maxTotalBytesPerDetector", 128 * 1024**2)),
                max_observations=int(policy.get("maxObservationsPerDetector", 12)),
            )
            if (manifest.get("requestId") != a.request_id
                    or manifest.get("policyVersion") != request.get("policyVersion")
                    or manifest.get("sequenceId") != plan.get("sequenceId")):
                raise ValueError("Generated manifest does not match the approved field request")
            state.update_detector(a.request_id, a.detector, {
                "status": "publishing", "phase": "registration", "progress": 0.99,
                "attempt": a.attempt, "attemptId": attempt_id,
            })
            state.register_catalog(request, a.detector, key, manifest)
            state.release_slot(a.request_id, a.detector, attempt_id)
    except Exception:
        if state:
            state.update_detector(a.request_id, a.detector, {
                "status": "failed", "phase": "failed", "progress": 0.0,
                "attempt": a.attempt, "attemptId": attempt_id,
                "error": "SPHEREx processing failed; retry this detector.",
            })
            state.release_slot(a.request_id, a.detector, attempt_id)
        raise
    print(
        json.dumps(
            {
                "manifest": key,
                "frames": len(manifest["frames"]),
                "approvedForServing": False,
            }
        )
    )


if __name__ == "__main__":
    main()
