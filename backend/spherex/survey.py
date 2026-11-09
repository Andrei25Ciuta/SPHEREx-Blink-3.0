"""Which SPHEREx survey images cover a place on the sky, from IRSA's table `spherex.plane` (a catalogue query: no FITS file is downloaded).

Why a relay: the browser cannot call IRSA itself (it sends no CORS headers, checked 2026-11-10), so the page asks this backend, like it does for 2MASS and AllWISE
(catalogues.py). Only numbers go into the ADQL text and only one table is asked, so this is not an open proxy.

What IRSA gives (checked 2026-11-10 against the live service, see backend/tests/test_survey.py for a real row):
    table spherex.plane, one row per image ("plane"): planeid, energy_bandpassname ("SPHEREx-D1" ... "SPHEREx-D6"), time_bounds_lower / _upper (MJD),
    energy_bounds_lower / _upper (METRES), quality_flag, dataproducttype ("image"), poly = the footprint as EWKB hex (PostGIS: little-endian polygon, SRID 4326,
    longitude in [-180, 180], latitude), and the search that works is  1=INTERSECTS(poly, CIRCLE('ICRS', ra, dec, r))  with the polygon FIRST
    (CIRCLE first is refused as "Invalid or unsupported ADQL query string").

This is the footprint of what the SURVEY has published at IRSA, not of the files on this computer (footprints.py does that).
"""

from __future__ import annotations

import csv
import io
import json
import re
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from .cache import CACHE_DIR, make_key
from .catalogues import IRSA_TAP, USER_AGENT, _IRSA_LOCK

SURVEY_CACHE = CACHE_DIR / "survey"
SURVEY_VERSION = 1             # bump when the columns or the parsing change: old cache files are then ignored
RADIUS_MAX_DEG = 2.0           # an image is about 3.5 deg wide; two degrees already returns a thousand images
LIMIT_DEFAULT, LIMIT_MAX = 200, 1000
TIMEOUT_S = 120                # IRSA took 3-17 s for this query when checked
CACHE_MAX_AGE_S = 24 * 3600    # IRSA ingests data weekly, so a day-old answer is fine
DETECTORS = ("D1", "D2", "D3", "D4", "D5", "D6")
COLUMNS = ("planeid, energy_bandpassname, time_bounds_lower, time_bounds_upper, energy_bounds_lower, energy_bounds_upper, "
           "quality_flag, dataproducttype, poly")


class SurveyError(Exception):
    """IRSA did not give a usable answer (down, slow, or it refused the query)."""


def build_query(ra: float, dec: float, radius_deg: float, det: str = "all", limit: int = LIMIT_DEFAULT) -> str:
    """The ADQL text. Only validated numbers, a detector name from a fixed list, and the fixed template are used."""
    if not (0 <= ra < 360 and -90 <= dec <= 90):
        raise ValueError("ra must be in [0, 360) and dec in [-90, 90] degrees")
    if not (0 < radius_deg <= RADIUS_MAX_DEG):
        raise ValueError(f"radius must be above 0 and at most {RADIUS_MAX_DEG:g} degrees")
    if not (1 <= limit <= LIMIT_MAX):
        raise ValueError(f"limit must be between 1 and {LIMIT_MAX}")
    if det != "all" and det not in DETECTORS:
        raise ValueError(f'det must be "all" or one of {", ".join(DETECTORS)}')
    where = f"1=INTERSECTS(poly, CIRCLE('ICRS', {ra:.6f}, {dec:.6f}, {radius_deg:.6f}))"
    if det != "all":
        where += f" AND energy_bandpassname = 'SPHEREx-{det}'"
    return f"SELECT TOP {int(limit)} {COLUMNS} FROM spherex.plane WHERE {where} ORDER BY time_bounds_lower"


def decode_polygon(hex_text: str) -> list[list[float]]:
    """EWKB hex of a polygon -> its corners as [ra, dec] (degrees, ra in [0, 360)), the closing point dropped. ValueError if it is not a one-ring polygon."""
    try:
        raw = bytes.fromhex(hex_text.strip())
        endian = "<" if raw[0] == 1 else ">"
        kind = struct.unpack(endian + "I", raw[1:5])[0]
        offset = 5
        if kind & 0x20000000:                       # an SRID follows the type
            offset += 4
        if (kind & 0xFF) != 3:
            raise ValueError("not a polygon")
        rings = struct.unpack(endian + "I", raw[offset:offset + 4])[0]
        offset += 4
        if rings < 1:
            raise ValueError("no ring")
        count = struct.unpack(endian + "I", raw[offset:offset + 4])[0]
        offset += 4
        if not (4 <= count <= 1000):
            raise ValueError("odd number of points")
        points = []
        for _ in range(count):
            x, y = struct.unpack(endian + "dd", raw[offset:offset + 16])
            offset += 16
            if not (-360 <= x <= 360 and -90 <= y <= 90):
                raise ValueError("point out of range")
            points.append([x % 360.0, y])
    except (struct.error, IndexError) as exc:
        raise ValueError(f"cannot read the polygon: {exc}") from exc
    if points[0] == points[-1]:
        points.pop()
    return points


