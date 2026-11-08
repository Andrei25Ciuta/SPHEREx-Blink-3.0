# Developing SPHEREx Blink

Work in this checkout. Push development to origin (SPHEREx-Blink-3.0). Treat upstream (the original SPHEREx project) and blink2 as read-only references. Read docs/CODEX_PROGRESS.md, docs/IMPLEMENTATION_ROADMAP.md and docs/FEATURE_STATUS.md, then verify HEAD and the working tree.

Serve frontend/ over HTTP. Preserve index.html, results.html, query parameters and embedded mode. The default workspace is synthetic. Keep it explicitly labelled. Read docs/VALIDATION.md before changing scientific methods, units, or thresholds.

Run every scratch/test_*.mjs with Node and run python -m pytest backend -q with backend/requirements-dev.txt installed. Run the browser regression for navigation changes. Record commands, fixture provenance and untested paths in the progress log.
