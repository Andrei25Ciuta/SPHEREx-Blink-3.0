# Scientific scope

The default viewer generates synthetic frames. The results dashboard reads the saved real-data summary. Neither the navigation smoke test nor the offline module checks reproduce those observations.

The imported validation report documents the small field sample, limitations of quick aperture fluxes, and confusion in blind parallax searches. Its targeted Makemake distance fit and its blind recovery experiment answer different questions. Keep their evidence separate. See [the original validation methods and results](VALIDATION.md).

The Planet X Lab uses synthetic Gaussian sources inserted into nine observed D2 cutout backgrounds in one field. Four trials per distance and flux setting give wide Wilson intervals. The recorded control fields yielded zero candidates in four runs, which is insufficient for a survey-wide false-positive claim. The Earth ephemeris and straight target drift are approximations. Profile distance intervals condition on the selected source association and model.

Photometry uses a small aperture and background annulus. Flux density conversion requires a FITS surface-brightness unit. The parser now respects SI prefix case, so MJy/sr and mJy/sr differ by a factor of one billion. Neither aperture correction nor absolute SPHEREx pipeline calibration is claimed.

The backend marks a frame synthetic when its header explicitly identifies a test file, SPHEREx-format when product header markers are present, and unverified otherwise. Header checks do not authenticate the download source. Mixed and unverified fields carry those labels in the workspace and exports. Cached cutout responses are rebuilt under a new cache key.
