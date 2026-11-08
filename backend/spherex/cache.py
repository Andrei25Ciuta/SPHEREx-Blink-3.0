"""Disk cache for finished responses: cache/<key>.json + cache/<key>_<i>.png.

The key covers the query AND the exact input files (path + modification time) AND the
stretch version, so a changed file or algorithm never serves a stale image.
URLs are stored RELATIVE ("cutouts/<file>.png"); app.py adds the server address.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path

CACHE_DIR = Path(os.environ.get("SPHEREX_CACHE_DIR", Path(__file__).resolve().parents[1] / "cache"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def make_key(*parts) -> str:
    return hashlib.sha1(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:20]


def load(key: str):
    p = CACHE_DIR / f"{key}.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _publish(name: str, payload: bytes) -> None:
    # A unique staging file per writer also protects concurrent requests for the same field.
    with tempfile.NamedTemporaryFile(dir=CACHE_DIR, delete=False) as staging:
        tmp = Path(staging.name)
        try:
            staging.write(payload)
        except OSError:
            staging.close()
            tmp.unlink(missing_ok=True)
            raise
    try:
        tmp.replace(CACHE_DIR / name)
    finally:
        tmp.unlink(missing_ok=True)


def save_png(key: str, i: int | str, png: bytes) -> str:
    return save_bytes(key, i, png, "png")


def save_bytes(key: str, name: int | str, data: bytes, ext: str) -> str:
    file = f"{key}_{name}.{ext}"
    _publish(file, data)
    return f"cutouts/{file}"


def save(key: str, frames: list[dict]):
    _publish(f"{key}.json", json.dumps(frames).encode("utf-8"))
