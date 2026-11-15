"""Validation shared by the API catalog and the preparation publisher."""
import math
import re

from .archive_plan import safe_url
from .storage import StoreError


def validate_manifest(doc):
    try:
        if (doc["version"] != 1 or not isinstance(doc["processingVersion"], str)
                or not isinstance(doc["collection"], str)):
            raise ValueError()
        if not re.fullmatch(r"[a-z0-9-]{1,64}", doc["sequenceId"]) or not re.fullmatch(r"[a-f0-9]{32}", doc["revision"]):
            raise ValueError()
        if doc["dataKind"] not in ("real", "synthetic") or not isinstance(doc["acknowledgement"], str):
            raise ValueError()
        q = doc["query"]
        if not (0 <= q["ra"] < 360 and -90 <= q["dec"] <= 90 and 1 <= q["fov"] <= 10):
            raise ValueError()
        if q["det"] not in [f"D{i}" for i in range(1, 7)]:
            raise ValueError()
        if not 1 <= len(doc["originals"]) <= 24 or not 1 <= len(doc["frames"]) <= 24:
            raise ValueError()
        if not isinstance(doc["assets"], dict) or not doc["assets"]:
            raise ValueError()
        prefix = f"sequences/{doc['sequenceId']}/{doc['revision']}/"
        for item in [*doc["assets"].values(), *doc["originals"]]:
            if (not item["key"].startswith(prefix)
                    or not re.fullmatch(r"[a-f0-9]{64}", item["sha256"])
                    or not 0 < item["sizeBytes"] <= 128 * 1024**2):
                raise ValueError()
        if sum(int(item["sizeBytes"]) for item in doc["assets"].values()) > 128 * 1024**2:
            raise ValueError()
        if len({item["obsId"] for item in doc["originals"]}) != len(doc["originals"]):
            raise ValueError()
        for original in doc["originals"]:
            safe_url(original["sourceUrl"])
            if original.get("mjd") is not None and not math.isfinite(original["mjd"]):
                raise ValueError()
        for frame in doc["frames"]:
            if (not math.isfinite(frame["mjd"]) or frame["detector"] != q["det"]
                    or not 0 < frame["wavelengthMinUm"] < frame["wavelengthMaxUm"]
                    or not all(math.isfinite(frame[key]) for key in ("wavelengthMinUm", "wavelengthMaxUm"))):
                raise ValueError()
            if not all(frame.get(key) for key in ("imageUrl", "dataUrl", "maskUrl")):
                raise ValueError()
            for key in ("imageUrl", "dataUrl", "maskUrl", "flagsUrl"):
                name = frame.get(key)
                if name and (not re.fullmatch(r"[A-Za-z0-9_.-]+", name) or name not in doc["assets"]):
                    raise ValueError()
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise StoreError("Invalid product manifest") from exc


def validate_dynamic_manifest(doc, *, policy_version, acknowledgement, data_doi="10.26131/IRSA678",
                              max_file_bytes=32 * 1024**2, max_total_bytes=128 * 1024**2,
                              max_observations=12):
    """Apply the stricter owner policy to newly acquired real DR1 products."""
    validate_manifest(doc)
    try:
        if (doc.get("dataKind") != "real" or doc.get("collection") != "spherex_dr1"
                or doc.get("termsChecked") is not True
                or doc.get("policyVersion") != policy_version
                or doc.get("acknowledgement") != acknowledgement
                or doc.get("dataDoi") != data_doi
                or not re.fullmatch(r"fr-[a-f0-9]{32}", doc.get("requestId", ""))):
            raise ValueError()
        originals = doc["originals"]
        if len(originals) > max_observations or len(doc["frames"]) > max_observations:
            raise ValueError()
        if any(not 0 < int(item["sizeBytes"]) <= max_file_bytes for item in originals):
            raise ValueError()
        if sum(int(item["sizeBytes"]) for item in originals) > max_total_bytes:
            raise ValueError()
        if any(frame.get("provenance") != "spherex_header" for frame in doc["frames"]):
            raise ValueError()
        times = [item.get("mjd") for item in originals]
        if any(time is None or not math.isfinite(time) for time in times):
            raise ValueError()
        for frame in doc["frames"]:
            if min(abs(frame["mjd"] - time) for time in times) > 0.01:
                raise ValueError()
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise StoreError("New sequence does not satisfy the owner acquisition policy") from exc
    return doc
