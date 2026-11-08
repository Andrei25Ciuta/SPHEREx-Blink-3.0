# Feature inventory at the navigation milestone

| Area | Implementation and evidence | Remaining check or improvement |
| --- | --- | --- |
| Workspace and results navigation | Shared skip links, persistent three-theme control, compact research links, zoom and display controls, observation selector, side-by-side cutouts. Browser smoke passed on the demo field. | Contrast audit and full real-data workflow. |
| Viewer, timeline, compare, measurement and exports | Existing player and features modules. Offline scripts exercise mock frames, comparison, measurement and export helpers. | Exercise the full interactive analysis workflow in a browser. |
| FITS cutouts, resampling, masking and photometry | FastAPI and backend/spherex, with generated FITS fixtures in backend/tests. | Independently reproduce selected real-frame measurements. |
| Find Movers and parallax | Existing detector and fit modules, profile distance fit, independent ephemeris test, recorded injection recovery on nine observed backgrounds. Planet X Lab displays the experiment with uncertainty and controls. | Wider, independent fields and more injected trials. |
| Spectra and detector comparison | Existing spectrum and compare modules with offline tests. | Recheck real-data uncertainty and calibration before changing outputs. |
| SIMBAD, SkyBoT and sky map | Existing catalogue, skybot and skyContext integrations. Offline logic checks do not establish service availability. | Exercise live success and failure paths. |
| Results dashboard | Saved validation charts, importable candidate JSON, searchable explorer, centroid evidence and offline report. | End-to-end testing of imported candidate exports and their viewer links. |
| Sky Explorer and simulator | Sky Explorer loads a saved IRSA SIA2 field and queries the backend for current footprints. The simulator renders adjustable observer geometry. | Live archive failure-path checks and independent geometry comparison. |
