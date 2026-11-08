# Scientific limitations

The short list. Every number and its test is in [VALIDATION.md](VALIDATION.md); §8 (known limits) and §14 (*Find everything*) are the long forms.
A candidate is a lead with its evidence, never a discovery. Nothing this application has produced is an unknown object.

## Data

- The public demo runs on **synthetic** data. Real SPHEREx cutouts (60 small ones: Barnard's Star, Epsilon Indi B, WISE 0855, the asteroid Arosa,
  Makemake) are used only on the author's machine and are not published; their licence and terms of use have not been reviewed ([CREDITS.md](../CREDITS.md)).
- Fluxes are quick aperture sums on background-subtracted cutouts, 2-10 % below catalogue magnitudes, **not** SPHEREx's calibrated photometry.
- Through SPHEREx's variable filter each image of a star has a different wavelength, so its brightness changes from image to image: movers are
  found from **positions only**, and any flat-spectrum assumption (injection tests, the "absent in other passes" transient tag) is an approximation.
- A cutout of all detectors together and one of a single detector are resampled differently; marginal results can differ between them.

## Find movers

- Needs images from at least 3 survey passes about 6 months apart; motion below about 0.8 pixel (5″) over the baseline looks like a still star.
- In a field with a saturated star it is 20-30 times less sensitive; one image reaches about 0.6-0.9 mJy in a clean field.
- The "chance lines expected" number is conservative in the empty-sky tests; it is not a probability of being real.

## Planet X mode

- Works on bodies single images can show (about V 17). A Planet-Nine-like body (300-800 AU) is 3-5 magnitudes too faint for it (VALIDATION §11).
- Blind test on real Makemake images: default options found nothing; loosened options found it as 1 of 38 candidates, while an empty field gives
  about 33 chance candidates (§12). A candidate resting on 5 dots or fewer carries a caution in the interface.
- The Earth's position is a low-precision formula; the spacecraft's own position is not used (not verified).

## Find everything

- It lists what the images show and what the catalogues explain. On six real 5′ fields all 42 sources were explained; **it found nothing new, and
  that test cannot say whether it would**.
- Depth: a fixed source needs 3 individual detections (about 0.7-1.5 mJy in a clean field); a mover needs about 50 times the detector noise;
  brown dwarfs like WISE 0855 (about 0.4 mJy in a stack) are below it. Stacking would go deeper and is not done.
- The "needs checking" threshold (support 65 and present in 30 % of the images of its passes) lets through about 1 false lead per 21 empty
  fields on average, from 0.005 to 0.16 depending on the field. The score is a sum of documented terms, not a probability.
- Near a very bright star many real sources are classed "possible artefact" (35-65 % of injected ones in the Barnard fields): conservative on purpose.
- Catalogue epochs for 2MASS and AllWISE are approximate; a cut-short catalogue answer or SIMBAD alone cannot call a source new.
- The positions CSV is not an MPC/ADES report.

## Viewer (zoom, pan, readout)

- Zoom enlarges the cutout's pixels (nearest neighbour, no smoothing): it adds no detail and never changes a measurement. Sky position under the cursor uses the same
  flat-sky formula as everything else (`geometry.js`); zooming and panning leave it exactly as it was (`test_view.mjs`).
- **The flat-sky mapping is not exact.** The images are TAN projections; the page maps RA/Dec with a flat approximation. Measured against the exact projection at the
  corner of a field (`scratch/test_grid.mjs`): 5′ cutout 0.002 px at Dec 5° and 0.035 px at Dec 60°; 30′ cutout 0.06 px at Dec 5° but **1.2 px at Dec 60°**. Fine for the
  5′ fields the app mostly uses; for a 30′ field far from the equator a position near a corner is good to about a pixel (6″), and the grid and the readout share that error.
- The **coordinate grid** is drawn on round values (RA in seconds of time, Dec in arcseconds or arcminutes) with the same flat mapping: a line is where the page believes
  that RA or Dec is, to the accuracy above. It is not a WCS from the FITS file. Near a pole the RA lines are left out.
- *Centre the picture on it* puts the candidate's position **on the image shown** in the middle (in Stack, Trail and Compare: the middle of its whole path) and zooms to at
  least ×6. It does not follow the candidate from image to image.
- The **value** in the readout is the pixel of the *cutout the backend made*: resampled onto a common grid (bilinear) and background-subtracted, in the file's own
  unit (its `BUNIT`, shown as is; "MJy/sr" for SPHEREx). It is **not** the original detector pixel and not calibrated photometry. A file without `BUNIT` shows no unit.
  Checked on one real frame (Barnard D2, frame 7 of 18, pixel 24,24: 680.2 and pixel 24,20: 4.206 read from the backend's float file with a separate script; the page showed 680 and 4.21).
- With **synthetic** data there are no float pixels: the readout shows the 8-bit *display level* (0-255 of the picture's stretch), which is not a physical value.
- The value is shown in Blink mode only; in Difference, Stack, Trail and Compare the picture is a combination of images, so no single value belongs to it.
- Pixel numbers count from 0 at the top-left of the cutout; the centre of the field is pixel 24 of a 49-pixel (5′) cutout.

## Spectra

- The colour hint (flux at 4-5 µm over flux at 1-2 µm) cannot tell an M dwarf from an early T dwarf and is not a classification.
- Spectra are built from images taken at different times: a variable source mixes variability with spectral shape.