def _float(text):
    try:
        value = float(text)
    except (TypeError, ValueError):
        return None
    return value if value == value and abs(value) != float("inf") else None


def parse_csv(text: str) -> tuple[list[dict], int]:
    """IRSA's CSV -> (planes, skipped). A row whose footprint cannot be read is left out and counted, never invented. Anything that is not a table is a SurveyError."""
    head = text.lstrip()[:200]
    if not head.startswith("planeid"):
        raise SurveyError(f"IRSA answered with something that is not a table: {head[:80]!r}")
    planes, skipped = [], 0
    for raw in csv.DictReader(io.StringIO(text)):
        band = re.fullmatch(r"SPHEREx-(D[1-6])", raw.get("energy_bandpassname") or "")
        start, end = _float(raw.get("time_bounds_lower")), _float(raw.get("time_bounds_upper"))
        lo, hi = _float(raw.get("energy_bounds_lower")), _float(raw.get("energy_bounds_upper"))
        try:
            corners = decode_polygon(raw.get("poly") or "")
        except ValueError:
            corners = None
        if not band or start is None or corners is None:
            skipped += 1
            continue
        planes.append({
            "id": raw["planeid"], "detector": band.group(1),
            "mjdStart": start, "mjdEnd": end if end is not None else start,
            "wavelengthMinUm": None if lo is None else round(lo * 1e6, 4),          # IRSA gives metres
            "wavelengthMaxUm": None if hi is None else round(hi * 1e6, 4),
            "quality": raw.get("quality_flag") or None, "product": raw.get("dataproducttype") or None,
            "corners": [[round(a, 6), round(d, 6)] for a, d in corners],
        })
    return planes, skipped


def _request(adql: str) -> str:
    params = {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": adql}
    req = urllib.request.Request(IRSA_TAP, data=urllib.parse.urlencode(params).encode(), headers={"User-Agent": USER_AGENT})
    last: Exception | None = None
    for _attempt in (1, 2):                                  # one retry: the service is sometimes slow
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code < 500:
                break                                        # the query itself was refused: asking again changes nothing
        except OSError as exc:                               # timeout, connection reset, DNS ...
            last = exc
    raise SurveyError(f"IRSA unreachable or it refused the query: {last}")


def search(ra: float, dec: float, radius_deg: float, det: str = "all", limit: int = LIMIT_DEFAULT, *, request=_request, now=time.time) -> dict:
    """The survey images whose footprint touches the circle, oldest first. Cached on disk for a day (`now` and `request` are injectable for the tests)."""
    adql = build_query(ra, dec, radius_deg, det, limit)       # validates the arguments before anything else happens
    key = make_key("survey", SURVEY_VERSION, round(ra, 4), round(dec, 4), round(radius_deg, 4), det, limit)
    cached_file = SURVEY_CACHE / f"{key}.json"
    try:
        if cached_file.exists():
            kept = json.loads(cached_file.read_text(encoding="utf-8"))
            if 0 <= now() - kept["retrievedEpoch"] < CACHE_MAX_AGE_S:         # the age comes from the time stored with the answer, not from the file's date
                return {**kept, "fromCache": True}
    except (OSError, json.JSONDecodeError, KeyError, TypeError):
        pass
    with _IRSA_LOCK:                                          # IRSA wants one query at a time from one user
        text = request(adql)
    planes, skipped = parse_csv(text)
    answer = {
        "source": "IRSA TAP, table spherex.plane (a live query of the SPHEREx survey's published images, not the files on this computer)",
        "query": {"ra": ra, "dec": dec, "radiusDeg": radius_deg, "det": det, "limit": limit},
        "retrievedEpoch": now(),
        "retrievedAt": datetime.fromtimestamp(now(), timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
        "planes": planes, "skipped": skipped, "truncated": len(planes) + skipped >= limit,
    }
    SURVEY_CACHE.mkdir(parents=True, exist_ok=True)
    tmp = cached_file.with_name(cached_file.name + ".tmp")
    tmp.write_text(json.dumps(answer), encoding="utf-8")
    tmp.replace(cached_file)
    return {**answer, "fromCache": False}
