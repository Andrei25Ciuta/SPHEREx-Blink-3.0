"""IRSA TAP fallback for SPHEREx archive metadata discovery.

The adapter deliberately returns the small SIA row contract consumed by
``archive_plan.make_plan``. It only queries the owner-enabled collection and
the six supported detector bands; it never downloads image data.
"""
from __future__ import annotations

import csv
import io
import math
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from .archive_plan import safe_url
TAP_ENDPOINT = "https://irsa.ipac.caltech.edu/TAP/sync"
USER_AGENT = "SPHEREx-Blink/3.0"
MAX_ROWS = 4096
MAX_RESPONSE_BYTES = 16 * 1024 * 1024
TIMEOUT_SECONDS = 120
DETECTORS = tuple(f"D{i}" for i in range(1, 7))
SUPPORTED_COLLECTION = "spherex_dr1"
REQUIRED_COLUMNS = {"obs_id", "energy_bandpassname", "t_min", "access_url"}


class TapArchiveError(RuntimeError):
    """TAP did not return a usable metadata table."""

    def __init__(self, message: str, *, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def _finite(value, label):
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a finite number") from exc
    if not math.isfinite(result):
        raise ValueError(f"{label} must be a finite number")
    return result


def build_query(request: dict) -> str:
    """Build bounded ADQL from a normalized field request, never raw SQL text."""
    query = request.get("query") or {}
    ra = _finite(query.get("ra"), "RA")
    dec = _finite(query.get("dec"), "Dec")
    fov = _finite(query.get("fov"), "FOV")
    if not (0 <= ra < 360 and -90 <= dec <= 90 and 1 <= fov <= 10):
        raise ValueError("Invalid SPHEREx TAP field bounds")

    collection = request.get("collection")
    if collection != SUPPORTED_COLLECTION:
        raise ValueError("IRSA TAP fallback currently supports only spherex_dr1")
    detectors = request.get("detectors")
    if not isinstance(detectors, (list, tuple)) or not detectors or any(d not in DETECTORS for d in detectors):
        raise ValueError("Invalid SPHEREx TAP detector selection")
    # Values are from a fixed allowlist, not user-provided query fragments.
    bands = ", ".join("'SPHEREx-%s'" % d for d in dict.fromkeys(detectors))
    # SIA POS uses a circle radius of half the requested FOV diameter.
    radius_deg = fov / 120.0
    where = [
        f"1=INTERSECTS(p.poly, CIRCLE('ICRS', {ra:.8f}, {dec:.8f}, {radius_deg:.8f}))",
        f"p.energy_bandpassname IN ({bands})",
        "a.uri LIKE '%/dr1/%'",
    ]
    mjd_start = request.get("mjdStart")
    mjd_end = request.get("mjdEnd")
    if mjd_start is not None:
        where.append(f"p.time_bounds_lower >= {_finite(mjd_start, 'MJD start'):.8f}")
    if mjd_end is not None:
        where.append(f"p.time_bounds_lower < {_finite(mjd_end, 'MJD end'):.8f}")
    return (
        f"SELECT TOP {MAX_ROWS} p.planeid AS obs_id, "
        "p.energy_bandpassname AS energy_bandpassname, "
        "p.time_bounds_lower AS t_min, a.uri AS access_url "
        "FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid "
        f"WHERE {' AND '.join(where)} ORDER BY p.time_bounds_lower, p.planeid"
    )


def _query_csv(adql: str, *, opener=urllib.request.urlopen) -> list[dict]:
    params = urllib.parse.urlencode({
        "REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": adql,
    }).encode("ascii")
    req = urllib.request.Request(
        TAP_ENDPOINT, data=params,
        headers={"User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with opener(req, timeout=TIMEOUT_SECONDS) as response:
            payload = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read(512).decode("utf-8", "replace").strip()
        except Exception:
            detail = ""
        raise TapArchiveError(
            f"IRSA TAP returned HTTP {exc.code}" + (f": {detail}" if detail else ""),
            status_code=exc.code,
        ) from exc
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
        raise TapArchiveError(f"Could not reach IRSA TAP: {exc}") from exc
    if len(payload) > MAX_RESPONSE_BYTES:
        raise TapArchiveError("IRSA TAP metadata response exceeds the size limit")
    text = payload.decode("utf-8-sig", "replace")
    if text.lstrip().startswith("<"):
        try:
            root = ET.fromstring(text)
            info = next((node for node in root.findall(".//{*}INFO")
                         if node.get("name") == "QUERY_STATUS"), None)
            message = " ".join((info.itertext() if info is not None else ())).strip()
        except ET.ParseError:
            message = "unreadable VOTable error response"
        raise TapArchiveError("IRSA TAP query failed" + (f": {message[:400]}" if message else ""))
    reader = csv.DictReader(io.StringIO(text))
    fields = {field.strip().lower() for field in (reader.fieldnames or [])}
    if not REQUIRED_COLUMNS.issubset(fields):
        raise TapArchiveError("IRSA TAP returned an unrecognized metadata table")
    return [{(key or "").strip().lower(): value for key, value in row.items()} for row in reader]


def _product_url(value):
    raw = (value or "").strip()
    if not raw:
        return None
    if raw.startswith("/"):
        raw = "https://irsa.ipac.caltech.edu" + raw
    elif not raw.lower().startswith("https://"):
        raw = "https://irsa.ipac.caltech.edu/" + raw.lstrip("/")
    try:
        checked = safe_url(raw)
    except ValueError:
        return None
    parts = urllib.parse.urlsplit(checked)
    # TAP covers multiple archive releases; only DR1 is authorized by the
    # current acquisition policy. Never relabel QR2/QR3 products as DR1.
    if (not parts.path.startswith("/ibe/data/spherex/")
            or "/dr1/" not in parts.path.lower()
            or not parts.path.lower().endswith(".fits")):
        return None
    return checked


def normalize_rows(rows: list[dict], request: dict) -> list[dict]:
    """Convert TAP results into the SIA metadata shape used by the sampler."""
    collection = request.get("collection")
    if collection != SUPPORTED_COLLECTION:
        raise ValueError("IRSA TAP fallback currently supports only spherex_dr1")
    detectors = set(request.get("detectors") or ())
    mjd_start = request.get("mjdStart")
    mjd_end = request.get("mjdEnd")
    seen = set()
    normalized = []
    for row in rows:
        obs_id = (row.get("obs_id") or row.get("planeid") or "").strip()
        bandpass = (row.get("energy_bandpassname") or row.get("bandpass") or "").strip()
        if not obs_id or bandpass not in {f"SPHEREx-{d}" for d in detectors}:
            continue
        try:
            mjd = _finite(row.get("t_min", row.get("mjd")), "observation MJD")
        except ValueError:
            continue
        if mjd_start is not None and mjd < float(mjd_start):
            continue
        if mjd_end is not None and mjd >= float(mjd_end):
            continue
        url = _product_url(row.get("access_url", row.get("uri")))
        if not url or (obs_id, bandpass) in seen:
            continue
        seen.add((obs_id, bandpass))
        normalized.append({
            "obs_collection": collection,
            "energy_bandpassname": bandpass,
            "t_min": mjd,
            "obs_id": obs_id,
            "access_url": url,
            "access_format": "image/fits",
            "access_estsize": row.get("access_estsize") or None,
        })
    return sorted(normalized, key=lambda row: (row["t_min"], row["obs_id"], row["energy_bandpassname"]))


def observations(request: dict, *, tap_query=None) -> list[dict]:
    """Discover and normalize TAP products for a normalized field request.

    ``tap_query`` is injectable for deterministic orchestration tests; by
    default this performs one bounded IRSA TAP request.
    """
    adql = build_query(request)
    rows = (tap_query or _query_csv)(adql)
    return normalize_rows(rows, request)
