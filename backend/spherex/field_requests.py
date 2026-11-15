"""Pure field-request normalization and progress aggregation for cloud acquisition."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
import hashlib
import json
import math
import re

DETECTORS = tuple(f"D{i}" for i in range(1, 7))
COLLECTION = "spherex_dr1"
PROCESSING_VERSION = "blink3-cloud-2"
TERMINAL = {"ready", "failed", "unavailable"}
PHASE_WEIGHT = {
    "queued": 0.0,
    "discovering": 0.03,
    "planning": 0.08,
    "downloading": 0.08,
    "processing": 0.82,
    "publishing": 0.96,
    "ready": 1.0,
    "failed": 0.0,
    "unavailable": 0.0,
}


class RequestValidationError(ValueError):
    pass


def _number(value, label, low, high, *, high_inclusive=False):
    if isinstance(value, bool):
        raise RequestValidationError(f"{label} must be a number.")
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise RequestValidationError(f"{label} must be a number.") from exc
    if not math.isfinite(result) or result < low or (result > high if high_inclusive else result >= high):
        right = "]" if high_inclusive else ")"
        unit = " arcmin" if label == "FOV" else ""
        raise RequestValidationError(f"{label} must be in [{low}, {high}{right}{unit}.")
    return result


def _date_to_mjd(value, *, end=False):
    if value in (None, ""):
        return None
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise RequestValidationError("Dates must use YYYY-MM-DD format.")
    try:
        day = date.fromisoformat(value)
    except ValueError as exc:
        raise RequestValidationError("The requested date is invalid.") from exc
    stamp = datetime.combine(day + (timedelta(days=1) if end else timedelta()), time(), timezone.utc)
    return stamp.timestamp() / 86400 + 40587


def normalize_request(payload, *, allowed_collections=(COLLECTION,), processing_version=PROCESSING_VERSION):
    if not isinstance(payload, dict):
        raise RequestValidationError("A JSON object is required.")
    ra = _number(payload.get("ra"), "RA", 0, 360)
    dec = _number(payload.get("dec"), "Dec", -90, 90, high_inclusive=True)
    fov = _number(payload.get("fov"), "FOV", 1, 30, high_inclusive=True)
    collection = payload.get("collection", COLLECTION)
    if collection not in allowed_collections:
        raise RequestValidationError("That SPHEREx collection is not enabled by the acquisition policy.")
    requested_detectors = payload.get("detectors", list(DETECTORS))
    if not isinstance(requested_detectors, list) or not requested_detectors:
        raise RequestValidationError("Select at least one detector.")
    if (any(detector not in DETECTORS for detector in requested_detectors)
            or set(requested_detectors) != set(DETECTORS)
            or len(requested_detectors) != len(DETECTORS)):
        raise RequestValidationError("A field request must include each SPHEREx detector D1 through D6 exactly once.")
    detectors = list(DETECTORS)
    date_from, date_to = payload.get("dateFrom"), payload.get("dateTo")
    mjd_start = _date_to_mjd(date_from)
    mjd_end = _date_to_mjd(date_to, end=True)
    if mjd_start is not None and mjd_end is not None and mjd_start >= mjd_end:
        raise RequestValidationError("The start date must be earlier than the end date.")
    normalized = {
        "ra": round(ra, 8),
        "dec": round(dec, 8),
        "fov": round(fov, 4),
        "collection": collection,
        "processingVersion": processing_version,
        "detectors": detectors,
        "dateFrom": date_from or None,
        "dateTo": date_to or None,
        "mjdStart": mjd_start,
        "mjdEnd": mjd_end,
        "selection": "date-range" if date_from or date_to else "latest",
    }
    canonical = {key: normalized[key] for key in (
        "ra", "dec", "fov", "collection", "processingVersion", "detectors", "dateFrom", "dateTo"
    )}
    digest = hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    normalized["requestId"] = f"fr-{digest[:32]}"
    normalized["fieldKey"] = hashlib.sha256(json.dumps({
        "ra": normalized["ra"], "dec": normalized["dec"], "fov": normalized["fov"],
        "collection": collection, "processingVersion": processing_version,
    }, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:32]
    normalized["query"] = {"ra": normalized["ra"], "dec": normalized["dec"], "fov": normalized["fov"]}
    return normalized


def sequence_id(request_id, detector):
    if detector not in DETECTORS or not re.fullmatch(r"fr-[a-f0-9]{32}", request_id):
        raise RequestValidationError("Invalid request or detector identifier.")
    return f"{request_id}-{detector.lower()}"


def detector_progress(status, previous=None):
    """Return genuine phase/file progress and keep it monotonic within an attempt."""
    result = dict(previous or {})
    attempt = int(status.get("attempt", result.get("attempt", 0)))
    old_attempt = int(result.get("attempt", 0))
    progress = float(status.get("progress", result.get("progress", 0)))
    if attempt < old_attempt:
        return result
    if attempt == old_attempt:
        progress = max(float(result.get("progress", 0)), progress)
    result.update(status)
    result["attempt"] = attempt
    result["progress"] = min(1.0, max(0.0, progress))
    return result


def aggregate_progress(detectors):
    entries = list(detectors.values())
    if not entries:
        return {"status": "queued", "progress": 0.0, "readyDetectors": 0, "terminalDetectors": 0}
    states = [item.get("status", "queued") for item in entries]
    ready = states.count("ready")
    terminal = sum(state in TERMINAL for state in states)
    progress = sum(float(item.get("progress", PHASE_WEIGHT.get(item.get("status"), 0))) for item in entries) / len(entries)
    if ready == len(entries):
        overall = "ready"
    elif terminal == len(entries) and ready == 0:
        overall = "failed" if "failed" in states else "unavailable"
    elif ready:
        overall = "partial"
    elif "discovering" in states or "planning" in states:
        overall = "discovering"
    elif any(state in ("downloading", "processing", "publishing") for state in states):
        overall = "running"
    else:
        overall = "queued"
    return {"status": overall, "progress": round(progress, 4), "readyDetectors": ready, "terminalDetectors": terminal}
