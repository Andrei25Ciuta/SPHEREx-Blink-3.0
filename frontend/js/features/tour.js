// tour.js – a one-minute guided tour of the workspace (coach marks).
//
// It works with no network and no data: every step only points at a part of the page and says what it is for, so
// it also runs on the offline demo. It changes nothing in the app. Keyboard: Right/Left (or Enter) = next/back,
// Esc = close, Tab stays inside the card; focus goes back to the button that started it.
//
// The pure parts (stepping, where to put the card) are exported for Node tests; startTour() is the DOM part.

/** Next index when moving by `dir` (+1/-1) among n steps: clamped at the start, -1 when moving past the end. */
export function nextIndex(i, n, dir) {
  const j = i + dir;
  if (j < 0) return 0;
  return j >= n ? -1 : j;
}

export const stepLabel = (i, n) => `${i + 1} / ${n}`;

/**
 * Where to put the card (px, viewport coordinates) around a highlighted rectangle.
 * target = { top, left, width, height }, card = { width, height }, view = { width, height }.
 * Below the target if it fits, else above, else pinned inside the bottom edge. On a narrow screen the card
 * is a full-width sheet at the bottom. The card never leaves the viewport.
 */
export function placeCard(target, card, view, { gap = 12, margin = 8, narrow = 520 } = {}) {
  if (view.width < narrow) {
    return { placement: "sheet", left: margin, top: Math.max(margin, view.height - card.height - margin), width: view.width - 2 * margin };
  }
  const clampLeft = (x) => Math.min(Math.max(margin, x), view.width - card.width - margin);
  const left = clampLeft(target.left + target.width / 2 - card.width / 2);
  const below = target.top + target.height + gap;
  if (below + card.height + margin <= view.height) return { placement: "below", left, top: below, width: card.width };
  const above = target.top - gap - card.height;
  if (above >= margin) return { placement: "above", left, top: above, width: card.width };
  return { placement: "inside", left, top: Math.max(margin, view.height - card.height - margin), width: card.width };
}

