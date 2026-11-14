// Keep wavelength comparisons within one survey pass and the active timeline filters.
import { midWavelength, surveyPasses } from "./timeline.js";

export function colourSequences(frames, activeIndices) {
  const active = new Set(activeIndices);
  return surveyPasses(frames).flatMap(pass => {
    const indices = pass.indices.filter(index => active.has(index))
      .sort((a, b) => midWavelength(frames[a]) - midWavelength(frames[b]));
    const first = frames[indices[0]];
    const last = frames[indices.at(-1)];
    return first && last && midWavelength(last) - midWavelength(first) > 1e-6
      ? [{ ...pass, indices }]
      : [];
  });
}
