"""Cone searches of 2MASS, AllWISE and Gaia DR3 for the browser (which cannot call IRSA / ESA itself: no CORS).

Why: "Find everything" asks whether a detected source is already catalogued. SIMBAD is queried by the browser directly
(its TAP service allows CORS); the three catalogues below need this relay. Only numbers go into the ADQL text, and only
the three catalogues in CATALOGUES can be asked for, so this is not an open proxy.

Services (checked 2026-11-08):
    2MASS point sources   IRSA TAP, table fp_psc              (GET works)
    AllWISE source cat.   IRSA TAP, table allwise_p3as_psd    (GET works; IRSA wants queries one at a time)
    Gaia DR3              ESA TAP, table gaiadr3.gaia_source  (a GET hangs from some networks, a POST works)
"""

from __future__ import annotations

import csv
import io
import json
import threading
import urllib.error
import urllib.parse
import urllib.request

from .cache import CACHE_DIR, make_key

IRSA_TAP = "https://irsa.ipac.caltech.edu/TAP/sync"
GAIA_TAP = "https://gea.esac.esa.int/tap-server/tap/sync"
USER_AGENT = "SPHEREx-Blink/0.9 (NASA Space Apps 2026 project)"
CATALOGUE_CACHE = CACHE_DIR / "catalogues"

RADIUS_MAX_ARCMIN = 25.0       # a SPHEREx cutout is at most 30 arcmin across: half its diagonal is 21 arcmin
ROW_LIMIT = 20000              # rows per answer; a dense Galactic field has more, then "truncated" is true and the page does NOT
                               # treat the catalogue as checked (a missing faint star would look like a discovery)
MIN_PM_MAX_MAS = 100000.0
TIMEOUT_S = {"2mass": 90, "allwise": 90, "gaia": 120}
MJD_J2000 = 51544.5
CATALOGUE_VERSION = 1          # bump when the columns or the parsing change: old cache files are then ignored


class CatalogueError(Exception):
    """The upstream service did not give a usable answer (down, slow, or it refused the query)."""


class NotAllowed(Exception):
    pass


def _float(text):
    try:
        value = float(text)
    except (TypeError, ValueError):
        return None
    return value if value == value and abs(value) != float("inf") else None


def _row_2mass(r: dict) -> dict:
    jd = _float(r.get("jdate"))
    return {"id": "2MASS J" + (r.get("designation") or "?"), "ra": _float(r.get("ra")), "dec": _float(r.get("dec")),
            "pmra": None, "pmdec": None, "epochMjd": None if jd is None else jd - 2400000.5,
            "mags": {"J": _float(r.get("j_m")), "H": _float(r.get("h_m")), "K": _float(r.get("k_m"))}}


def _row_allwise(r: dict) -> dict:
    # AllWISE lists a proper motion too, but it is poorly measured for faint sources: it is left out on purpose
    # (the cross-match moves the candidate back to the catalogue's date instead).
    return {"id": "AllWISE " + (r.get("designation") or "?"), "ra": _float(r.get("ra")), "dec": _float(r.get("dec")),
            "pmra": None, "pmdec": None, "epochMjd": _float(r.get("w1mjdmean")),
            "mags": {"W1": _float(r.get("w1mpro")), "W2": _float(r.get("w2mpro")), "W3": _float(r.get("w3mpro"))}}


def _row_gaia(r: dict) -> dict:
    epoch = _float(r.get("ref_epoch"))
    return {"id": "Gaia DR3 " + (r.get("source_id") or "?"), "ra": _float(r.get("ra")), "dec": _float(r.get("dec")),
            "pmra": _float(r.get("pmra")), "pmdec": _float(r.get("pmdec")),     # mas/yr (pmra already includes cos(dec))
            "epochMjd": None if epoch is None else MJD_J2000 + (epoch - 2000.0) * 365.25,
            "mags": {"G": _float(r.get("phot_g_mean_mag"))}}


# key -> (service URL, HTTP method, ADQL template, expected first CSV column, row converter)
CATALOGUES = {
    "2mass": (IRSA_TAP, "GET",
              "SELECT TOP {limit} designation,ra,dec,j_m,h_m,k_m,jdate FROM fp_psc "
              "WHERE 1=CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',{ra:.6f},{dec:.6f},{radius_deg:.6f}))",
              "designation", _row_2mass),
    "allwise": (IRSA_TAP, "GET",
                "SELECT TOP {limit} designation,ra,dec,w1mpro,w2mpro,w3mpro,w1mjdmean FROM allwise_p3as_psd "
                "WHERE 1=CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',{ra:.6f},{dec:.6f},{radius_deg:.6f}))",
                "designation", _row_allwise),
    "gaia": (GAIA_TAP, "POST",
             "SELECT TOP {limit} source_id,ra,dec,pmra,pmdec,phot_g_mean_mag,ref_epoch FROM gaiadr3.gaia_source "
             "WHERE 1=CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',{ra:.6f},{dec:.6f},{radius_deg:.6f}))",
             "source_id", _row_gaia),
}

