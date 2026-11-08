"""Bounded SPHEREx SIA2 image metadata from the IRSA archive."""

import csv
from datetime import datetime, timezone
from io import StringIO
import math
import re
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

ENDPOINT = "https://irsa.ipac.caltech.edu/SIA"
COLLECTIONS = ("spherex_qr2", "spherex_qr2_deep", "spherex_qr3", "spherex_qr3_deep")
LIMIT = 100
REQUIRED = {"obs_id", "energy_bandpassname", "t_min", "s_region", "access_url", "obs_collection"}


def icrs_polygon(region):
    tokens = (region or "").split()
    if [t.upper() for t in tokens[:2]] != ["POLYGON", "ICRS"]:
        return None
    if len(tokens) < 8 or len(tokens) % 2:
        return None
    try:
        values = list(map(float, tokens[2:]))
    except ValueError:
        return None
    points = list(zip(values[::2], values[1::2]))
    if any(not (0 <= ra <= 360 and -90 <= dec <= 90) for ra, dec in points):
        return None
    if points[-1] == points[0]:
        points.pop()
    return points if len(set(points)) >= 3 else None


def image_product(raw):
    parts = urlsplit(raw or "")
    if parts.scheme == "https" and parts.netloc == "irsa.ipac.caltech.edu" and parts.path.startswith("/ibe/data/spherex/"):
        return raw
    return None


def observations(ra, dec, fov, collection):
    """Return products intersecting a circle with diameter fov arcmin."""
    if collection not in COLLECTIONS or not (0 <= ra < 360 and -90 <= dec <= 90 and 1 <= fov <= 30):
        raise ValueError("Invalid SPHEREx archive search")
    params = {"COLLECTION": collection, "POS": f"circle {ra} {dec} {fov / 120}",
              "MAXREC": LIMIT + 1, "RESPONSEFORMAT": "csv"}
    source = ENDPOINT + "?" + urlencode(params)
    request = Request(source, headers={"User-Agent": "SPHEREx-Blink/2.0"})
    with urlopen(request, timeout=20) as response:
        payload = response.read(1024 * 1024 + 1)
    if len(payload) > 1024 * 1024:
        raise OSError("IRSA metadata response exceeds the size limit")
    reader = csv.DictReader(StringIO(payload.decode("utf-8-sig")))
    if not REQUIRED.issubset(reader.fieldnames or ()):
        raise OSError("IRSA returned an unrecognised metadata table")
    records = []
    truncated = False
    for row in reader:
        if len(records) == LIMIT:
            truncated = True
            break
        if row["obs_collection"] != collection or not row["obs_id"]:
            raise OSError("IRSA returned inconsistent collection or observation metadata")
        band = re.fullmatch(r"SPHEREx-(D[1-6])", row["energy_bandpassname"] or "")
        try:
            mjd = float(row["t_min"])
        except (TypeError, ValueError):
            mjd = None
        records.append({"id": row["obs_id"], "detector": band[1] if band else None,
                        "startMjd": mjd if mjd is not None and math.isfinite(mjd) else None,
                        "footprint": icrs_polygon(row["s_region"]), "productUrl": image_product(row["access_url"])})
    return {"source": source, "retrieved": datetime.now(timezone.utc).isoformat(),
            "query": {"ra": ra, "dec": dec, "fov": fov, "collection": collection},
            "records": records, "truncated": truncated}
