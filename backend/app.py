"""SPHEREx Blink backend.

Run (from the backend/ folder):
    .venv\\Scripts\\python.exe -m uvicorn app:app --port 8001 --reload

Endpoints
    GET /api/cutouts?ra=&dec=&fov=&det=   -> { "frames": Frame[] }   (same contract as the mock)
    GET /api/photometry?ra=&dec=&det=     -> { "points": Point[] }  (spectrum / light curve)
    GET /api/hips/<survey>/<file>         -> IRSA HiPS tiles relayed with CORS (sky map; allowlist)
    GET /api/catalogue?cat=&ra=&dec=&radius=[&minpm=] -> { rows: [...], truncated } known sources (2mass | allwise | gaia) for the cross-match
    GET /api/health                       -> indexed files + files that failed to read
    GET /cutouts/<file>.png               -> the cached PNGs referenced by imageUrl
    GET /                                 -> the frontend itself (optional, same origin)
"""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path

import numpy as np
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from spherex import cache, catalogues, hips_proxy
from spherex.cutout import cutout, flag_summary, target_wcs
from spherex.floatdata import float_cutout_bytes, mask_cutout_bytes
from spherex.footprints import footprints
from spherex.photometry import measure
from spherex.query import LocalArchive
from spherex.stretch import STRETCH_VERSION, flags_to_png, shared_stretch, to_png

FRONTEND_DIR = Path(__file__).resolve().parents[1] / "frontend"
FOV_MIN, FOV_MAX = 1.0, 30.0
MIN_VALID_FRACTION = 0.5     # skip frames where less than half the cutout has data (edge hits)

app = FastAPI(title="SPHEREx Blink API", version="0.7")

# The frontend may run on another port (python -m http.server) and reads PNG pixels on a
# <canvas> (img.crossOrigin = "anonymous"), so BOTH the JSON and the PNGs need CORS headers.
# The middleware wraps the whole app, mounted static files included.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

archive = LocalArchive()


@app.get("/api/health")
def health():
    archive.refresh()
    return {"dataDir": str(archive.root), "indexedFiles": len(archive._index),
            "unreadableFiles": {str(k): v for k, v in archive.errors.items()}}


@app.get("/api/footprints")
def footprints_endpoint(det: str = Query("all", description='"all" or a detector name like "D3"')):
    """Where the images on this machine are on the sky (the four corners of each, from its own WCS). No file names, no paths: see spherex/footprints.py."""
    archive.refresh()
    return {"footprints": footprints(list(archive._index.values()), det),
            "note": "The footprints of the image files this backend has, not of the SPHEREx survey."}


@app.get("/api/cutouts")
def cutouts(
    request: Request,
    ra: float = Query(..., ge=0, lt=360, description="degrees, ICRS"),
    dec: float = Query(..., ge=-90, le=90, description="degrees, ICRS"),
    fov: float = Query(5, ge=FOV_MIN, le=FOV_MAX, description="arcmin"),
    det: str = Query("all", description='"all" or a detector name like "D3"'),
):
    frames = archive.find(ra, dec, det)
    if not frames:
        return {"frames": []}

    # One common pixel scale for every frame -> identical grids -> stars stay put in the blink.
    scale = float(np.median([f.pixel_scale_arcsec for f in frames]))
    key = cache.make_key(round(ra, 6), round(dec, 6), round(fov, 3), det, STRETCH_VERSION,
                         [(str(f.path), f.mtime) for f in frames])

    result = cache.load(key)
    if result is None:
        result = _build(frames, ra, dec, fov, scale, key)
        cache.save(key, result)

    base = str(request.base_url)            # e.g. "http://localhost:8001/"
    return {"frames": [{**f, "imageUrl": base + f["imageUrl"],
                        "flagsUrl": base + f["flagsUrl"] if f.get("flagsUrl") else None,
                        "dataUrl": base + f["dataUrl"] if f.get("dataUrl") else None,
                        "maskUrl": base + f["maskUrl"] if f.get("maskUrl") else None}
                       for f in result]}


@app.get("/api/photometry")
def photometry(
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    det: str = Query("all"),
    radius: float = Query(2.0, ge=0.5, le=6, description="aperture radius in pixels"),
    epoch_mjd: float | None = Query(None, description="for a MOVING object: the date (MJD) at which it is at ra, dec"),
    pm_east: float = Query(0.0, description="moving object: motion towards the east, arcsec/yr"),
    pm_north: float = Query(0.0, description="moving object: motion towards the north, arcsec/yr"),
):
    frames = archive.find(ra, dec, det)
    motion = None if epoch_mjd is None else {"epoch_mjd": epoch_mjd, "pm_east": pm_east, "pm_north": pm_north}
    return {"points": measure(frames, ra, dec, radius, motion)}


