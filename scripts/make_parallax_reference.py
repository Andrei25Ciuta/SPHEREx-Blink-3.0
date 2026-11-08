"""Generate the synthetic lab example from Astropy's independent built-in Earth ephemeris."""
from pathlib import Path

import astropy.units as u
import numpy as np
from astropy.coordinates import get_body_barycentric
from astropy.time import Time

OUTPUT = Path(__file__).resolve().parents[1] / "frontend" / "data" / "parallax_example.csv"
mjd = np.array([60800.1, 60801.5, 60803, 60983, 60984.5, 60986, 61168, 61169.5, 61171])
ref = (mjd[0] + mjd[-1]) / 2
times = Time(np.append(mjd, ref), format="mjd", scale="utc")
earth = (get_body_barycentric("earth", times, ephemeris="builtin")
         - get_body_barycentric("sun", times, ephemeris="builtin")).xyz.to_value(u.au).T
ra, dec = np.deg2rad([45, 10])
sight = np.array([np.cos(ra)*np.cos(dec), np.sin(ra)*np.cos(dec), np.sin(dec)])
east = np.array([-np.sin(ra), np.cos(ra), 0])
north = np.cross(sight, east)
positions = earth[-1] + 600 * sight - earth[:-1]
tangent = (positions @ np.stack([east, north]).T) / (positions @ sight)[:, None]
years = (mjd - ref) / 365.25
rng = np.random.default_rng(85)
sigma = 0.6
offsets = tangent * u.rad.to(u.arcsec) + years[:, None] * [20, -8] + rng.normal(0, sigma, (len(mjd), 2))
np.savetxt(OUTPUT, np.column_stack([mjd, offsets, np.full_like(mjd, sigma)]), fmt="%.7f",
           delimiter=",", header="mjd,east_arcsec,north_arcsec,sigma_arcsec", comments="")
