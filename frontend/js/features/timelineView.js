// timelineView.js – the page part of the timeline: one button per image on a time × wavelength plot, survey-pass switches, a wavelength window.
// The maths (layout, filter, texts) is in timeline.js (pure, tested: scratch/test_timeline.mjs); this file only builds the buttons and connects them
// to the player, so it is checked in the browser.
//
//   const timeline = setupTimeline({ root, player, onFilterChange });
//   timeline.setFrames(frames);   // after the player has them; [] hides the timeline
//   timeline.setCurrent(index);   // the image on screen
//
// A click on a point shows that image. The filter (passes switched off, wavelength window) tells the player which images the blink visits and which ones
// Stack, Trail and Difference use; the searches are not affected.

import { layoutTimeline, activeIndices, describeFrame, timelineSummary, isFiltered, surveyPasses, hasManyFlags } from "./timeline.js";

export function setupTimeline({ root, player, onFilterChange = () => {} }) {
  const $ = (id) => root.querySelector(`#${id}`);
  const els = {
    summary: $("tl-summary"), points: $("tl-points"), band: $("tl-band"), passes: $("tl-passes"),
    min: $("tl-wl-min"), max: $("tl-wl-max"), minOut: $("tl-min-out"), maxOut: $("tl-max-out"), reset: $("tl-reset"),
    axisHi: $("tl-axis-hi"), axisLo: $("tl-axis-lo"), note: $("tl-note"),
  };
  let frames = [], layout = null, dots = [], passButtons = [];
  const offPasses = new Set();
  let current = 0;

  const filter = () => ({ wlMin: Number(els.min.value), wlMax: Number(els.max.value), offPasses });

  function setFrames(list) {
    frames = list;
    offPasses.clear();
    root.hidden = frames.length < 2;                                  // one image: nothing to see on a timeline
    els.points.replaceChildren();
    els.passes.replaceChildren();
    dots = []; passButtons = [];
    if (root.hidden) { els.summary.textContent = ""; return; }

    layout = layoutTimeline(frames);
    const { range } = layout;
    const passes = surveyPasses(frames);

    dots = frames.map((f, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `tl-dot${hasManyFlags(f) ? " has-flags" : ""}`;
      b.style.left = `${layout.points[i].x * 100}%`;
      b.style.bottom = `${layout.points[i].y * 100}%`;
      const text = describeFrame(f, i, frames.length);
      b.setAttribute("aria-label", text);
      b.title = text;
      b.tabIndex = -1;
      b.addEventListener("click", () => { player.pause(); player.goTo(i); });
      return b;
    });
    els.points.append(...dots);

    passButtons = passes.map((p, k) => {
      const span = layout.passes[k];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tl-pass";
      b.style.left = `${span.x0 * 100}%`;
      b.style.width = `${(span.x1 - span.x0) * 100}%`;
      b.setAttribute("aria-pressed", "true");
      b.title = `${p.label}: ${p.when} · ${p.indices.length} image${p.indices.length === 1 ? "" : "s"}. Press to leave this pass out of stepping, Stack, Trail and Difference (press again to bring it back).`;
      b.setAttribute("aria-label", p.label);
      const word = document.createElement("span");                        // "Pass " is dropped on a narrow screen, where the button holds only the number
      word.className = "tl-pass-word";
      word.textContent = "Pass ";
      b.append(word, String(p.id + 1));
      b.addEventListener("click", () => {
        if (offPasses.has(p.id)) offPasses.delete(p.id); else offPasses.add(p.id);
        apply();
      });
      return b;
    });
    els.passes.append(...passButtons);

    // the wavelength window: the sliders start at the ends of the range of this detector, rounded outwards to 0.01 µm
    const lo = range ? Math.floor(range.min * 100) / 100 : 0, hi = range ? Math.ceil(range.max * 100) / 100 : 0;
    for (const s of [els.min, els.max]) { s.min = String(lo); s.max = String(hi); s.step = "0.01"; s.disabled = !range || hi <= lo; }
    els.min.value = String(lo);
    els.max.value = String(hi);
    els.axisLo.textContent = range ? `${range.min.toFixed(2)} µm` : "";
    els.axisHi.textContent = range ? `${range.max.toFixed(2)} µm` : "";
    apply({ silent: true });
    setCurrent(Math.min(current, frames.length - 1));
  }

  /** Read the filter, tell the player, redraw the plot. */
  function apply({ silent = false } = {}) {
    if (!layout) return;
    let lo = Number(els.min.value), hi = Number(els.max.value);
    els.minOut.textContent = `${lo.toFixed(2)} µm`;
    els.maxOut.textContent = `${hi.toFixed(2)} µm`;
    const active = activeIndices(frames, filter());
    const on = new Set(active);
    dots.forEach((b, i) => { b.classList.toggle("is-off", !on.has(i)); });
    passButtons.forEach((b, k) => {
      const off = offPasses.has(k);
      b.setAttribute("aria-pressed", String(!off));
      b.classList.toggle("is-off", off);
    });
    // the shaded band: the part of the plot between the two sliders
    const { range } = layout, span = range ? range.max - range.min : 0;
    const frac = (w) => (span > 0 ? Math.min(1, Math.max(0, (w - range.min) / span)) : 0);
    els.band.style.bottom = `${frac(lo) * 100}%`;
    els.band.style.height = `${Math.max(0, frac(hi) - frac(lo)) * 100}%`;
    els.band.hidden = !(span > 0) || (frac(lo) === 0 && frac(hi) === 1);
    els.summary.textContent = timelineSummary(frames, active);
    const filtered = isFiltered(active, frames.length);
    els.reset.disabled = !filtered && offPasses.size === 0 && !(lo > Number(els.min.min) || hi < Number(els.max.max));
    els.note.textContent = active.length === 0
      ? "No image passes this filter: the blink has nothing to visit, and Stack, Trail and Difference show the plain picture. Press “Show all”."
      : filtered
        ? `The blink visits only these ${active.length} images, and Stack, Trail and Difference are made from them (Difference uses the reference images of other passes that also pass the filter). Find movers and Find everything still use all ${frames.length}.`
        : "Every image is used. Switch a pass off or narrow the wavelength window to leave images out of stepping, Stack, Trail and Difference; the searches always use all of them.";
    player.setActive(active);
    if (!silent) onFilterChange(active);
  }

  els.min.addEventListener("input", () => { if (Number(els.min.value) > Number(els.max.value)) els.max.value = els.min.value; apply(); });
  els.max.addEventListener("input", () => { if (Number(els.max.value) < Number(els.min.value)) els.min.value = els.max.value; apply(); });
  els.reset.addEventListener("click", () => {
    offPasses.clear();
    els.min.value = els.min.min;
    els.max.value = els.max.max;
    apply();
  });

  /** Mark the image on screen. Only it is in the tab order (the arrow keys and the slider step through the others). */
  function setCurrent(index) {
    current = index;
    dots.forEach((b, i) => {
      const is = i === index;
      b.classList.toggle("is-current", is);
      if (is) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
      b.tabIndex = is ? 0 : -1;
    });
  }

  return { setFrames, setCurrent, refresh: () => apply({ silent: true }) };
}