# IRSA asks for one query at a time per user; the two IRSA catalogues share one lock.
_IRSA_LOCK = threading.Lock()
_LOCKS = {"2mass": _IRSA_LOCK, "allwise": _IRSA_LOCK, "gaia": threading.Lock()}


def build_query(cat: str, ra: float, dec: float, radius_arcmin: float, min_pm_mas: float = 0.0) -> str:
    """The ADQL text for one cone search. Only floats (formatted here) and the fixed template are used.

    min_pm_mas (Gaia only): keep only stars whose proper motion is above this many mas/yr. A fast star has moved far since
    Gaia's epoch 2016.0 (Barnard's Star: 90 arcsec by 2025), so the page asks for the fast ones in a WIDER circle.
    """
    if cat not in CATALOGUES:
        raise NotAllowed(f'catalogue "{cat}" is not offered (use one of: {", ".join(CATALOGUES)})')
    if not (0 <= ra < 360 and -90 <= dec <= 90):
        raise ValueError("ra must be in [0, 360) and dec in [-90, 90] degrees")
    if not (0 < radius_arcmin <= RADIUS_MAX_ARCMIN):
        raise ValueError(f"radius must be above 0 and at most {RADIUS_MAX_ARCMIN:g} arcmin")
    if not (0 <= min_pm_mas <= MIN_PM_MAX_MAS):
        raise ValueError(f"min_pm must be between 0 and {MIN_PM_MAX_MAS:g} mas/yr")
    query = CATALOGUES[cat][2].format(limit=ROW_LIMIT, ra=ra, dec=dec, radius_deg=radius_arcmin / 60)
    if min_pm_mas > 0:
        if cat != "gaia":
            raise ValueError("a proper-motion filter exists for gaia only (2MASS and AllWISE list no usable proper motion)")
        query += f" AND pmra*pmra+pmdec*pmdec>{min_pm_mas ** 2:.1f}"
    return query


def _request(cat: str, adql: str) -> str:
    url, method = CATALOGUES[cat][0], CATALOGUES[cat][1]
    params = {"QUERY": adql, "LANG": "ADQL", "FORMAT": "csv"}
    if method == "POST":
        params["REQUEST"] = "doQuery"
        req = urllib.request.Request(url, data=urllib.parse.urlencode(params).encode(), headers={"User-Agent": USER_AGENT})
    else:
        req = urllib.request.Request(url + "?" + urllib.parse.urlencode(params), headers={"User-Agent": USER_AGENT})
    last: Exception | None = None
    for _attempt in (1, 2):                                  # one retry: these services are sometimes slow
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_S[cat]) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code < 500:
                break                                        # the query itself was refused: asking again changes nothing
        except OSError as exc:                               # timeout, connection reset, DNS ...
            last = exc
    raise CatalogueError(f"{cat} service unreachable or refused the query: {last}")


def parse_csv(cat: str, text: str) -> list[dict]:
    """CSV text -> rows in the shape the browser expects. Anything else (an XML error page) is a CatalogueError."""
    first = CATALOGUES[cat][3]
    head = text.lstrip()[:200]
    if not head.startswith(first):
        raise CatalogueError(f"{cat} answered with something that is not a table: {head[:80]!r}")
    convert = CATALOGUES[cat][4]
    rows = []
    for raw in csv.DictReader(io.StringIO(text)):
        row = convert(raw)
        if row["ra"] is None or row["dec"] is None:
            continue
        row["mags"] = {k: v for k, v in row["mags"].items() if v is not None}
        rows.append(row)
    return rows


def cone_search(cat: str, ra: float, dec: float, radius_arcmin: float, min_pm_mas: float = 0.0) -> dict:
    """Rows of one catalogue around (ra, dec). Cached on disk (catalogues do not change from one day to the next)."""
    adql = build_query(cat, ra, dec, radius_arcmin, min_pm_mas)   # validates the arguments before anything else happens
    key = make_key("catalogue", CATALOGUE_VERSION, cat, round(ra, 4), round(dec, 4), round(radius_arcmin, 3), round(min_pm_mas, 1))
    cached_file = CATALOGUE_CACHE / f"{key}.json"
    if cached_file.exists():
        try:
            return json.loads(cached_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
    with _LOCKS[cat]:
        text = _request(cat, adql)
    rows = parse_csv(cat, text)
    answer = {"catalogue": cat, "ra": ra, "dec": dec, "radiusArcmin": radius_arcmin, "minPmMas": min_pm_mas, "rows": rows,
              "truncated": len(rows) >= ROW_LIMIT}
    if not answer["truncated"]:                           # a cut-off list is not worth keeping
        CATALOGUE_CACHE.mkdir(parents=True, exist_ok=True)
        tmp = cached_file.with_name(cached_file.name + ".tmp")
        tmp.write_text(json.dumps(answer), encoding="utf-8")
        tmp.replace(cached_file)
    return answer