/** The part of a rectangle that is on screen (a tall target is highlighted only where it is visible). */
export function clipToView(rect, view) {
  const top = Math.max(0, rect.top), left = Math.max(0, rect.left);
  const bottom = Math.min(view.height, rect.top + rect.height), right = Math.min(view.width, rect.left + rect.width);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * Run the tour. steps: [{ target: "#css-selector", title, text }]. A step whose target is missing or hidden is skipped.
 * Returns { close() }. onClose({ finished }) is called once, when the tour ends or is closed.
 */
export function startTour(steps, { onClose = () => {} } = {}) {
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const opener = document.activeElement;
  const usable = steps.filter((s) => { const el = document.querySelector(s.target); return el && el.getClientRects().length; });
  if (!usable.length) { onClose({ finished: false }); return { close() {} }; }

  const spot = Object.assign(document.createElement("div"), { className: "tour-spot" });
  const card = document.createElement("div");
  card.className = "tour-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "tour-title");
  card.setAttribute("aria-describedby", "tour-text");
  card.innerHTML = `
    <p class="tour-count" id="tour-count"></p>
    <h3 class="tour-title" id="tour-title"></h3>
    <p class="tour-text" id="tour-text"></p>
    <div class="tour-actions">
      <button type="button" class="btn btn-small tour-skip">Skip tour</button>
      <span class="tour-spacer"></span>
      <button type="button" class="btn btn-small tour-back">Back</button>
      <button type="button" class="btn btn-primary btn-small tour-next">Next</button>
    </div>`;
  document.body.append(spot, card);

  const q = (s) => card.querySelector(s);
  const [skip, back, next] = [q(".tour-skip"), q(".tour-back"), q(".tour-next")];
  let index = 0, closed = false, frame = 0;

  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, width: r.width, height: r.height }; };

  function position() {
    frame = 0;
    if (closed) return;
    const el = document.querySelector(usable[index].target);
    if (!el) return;
    const view = { width: innerWidth, height: innerHeight };
    const pad = 6;
    const raw = rectOf(el);
    const lit = clipToView({ top: raw.top - pad, left: raw.left - pad, width: raw.width + 2 * pad, height: raw.height + 2 * pad }, view);
    Object.assign(spot.style, { top: `${lit.top}px`, left: `${lit.left}px`, width: `${lit.width}px`, height: `${lit.height}px` });
    card.style.width = "";                                                     // measure at its natural width first
    const size = { width: Math.min(card.offsetWidth || 340, view.width - 16), height: card.offsetHeight };
    const p = placeCard(lit, size, view);
    Object.assign(card.style, { top: `${p.top}px`, left: `${p.left}px`, width: `${p.width}px` });
    card.dataset.placement = p.placement;
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(position); };

  function show(i) {
    index = i;
    const step = usable[i];
    q("#tour-count").textContent = stepLabel(i, usable.length);
    q("#tour-title").textContent = step.title;
    q("#tour-text").textContent = step.text;
    back.disabled = i === 0;
    next.textContent = i === usable.length - 1 ? "Done" : "Next";
    document.querySelector(step.target).scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    position();
    setTimeout(position, reduced ? 0 : 350);                                   // again when the smooth scroll has arrived
    next.focus({ preventScroll: true });
  }

  function close(finished) {
    if (closed) return;
    closed = true;
    removeEventListener("resize", schedule);
    removeEventListener("scroll", schedule, true);
    document.removeEventListener("keydown", onKey, true);
    spot.remove();
    card.remove();
    if (opener && typeof opener.focus === "function") opener.focus({ preventScroll: true });
    onClose({ finished });
  }
  function go(dir) {
    const j = nextIndex(index, usable.length, dir);
    if (j < 0) close(true); else show(j);
  }
  function onKey(e) {
    // The app has its own shortcuts on the same keys (arrows step the blink, Esc clears the marker): while the
    // tour is open the keys belong to the tour, so they do not travel on to the page behind it.
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(false); }
    else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); go(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); go(-1); }
    else if (e.key === "Tab") {                                                // keep the focus inside the card
      const order = [skip, back, next].filter((b) => !b.disabled);
      const at = order.indexOf(document.activeElement);
      e.preventDefault();
      e.stopPropagation();
      order[(at + (e.shiftKey ? order.length - 1 : 1)) % order.length].focus({ preventScroll: true });
    }
  }
  skip.addEventListener("click", () => close(false));
  back.addEventListener("click", () => go(-1));
  next.addEventListener("click", () => go(1));
  addEventListener("resize", schedule);
  addEventListener("scroll", schedule, true);
  document.addEventListener("keydown", onKey, true);
  show(0);
  return { close: () => close(false) };
}

/** The steps of the workspace tour (selectors are ids in index.html). */
export const WORKSPACE_STEPS = [
  { target: "#quick-pick-list", title: "Start with a known object",
    text: "Five objects chosen by the challenge. WISE 0855, the coldest known brown dwarf, moves about 8 arcseconds per year: small, but enough to see." },
  { target: "#search-form", title: "Or choose any patch of sky",
    text: "Type a position (degrees or hours-minutes-seconds) and a field of view up to 30 arcminutes. You get one image per observation date." },
  { target: "#stage", title: "Blink, and other ways to look",
    text: "The images of one detector flash one after another: stars stay put, something that moves jumps. Difference makes still stars vanish; Stack and Trail add the images up; Compare subtracts one set of dates from another (buttons above the picture)." },
  { target: "#movers", title: "Let the computer find them",
    text: "Find movers links dots across at least three survey passes and lists the ones that moved. Look for a distant body is the Planet X mode: it follows the swing the Earth's motion gives a body hundreds of AU away, and reads off its distance." },
  { target: "#inspector", title: "The inspector",
    text: "Facts about what you have selected: the image on screen, the position you marked with a click, and the description of the candidate you pressed in a list. The keys [ and ] hide the search panel and the inspector to give the picture room." },
  { target: "#measure-title", title: "Measure a source",
    text: "Click any dot for its spectrum (brightness against wavelength) and its light curve. For a candidate, Spectrum along its path measures it where it was on each date, and says what its colour suggests." },
  { target: "#sky-frame", title: "What is known here?",
    text: "The same field in 2MASS, AllWISE or DSS2. With real data you can also draw SIMBAD stars and the known asteroids that crossed the field (SkyBoT)." },
  { target: "#copy-link-btn", title: "Share what you found",
    text: "Copy link gives a view anyone can reopen, Embed code puts it on another page, and Save list exports the candidates as CSV or JSON, each file saying whether the data is real or synthetic." },
];
