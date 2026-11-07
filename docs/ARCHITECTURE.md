# Runtime architecture

The static workspace enters through frontend/index.html and js/main.js. The player and feature modules consume frames through js/data/getCutouts.js. js/config.js selects the synthetic source by default or the API source with the data=api query. Results use a separate entry point, js/results.js, and read data/real_results.json.

backend/app.py exposes health, cutouts, photometry and a HiPS relay. Modules under backend/spherex handle observation lookup, FITS data, resampling, flags, stretch and photometry. backend/tests constructs small synthetic FITS frames with known WCS. The scratch directory contains both offline module checks and separate real-data experiments with external input requirements.

Both HTML pages use frontend/css/styles.css. Results-specific chart and layout rules live in frontend/css/results.css. The static frontend can be served independently with scripts/serve_frontend.py.
