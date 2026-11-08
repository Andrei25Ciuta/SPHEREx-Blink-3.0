# Implementation roadmap

| Phase | State and next acceptance check |
| --- | --- |
| 0. Audit and baseline | Import and offline baseline recorded. Expand the feature audit as each subsystem changes. |
| 1. Design foundation | Three persisted themes and responsive navigation implemented. Core text contrast, first-tab skip focus and document overflow passed across five pages, three themes and four widths. The guided tour now isolates its modal background and passes a browser focus/pointer check. Next audit other dynamic states and screen readers. |
| 2. Astronomy workspace | Observation selector, image display controls, pan and side-by-side cutouts added. Observed Barnard D2 and independent Epsilon Indi B D6 workflows passed at 320, 375 and 1280 px, including comparison, photometry and JSON export. See REAL_D6_REPLICATION.md. Next verify more fields, detectors and quantitative measurement accuracy. |
| 3. Results dashboard | Candidate import, filtering, evidence and local reporting implemented. Exported fit positions survive JSON serialization. Public Results now prevents dead observed-FITS links while preserving synthetic and local links. Next validate diverse real candidate associations. |
| 4–6. Science pipeline, Planet X and spectra | Profile parallax intervals and one recorded injection experiment added. Unit parsing corrected. Next expand independent fields, source recovery and detector comparisons. |
| 7–9. Sky Explorer, simulator and research assistant | Initial functional explorer, simulator and evidence report implemented. Public Sky Explorer and Planet X Lab now keep observed-FITS workspace links local-only. Continue verification with live archive, more geometry checks and model output review. |
| 10. Release | Exercise end-to-end data paths, benchmark rendering and verify accessibility. GitHub Pages deploys the static frontend; a public-origin browser simulation now blocks loopback FITS requests and explains the synthetic-only demo. Verify the actual public pages in a browser and on a phone. |
