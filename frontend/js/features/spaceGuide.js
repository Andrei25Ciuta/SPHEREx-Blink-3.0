// Offline, source-grounded vocabulary for Astra and the Science Mode "Explain Simply" controls.
export const GLOSSARY = [
  { terms: ["redshift"], label: "Redshift", simple: "Light waves stretch as the universe expands, a little like the waves from a siren spread out as it moves away. That stretching can shift light toward redder and infrared wavelengths.", context: "Redshift is a change in wavelength caused by motion or the expansion of space. Astronomers use it to learn about distant objects; it is not a direct ruler by itself." },
  { terms: ["spectral signature", "spectrum", "spectroscopy"], label: "Spectral signature", simple: "A pattern in an object's light, like a set of fingerprints. It can give clues about the materials around the object.", context: "A spectrum measures light across wavelengths. Absorption and emission features can identify physical conditions and molecules, with interpretation depending on the data and model." },
  { terms: ["signal-to-noise ratio", "signal to noise", "snr"], label: "Signal-to-noise ratio", simple: "How clearly a signal rises above random background. A higher number usually makes a source easier to see.", context: "Signal-to-noise compares measured source signal with an estimate of noise. It describes detectability, not whether an object is new or what it is." },
  { terms: ["candidate mover", "mover", "moving object"], label: "Candidate mover", simple: "A dot that seems to shift between pictures taken at different times. It is a clue to check, not a confirmed discovery.", context: "A moving-source candidate is linked from image detections. Chance alignments, blends, variables, and artefacts can mimic motion." },
  { terms: ["infrared emission", "infrared", "ir light"], label: "Infrared light", simple: "Light beyond the red edge of the rainbow. Your eyes cannot see it, but telescopes can measure it; warm objects and dust can glow in infrared.", context: "Infrared has longer wavelengths than visible light. Some infrared wavelengths pass through dusty regions more readily than visible light." },
  { terms: ["provenance", "data source"], label: "Provenance", simple: "A record of where data came from and how it was handled, so another person can check the work.", context: "In this project, provenance records whether inputs are synthetic or observed and captures details of the analysis run." },
  { terms: ["nebula", "nebulae"], label: "Nebula", simple: "A huge cloud of gas and dust in space. Some are places where stars form; others are material released by dying stars.", context: "Nebulae have different physical origins and appearances; a single image can show only some of their structure." },
  { terms: ["galaxy", "galaxies"], label: "Galaxy", simple: "A very large family of stars, gas, dust, and other matter held together by gravity.", context: "Galaxies vary in structure. Their light can be studied across wavelengths to learn about their stars and history." },
  { terms: ["planet x", "planet nine", "distant body"], label: "Planet X search", simple: "The project tests whether a moving dot matches a pattern expected from Earth's orbit. A match is a candidate, not proof a planet exists.", context: "A parallax fit is model-dependent. Planet X is hypothetical; this application does not claim to have found it." },
];

function normalize(text) {
  return String(text ?? "").toLocaleLowerCase().replace(/[–—]/g, "-").trim();
}

export function explanationFor(text) {
  const query = normalize(text);
  const found = GLOSSARY.find((item) => item.terms.some((term) => query.includes(term)));
  return found ?? {
    label: "Astra's space guide",
    simple: "I do not have a prepared answer for that yet. Try asking about infrared light, stars, nebulae, galaxies, moving objects, or Planet X.",
    context: "Astra uses a small offline set of reviewed explanations. It does not send your question to a model or search the internet.",
  };
}

export function answerAstra(question) {
  const answer = explanationFor(question);
  return `${answer.label}: ${answer.simple}`;
}
