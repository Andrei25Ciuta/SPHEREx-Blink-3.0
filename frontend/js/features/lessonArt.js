// lessonArt.js – the illustrations of the Learn Mode theory lessons (schematic, not to scale; always on a dark sky, in every theme).
// Each entry: { label (for screen readers), caption, svg (inner markup for viewBox 0 0 600 200) }.

const stars = (n, seed = 3) => Array.from({ length: n }, (_, i) => {
  const x = (i * 97 + seed * 31) % 600, y = (i * 53 + seed * 17) % 200, r = i % 9 ? 0.8 : 1.6;
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" fill-opacity="${0.25 + (i % 5) * 0.13}"/>`;
}).join("");

function spiral(cx, cy, start, turns, a, b, squash = 1) {
  let d = "";
  for (let t = 0; t <= turns * Math.PI * 2; t += 0.08) {
    const r = a * Math.exp(b * t);
    d += (d ? "L" : "M") + (cx + r * Math.cos(t + start)).toFixed(1) + " " + (cy + r * Math.sin(t + start) * squash).toFixed(1);
  }
  return d;
}

const DEFS = `<defs>
  <linearGradient id="la-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1330"/><stop offset="1" stop-color="#050812"/></linearGradient>
  <linearGradient id="la-ir" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff5a4d"/><stop offset=".3" stop-color="#ff9a3c"/><stop offset=".55" stop-color="#ffd166"/><stop offset=".8" stop-color="#7cc6fe"/><stop offset="1" stop-color="#9b7bff"/></linearGradient>
  <radialGradient id="la-sun"><stop offset="0" stop-color="#fffbe6"/><stop offset=".35" stop-color="#ffd166"/><stop offset=".7" stop-color="#ff9a3c" stop-opacity=".5"/><stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/></radialGradient>
  <radialGradient id="la-core"><stop offset="0" stop-color="#fff6d8"/><stop offset=".4" stop-color="#ffd98a" stop-opacity=".9"/><stop offset="1" stop-color="#ffb35c" stop-opacity="0"/></radialGradient>
  <radialGradient id="la-pink"><stop offset="0" stop-color="#ff6fae" stop-opacity=".75"/><stop offset="1" stop-color="#ff6fae" stop-opacity="0"/></radialGradient>
  <radialGradient id="la-teal"><stop offset="0" stop-color="#3fd0c9" stop-opacity=".6"/><stop offset="1" stop-color="#3fd0c9" stop-opacity="0"/></radialGradient>
  <radialGradient id="la-violet"><stop offset="0" stop-color="#8e7bff" stop-opacity=".7"/><stop offset="1" stop-color="#8e7bff" stop-opacity="0"/></radialGradient>
  <filter id="la-blur"><feGaussianBlur stdDeviation="6"/></filter><filter id="la-soft"><feGaussianBlur stdDeviation="2"/></filter>
  <clipPath id="la-map"><ellipse cx="300" cy="100" rx="210" ry="80"/></clipPath>
</defs><rect width="600" height="200" fill="url(#la-sky)"/>`;

