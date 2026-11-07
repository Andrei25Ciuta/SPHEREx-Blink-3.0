# Feature inventory at the navigation milestone

| Area | Implementation and evidence | Remaining check or improvement |
| --- | --- | --- |
| Workspace and results navigation | Shared focus styling, four header destinations and keyboard skip links. Edge smoke covers narrow and wide layouts, results JSON loading, return navigation and embed visibility. | Add persistent themes and verify contrast on both pages. |
| Viewer, timeline, compare, measurement and exports | Existing player and features modules. Offline scripts exercise mock frames, comparison, measurement and export helpers. | Exercise the full interactive analysis workflow in a browser. |
| FITS cutouts, resampling, masking and photometry | FastAPI and backend/spherex, with generated FITS fixtures in backend/tests. | Independently reproduce selected real-frame measurements. |
| Find Movers and parallax | Existing detector and fit modules, synthetic checks and historical calibration in VALIDATION.md. | Independent fields and injection recovery. |
| Spectra and detector comparison | Existing spectrum and compare modules with offline tests. | Recheck real-data uncertainty and calibration before changing outputs. |
| SIMBAD, SkyBoT and sky map | Existing catalogue, skybot and skyContext integrations. Offline logic checks do not establish service availability. | Exercise live success and failure paths. |
| Results dashboard | Existing results page renders saved measurements and charts. | Candidate Explorer and evidence-linked navigation. |
| Planned work | Survey footprint explorer, orbital simulator and optional research reporting remain roadmap items. | Define inputs and acceptance tests before implementation. |