def _build(frames, ra, dec, fov, scale, key):
    tgt, npix = target_wcs(ra, dec, fov, scale)

    # Cut everything first, then stretch per detector (shared scale within a detector).
    cut = []
    for f in frames:
        img, flags = cutout(f, tgt, npix)
        if np.isfinite(img).mean() < MIN_VALID_FRACTION:
            continue
        cut.append((f, img, flags))

    by_det = defaultdict(list)
    for item in cut:
        by_det[item[0].detector].append(item)

    out = []
    for det_items in by_det.values():
        stretched = shared_stretch([img for _, img, _ in det_items])
        for (f, img, flags), arr8 in zip(det_items, stretched):
            i = len(out)
            mask_png = flags_to_png(flags)
            out.append({
                "mjd": round(f.mjd, 6),
                "dateISO": f.date_iso,
                "detector": f.detector,
                "wavelengthMinUm": round(f.wave_min_um, 4),
                "wavelengthMaxUm": round(f.wave_max_um, 4),
                "imageUrl": cache.save_png(key, i, to_png(arr8)),
                # the same pixels as real numbers (float32, background-subtracted, north up): for detection
                "dataUrl": cache.save_bytes(key, i, float_cutout_bytes(img), "f32"),
                # 1 = a BAD flag bit is set here (a saturated core, hot pixels ...): the position of a bright star is fitted without them
                "maskUrl": cache.save_bytes(key, f"{i}_mask", mask_cutout_bytes(flags, img.shape), "u8"),
                "flags": flag_summary(flags),
                "flagsUrl": cache.save_png(key, f"{i}_flags", mask_png) if mask_png else None,
                "pixelScaleArcsec": round(scale, 4),
                # the unit of the float pixels (BUNIT of the file, e.g. "MJy / sr"), or None if the file does not say; the viewer's readout shows it
                "unit": f.bunit,
            })
    out.sort(key=lambda fr: fr["mjd"])
    return out


@app.get("/api/hips/{path:path}")
def hips(path: str):
    try:
        data, ctype = hips_proxy.fetch(path)
    except hips_proxy.NotAllowed as exc:
        return JSONResponse(status_code=403, content={"detail": str(exc)})
    except FileNotFoundError:
        return Response(status_code=404)
    except OSError as exc:
        return JSONResponse(status_code=502, content={"detail": f"IRSA HiPS unreachable: {exc}"})
    return Response(content=data, media_type=ctype, headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/catalogue")
def catalogue(
    cat: str = Query(..., description='"2mass", "allwise" or "gaia" (SIMBAD is asked by the browser itself)'),
    ra: float = Query(..., ge=0, lt=360, description="degrees, ICRS"),
    dec: float = Query(..., ge=-90, le=90, description="degrees, ICRS"),
    radius: float = Query(5, gt=0, le=catalogues.RADIUS_MAX_ARCMIN, description="arcmin"),
    minpm: float = Query(0, ge=0, le=catalogues.MIN_PM_MAX_MAS, description="gaia only: keep stars moving faster than this, mas/yr"),
):
    """Known sources around a position, for the cross-match of "Find everything"."""
    try:
        return catalogues.cone_search(cat, ra, dec, radius, minpm)
    except catalogues.NotAllowed as exc:
        return JSONResponse(status_code=403, content={"detail": str(exc)})
    except catalogues.CatalogueError as exc:
        return JSONResponse(status_code=502, content={"detail": str(exc)})


@app.exception_handler(ValueError)
def value_error(_request, exc):
    # Same {"detail": ...} shape as FastAPI's own errors -> apiSource.js shows the message.
    return JSONResponse(status_code=400, content={"detail": str(exc)})


class RevalidatedStatic(StaticFiles):
    """Static files the browser must re-check on every load (no stale .js/.css while developing)."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


app.mount("/cutouts", StaticFiles(directory=cache.CACHE_DIR), name="cutouts")
# Mounted LAST so /api/... and /cutouts/... win. Lets you open http://localhost:8001/ directly.
if FRONTEND_DIR.exists():
    app.mount("/", RevalidatedStatic(directory=FRONTEND_DIR, html=True), name="frontend")