export const LESSON_ART = {
  atlas: {
    label: "Illustration of an all-sky map coloured by infrared wavelength, with the band of the Milky Way across it",
    caption: "Illustration · SPHEREx maps the whole sky in 102 infrared colours; the map is shown here as an oval.",
    svg: `${DEFS}${stars(70)}
      <g clip-path="url(#la-map)"><rect x="90" y="20" width="420" height="160" fill="url(#la-ir)" opacity=".35"/>
        ${Array.from({ length: 6 }, (_, i) => `<rect x="${90 + i * 70}" y="20" width="70" height="160" fill="#000" opacity="${0.05 + (i % 2) * 0.08}"/>`).join("")}
        <path d="M90 140 C200 60 400 140 510 60" stroke="#fff3d6" stroke-width="26" stroke-opacity=".35" fill="none" filter="url(#la-blur)"/>
        ${stars(40, 7)}</g>
      <ellipse cx="300" cy="100" rx="210" ry="80" fill="none" stroke="#c9d6ff" stroke-opacity=".6"/>
      <path d="M300 20V180M90 100H510" stroke="#c9d6ff" stroke-opacity=".2"/>
      <g transform="translate(520 34)"><rect x="-8" y="-6" width="16" height="12" rx="2" fill="#d8dde8"/><rect x="-30" y="-3" width="20" height="6" fill="#3b6fd8"/><rect x="10" y="-3" width="20" height="6" fill="#3b6fd8"/></g>`,
  },
  star: {
    label: "Illustration of a glowing star with its light spread into a spectrum below it",
    caption: "Illustration · spreading a star's light into colours reveals dark lines: clues to what it is made of.",
    svg: `${DEFS}${stars(60, 5)}
      <circle cx="170" cy="92" r="70" fill="url(#la-sun)"/><circle cx="170" cy="92" r="26" fill="#fff4cc"/>
      ${Array.from({ length: 12 }, (_, i) => { const a = i * Math.PI / 6; return `<line x1="${170 + 34 * Math.cos(a)}" y1="${92 + 34 * Math.sin(a)}" x2="${170 + 56 * Math.cos(a)}" y2="${92 + 56 * Math.sin(a)}" stroke="#ffd166" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>`; }).join("")}
      <path d="M250 92 L330 70 L330 114 Z" fill="#fff" fill-opacity=".08"/>
      <rect x="330" y="70" width="230" height="44" rx="4" fill="url(#la-ir)"/>
      ${[352, 381, 404, 447, 470, 512, 538].map((x, i) => `<rect x="${x}" y="70" width="${i % 3 ? 2 : 3}" height="44" fill="#050812" fill-opacity=".8"/>`).join("")}
      <text x="330" y="134" fill="#c9d6ff" font-size="12">spectrum: dark lines = fingerprints</text>`,
  },
  nebula: {
    label: "Illustration of a colourful cloud of gas and dust with young stars inside",
    caption: "Illustration · a nebula is a cloud of gas and dust; some are places where new stars form.",
    svg: `${DEFS}${stars(80, 9)}
      <ellipse cx="260" cy="100" rx="190" ry="70" fill="url(#la-violet)" filter="url(#la-blur)"/>
      <ellipse cx="220" cy="90" rx="120" ry="50" fill="url(#la-pink)" filter="url(#la-blur)"/>
      <ellipse cx="350" cy="115" rx="120" ry="45" fill="url(#la-teal)" filter="url(#la-blur)"/>
      <path d="M120 120 C200 80 260 150 340 100 S470 90 500 120" stroke="#1a0f1f" stroke-width="14" stroke-opacity=".6" fill="none" filter="url(#la-soft)"/>
      ${[[230, 85, 4], [300, 112, 3], [190, 108, 2.5], [372, 92, 3.5]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r * 3}" fill="url(#la-sun)"/><circle cx="${x}" cy="${y}" r="${r}" fill="#fff"/>`).join("")}`,
  },
  galaxy: {
    label: "Illustration of a spiral galaxy with a bright centre and curved arms",
    caption: "Illustration · a galaxy is a vast family of stars, gas and dust held together by gravity.",
    svg: `${DEFS}${stars(60, 11)}
      <ellipse cx="300" cy="100" rx="190" ry="80" fill="url(#la-violet)" opacity=".5"/>
      ${[0, Math.PI].map((s) => `<path d="${spiral(300, 100, s, 1.5, 12, 0.27, 0.45)}" stroke="#cbb8ff" stroke-width="8" stroke-opacity=".55" fill="none" filter="url(#la-soft)"/><path d="${spiral(300, 100, s + 0.35, 1.3, 12, 0.27, 0.45)}" stroke="#ffe3f1" stroke-width="2" stroke-opacity=".5" fill="none"/>`).join("")}
      <ellipse cx="300" cy="100" rx="40" ry="20" fill="url(#la-core)"/>`,
  },
  orbit: {
    label: "Diagram of Earth on two sides of its orbit around the Sun, seeing a nearby object against different background stars",
    caption: "Diagram · from opposite sides of Earth's orbit a nearby object seems to shift against far stars: that is parallax. Not to scale.",
    svg: `${DEFS}${stars(50, 13)}
      <ellipse cx="160" cy="100" rx="110" ry="40" fill="none" stroke="#7cc6fe" stroke-opacity=".5" stroke-dasharray="4 5"/>
      <circle cx="160" cy="100" r="30" fill="url(#la-sun)"/><circle cx="160" cy="100" r="11" fill="#fff4cc"/>
      <circle cx="160" cy="60" r="7" fill="#4c9be8"/><circle cx="160" cy="140" r="7" fill="#4c9be8"/>
      <text x="172" y="56" fill="#9fd0ff" font-size="11">Earth in January</text><text x="172" y="156" fill="#9fd0ff" font-size="11">Earth in July</text>
      <circle cx="420" cy="100" r="6" fill="#ff9b55"/><text x="400" y="88" fill="#ffc49a" font-size="11">nearby object</text>
      <line x1="160" y1="60" x2="560" y2="135" stroke="#ff9b55" stroke-opacity=".6"/><line x1="160" y1="140" x2="560" y2="65" stroke="#ff9b55" stroke-opacity=".6"/>
      <circle cx="560" cy="135" r="3" fill="#fff"/><circle cx="560" cy="65" r="3" fill="#fff"/><text x="520" y="30" fill="#c9d6ff" font-size="11">far stars</text>`,
  },
  steward: {
    label: "Illustration of an observer's checklist with three ticked items",
    caption: "Illustration · record where the data came from, label simulations, and call a find a candidate until others check it.",
    svg: `${DEFS}${stars(40, 17)}
      <rect x="150" y="22" width="300" height="156" rx="12" fill="#121a33" stroke="#c9d6ff" stroke-opacity=".3"/>
      <text x="175" y="50" fill="#e8ebf2" font-size="14" font-weight="700">Observer's checklist</text>
      ${["Where did the data come from?", "Is it real, or a simulation?", "Call it a candidate"].map((t, i) => `<circle cx="186" cy="${84 + i * 34}" r="11" fill="#2bb673"/><path d="M180 ${84 + i * 34} l4 4 l8 -9" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/><text x="206" y="${89 + i * 34}" fill="#c9d6ff" font-size="13">${t}</text>`).join("")}`,
  },
};
