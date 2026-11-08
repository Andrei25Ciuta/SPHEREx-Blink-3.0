# Implementation roadmap

| Phase | State and next acceptance check |
| --- | --- |
| 0. Audit and baseline | Import and offline baseline recorded. Expand the feature audit as each subsystem changes. |
| 1. Design foundation | Three persisted themes and responsive navigation implemented. Core text contrast, first-tab skip focus and document overflow passed across five pages, three themes and four widths. The guided tour now isolates its modal background and passes a browser focus/pointer check. Next audit other dynamic states and screen readers. |
| 2. Astronomy workspace | Observation selector, image display controls, pan and side-by-side cutouts added. Next verify real backend operation across all detectors and narrow screens. |
| 3. Results dashboard | Candidate import, filtering, evidence and local reporting implemented. Exported fit positions now survive JSON serialization, and a browser round trip passed. Next validate diverse real candidate associations. |
| 4–6. Science pipeline, Planet X and spectra | Profile parallax intervals and one recorded injection experiment added. Unit parsing corrected. Next expand independent fields, source recovery and detector comparisons. |
| 7–9. Sky Explorer, simulator and research assistant | Initial functional explorer, simulator and evidence report implemented. Continue verification with live archive, more geometry checks and model output review. |
| 10. Release | Exercise end-to-end data paths, benchmark rendering and verify accessibility. Pages deployment now skips cleanly while repository Pages is disabled; enable the GitHub Actions Pages source and verify a live deployment when ready. |
