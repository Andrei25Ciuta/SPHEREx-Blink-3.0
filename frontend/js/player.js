// player.js – the blink player. It knows nothing about astronomy:
// it shows a list of same-size grey images on a <canvas>, in one of several modes.
//
// Modes:
//   "blink" – the images one after another (the classic blink comparator)
//   "diff"  – each image MINUS the median of the images from OTHER dates (other survey
//             passes). Things that never change (most stars) cancel out; what is left
//             changed: moved or varied.
//             Orange = brighter than usual here, blue = fainter than usual.
//   "mean"  – average of all images: a deeper, less noisy single picture
//   "max"   – brightest value of each pixel over all images: a moving object
//             leaves a TRAIL of dots, a static star stays one dot
//   "compare" – YOUR choice: image A minus (or plus) image B, where A and B are single images or
//             whole survey passes (features/compare.js). Set with player.setCompare({ a, b, op }).
//
// Usage:
//   const player = new BlinkPlayer(canvas, { onFrameChange, onPlayStateChange });
//   await player.setFrames(frames, onProgress);  // preloads + decodes all images
//   player.setMode("diff"); player.play(); player.goTo(3); player.setFps(4);
//   player.setTracks([{ label, points: [{ fx, fy }, ...] }]);  // predicted positions, one per frame

import { combine } from "./features/compare.js";

export const MODES = ["blink", "diff", "mean", "max", "compare"];
const ANIMATED = new Set(["blink", "diff"]);       // modes that step through time

export class BlinkPlayer {
  constructor(canvas, { onFrameChange = () => {}, onPlayStateChange = () => {} } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onFrameChange = onFrameChange;           // called with (index, frame)
    this.onPlayStateChange = onPlayStateChange;   // called with (isPlaying)

    this.frames = [];       // metadata objects (the Frame contract)
    this.images = [];       // matching, already-decoded HTMLImageElements
    this.flagImages = [];   // optional flag masks (same index), or null
    this.index = 0;
    this.fps = 2;
    this.playing = false;
    this.mode = "blink";
    this.showFlags = false;
    this.marker = null;     // { fx, fy, rPx } in image fractions – the measuring aperture
    this.tracks = [];       // predicted positions of known objects: [{ label, points: [{fx, fy}] }]
    this.showTracks = true;
    this.candidates = [];   // movers found by "Find movers": [{ label, points: [{ fx, fy }] }], one point per frame
    this.selectedCandidate = -1;
    this.compare = null;    // { a: [frame indices], b: [frame indices], op: "sub" | "add" } for the "compare" mode
    this.catalogue = [];    // catalogue objects: [{ label, pm, moving, points: [{ fx, fy }] }], one point per frame
    this.asteroids = [];    // known asteroids per frame: [[{ name, fx, fy, vmag }] | null, ...] (features/skybot.js)
    this.lastTick = 0;
    this.rafId = null;

    // Pixel data, extracted lazily (only needed for diff/mean/max).
    this._grey = null;      // array of Uint8ClampedArray (one per frame), or null
    this._derived = {};     // cached median/mean/max arrays
    this._scratch = document.createElement("canvas");   // natural-size off-screen canvas
  }

  /**
   * Load a new set of frames. We wait until EVERY image is downloaded and decoded,
   * otherwise the first loop would flicker while images arrive one by one.
   * onProgress(done, total) is called as images arrive.
   */
  async setFrames(frames, onProgress = () => {}, isCurrent = () => true) {
    this.pause();
    this.frames = [];
    this.images = [];
    this.flagImages = [];
    this._grey = null;
    this._derived = {};
    this.compare = null;                            // frame indices of the old frames: invalid now
    this.catalogue = [];                            // points are per frame of the old frames
    this.asteroids = [];                            // so are these
    this.candidates = [];                           // they belong to the old frames
    this.selectedCandidate = -1;
    let done = 0;
    onProgress(0, frames.length);
    const images = await Promise.all(frames.map((f) =>
      loadImage(f.imageUrl, f).then((img) => { onProgress(++done, frames.length); return img; })));
    // Flag masks are optional and must never break the blink -> failures become null.
    const flagImages = await Promise.all(frames.map((f) =>
      f.flagsUrl ? loadImage(f.flagsUrl, f).catch(() => null) : Promise.resolve(null)));
    if (!isCurrent()) return;
    if (images.some(im => im.naturalWidth !== im.naturalHeight || im.naturalWidth !== images[0].naturalWidth))
      throw new Error("These images have different pixel grids. Reproject them to a common square cutout before blinking.");
    this.frames = frames;
    this.images = images;
    this.flagImages = flagImages;
    if (!ANIMATED.has(this.mode)) this.index = 0;
    this.goTo(0);
  }

  get length() { return this.frames.length; }
  get isAnimated() { return ANIMATED.has(this.mode); }
  get hasFlagMasks() { return this.flagImages.some(Boolean); }
  /** Natural size of the images (pixels of the cutout). */
  get naturalSize() { const im = this.images[0]; return im ? im.naturalWidth : 0; }

  setMode(mode) {
    if (!MODES.includes(mode)) return;
    this.mode = mode;
    if (!this.isAnimated) this.pause();
    this.draw();
  }

  setShowFlags(on) { this.showFlags = !!on; this.draw(); }
  setMarker(marker) { this.marker = marker; this.draw(); }
  /** tracks[i].points[k] = predicted position at the date of frame k (same order as frames). */
  setTracks(tracks) { this.tracks = tracks || []; this.draw(); }
  setShowTracks(on) { this.showTracks = !!on; this.draw(); }
  /** candidates[i].points[k] = where candidate i is on frame k's date (fractions, like tracks). */
  setCandidates(candidates, selected = -1) {
    this.candidates = candidates || [];
    this.selectedCandidate = selected;
    this.draw();
  }
  /** Grey pixels (0..255) of every frame, or null if the browser will not let us read them. */
  greyFrames() { return this._greys(); }
  /** What the "compare" mode shows: a, b = frame indices (averaged if several), op = "sub" (A − B) or "add" (A + B). */
  setCompare(compare) { this.compare = compare; this.draw(); }
  /** Catalogue objects at each frame's date (features/catalogue.js): small rings, names + paths for the moving ones. */
  setCatalogue(catalogue) { this.catalogue = catalogue || []; this.draw(); }
  /** Known asteroids on every frame's date (features/skybot.js asteroidPoints): amber diamonds. */
  setAsteroids(asteroids) { this.asteroids = asteroids || []; this.draw(); }

  /** Show frame i (wraps around, so goTo(-1) = last frame). */
  goTo(i) {
    if (!this.length) return;
    this.index = ((i % this.length) + this.length) % this.length;
    this.draw();
    this.onFrameChange(this.index, this.frames[this.index]);
  }

  next() { this.goTo(this.index + 1); }
  prev() { this.goTo(this.index - 1); }

  draw() {
    const img = this.images[this.index];
    if (!img) return;
    const { ctx, canvas } = this;
    ctx.imageSmoothingEnabled = false;            // keep SPHEREx pixels sharp
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (this.mode === "blink") {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    } else {
      const rgba = this._renderDerived();
      if (rgba) this._drawRgba(rgba);
      else ctx.drawImage(img, 0, 0, canvas.width, canvas.height);   // fallback (e.g. tainted image)
    }

    if (this.showFlags) {
      const masks = this.isAnimated ? [this.flagImages[this.index]] : this.flagImages;
      ctx.globalAlpha = this.isAnimated ? 0.85 : 0.35;
      for (const m of masks) if (m) ctx.drawImage(m, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }

    if (this.showTracks && this.tracks.length) this._drawTracks();
    if (this.catalogue.length) this._drawCatalogue();
    if (this.asteroids.length) this._drawAsteroids();
    if (this.candidates.length) this._drawCandidates();
    if (this.marker) this._drawMarker();
  }

  /** The image currently on screen, as a PNG data: URL (for "save frame"). */
  snapshot() { return this.canvas.toDataURL("image/png"); }

  setFps(fps) { this.fps = Math.max(0.1, Number(fps) || 1); }

  play() {
    if (this.playing || this.length < 2 || !this.isAnimated) return;
    this.playing = true;
    this.lastTick = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
    this.onPlayStateChange(true);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.rafId);
    this.onPlayStateChange(false);
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  /**
   * Animation loop. requestAnimationFrame calls us ~60×/s (and pauses in hidden tabs).
   * We only advance when enough time has passed for the chosen fps.
   * Arrow function so `this` still points to the player when the browser calls it.
   */
  tick = (now) => {
    if (!this.playing) return;
    if (now - this.lastTick >= 1000 / this.fps) {
      this.lastTick = now;
      this.next();
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  // ------------------------------------------------------------------ pixel maths

  /** Grey value (0..255) of every pixel of every frame. null if pixels can't be read. */
  _greys() {
    if (this._grey) return this._grey;
    const n = this.naturalSize;
    if (!n || this.images.some((im) => im.naturalWidth !== n || im.naturalHeight !== n)) return null;
    const c = this._scratch;
    c.width = c.height = n;
    const cx = c.getContext("2d", { willReadFrequently: true });
    try {
      this._grey = this.images.map((im) => {
        cx.clearRect(0, 0, n, n);
        cx.drawImage(im, 0, 0);
        const d = cx.getImageData(0, 0, n, n).data;
        const g = new Uint8ClampedArray(n * n);
        for (let i = 0; i < g.length; i++) g[i] = d[4 * i];   // R channel = grey
        return g;
      });
    } catch (err) {
      // A cross-origin image without CORS "taints" the canvas -> pixels unreadable.
      console.warn("Cannot read image pixels (CORS?) – difference/stack modes disabled.", err);
      return null;
    }
    return this._grey;
  }

  /**
   * Per-pixel statistic over a set of frames (cached).
   * kind: "mean" | "max" | "median";  members: frame indices (default: all).
   */
  _stat(kind, members = null) {
    const greysAll = this._greys();
    if (!greysAll) return null;
    const idx = members ?? greysAll.map((_, i) => i);
    const key = `${kind}:${idx.join(",")}`;
    if (this._derived[key]) return this._derived[key];
    const greys = idx.map((i) => greysAll[i]);
    const len = greys[0].length, k = greys.length;
    const out = new Float32Array(len);
    const col = new Float32Array(k);
    for (let i = 0; i < len; i++) {
      if (kind === "mean") {
        let s = 0; for (let f = 0; f < k; f++) s += greys[f][i];
        out[i] = s / k;
      } else if (kind === "max") {
        let m = 0; for (let f = 0; f < k; f++) if (greys[f][i] > m) m = greys[f][i];
        out[i] = m;
      } else {                                   // median (typed arrays sort numerically)
        for (let f = 0; f < k; f++) col[f] = greys[f][i];
        col.sort();
        out[i] = k % 2 ? col[(k - 1) / 2] : (col[k / 2 - 1] + col[k / 2]) / 2;
      }
    }
    return (this._derived[key] = out);
  }

  /**
   * Reference frames for the difference of frame i: frames taken more than
   * REF_GAP_DAYS away (another survey pass). If a moving object sat still within one
   * pass, a median over ALL frames would "learn" it and hide it – excluding the frame's
   * own pass prevents that. Falls back to "all other frames" if no other pass exists.
   */
  _referenceFor(i) {
    const REF_GAP_DAYS = 30;
    const t = this.frames[i].mjd;
    const far = this.frames.map((f, j) => j).filter((j) => Math.abs(this.frames[j].mjd - t) > REF_GAP_DAYS);
    const members = far.length ? far : this.frames.map((f, j) => j).filter((j) => j !== i);
    return this._stat("median", members.length ? members : [i]);
  }

  /** RGBA pixels for the current non-blink view, or null. */
  _renderDerived() {
    const greys = this._greys();
    if (!greys) return null;
    const len = greys[0].length;
    const rgba = new Uint8ClampedArray(len * 4);

    if (this.mode === "diff") {
      const med = this._referenceFor(this.index);
      const cur = greys[this.index];
      const GAIN = 2.2;                          // makes small changes visible
      for (let i = 0; i < len; i++) {
        const d = (cur[i] - med[i]) * GAIN;
        const a = Math.min(255, Math.abs(d));
        // Diverging colours on black: orange = brighter now, blue = fainter now.
        if (d >= 0) { rgba[4 * i] = a; rgba[4 * i + 1] = a * 0.62; rgba[4 * i + 2] = a * 0.2; }
        else { rgba[4 * i] = a * 0.25; rgba[4 * i + 1] = a * 0.62; rgba[4 * i + 2] = a; }
        rgba[4 * i + 3] = 255;
      }
    } else if (this.mode === "compare") {
      const c = this.compare;
      if (!c || !c.a.length || !c.b.length) return null;
      return combine(this._stat("mean", c.a), this._stat("mean", c.b), c.op);
    } else {
      const s = this._stat(this.mode === "mean" ? "mean" : "max");
      for (let i = 0; i < len; i++) {
        rgba[4 * i] = rgba[4 * i + 1] = rgba[4 * i + 2] = s[i];
        rgba[4 * i + 3] = 255;
      }
    }
    return rgba;
  }

  _drawRgba(rgba) {
    const n = this.naturalSize;
    const c = this._scratch;
    c.width = c.height = n;
    const cx = c.getContext("2d", { willReadFrequently: true });
    cx.putImageData(new ImageData(rgba, n, n), 0, 0);
    this.ctx.drawImage(c, 0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Predicted track: a thin dashed line through all predicted positions, a dot per date,
   * and – for the frame on screen – four ticks AROUND the spot (never on top of it, so the
   * real object stays visible). Green: distinct from the diff colours and the yellow aperture.
   */
  _drawTracks() {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    const COLOR = "#FBE9D0";
    ctx.save();
    ctx.shadowColor = "#000"; ctx.shadowBlur = 3;
    for (const t of this.tracks) {
      const pts = t.points.map((p) => [p.fx * W, p.fy * H]);
      if (!pts.length) continue;

      ctx.strokeStyle = COLOR; ctx.fillStyle = COLOR;
      ctx.globalAlpha = 0.6; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
      ctx.beginPath();
      pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 2 * Math.PI); ctx.fill(); }

      // Ticks around the current frame's prediction (or around the last one when stacked).
      const [cx, cy] = this.isAnimated ? (pts[this.index] ?? pts[0]) : pts.at(-1);
      ctx.globalAlpha = 1; ctx.lineWidth = 2;
      const r0 = 8, r1 = 17;
      ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.moveTo(cx + dx * r0, cy + dy * r0);
        ctx.lineTo(cx + dx * r1, cy + dy * r1);
      }
      ctx.stroke();

      // Label, kept inside the canvas.
      ctx.font = "600 13px Inter, system-ui, sans-serif";
      const text = `${t.label} (predicted)`;
      const tw = ctx.measureText(text).width;
      let lx = cx + 20, ly = cy - 20;
      if (lx + tw > W - 6) lx = cx - 20 - tw;
      if (ly < 16) ly = cy + 32;
      ctx.fillText(text, Math.max(6, lx), Math.min(H - 6, ly));
    }
    ctx.restore();
  }

  /**
   * Movers found by "Find movers": an orange ring around each one at the date on screen, its
   * number beside it, and – for the selected one – its whole path (dashed) with a dot per date.
   * Orange stays visible on the grey images; the predicted tracks of known objects are cream.
   */
  _drawCandidates() {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    ctx.save();
    ctx.shadowColor = "#000"; ctx.shadowBlur = 3;
    ctx.font = "700 13px Inter, system-ui, sans-serif";
    this.candidates.forEach((c, i) => {
      const pts = c.points.map((p) => [p.fx * W, p.fy * H]);
      if (!pts.length) return;
      const selected = i === this.selectedCandidate;
      const [x, y] = this.isAnimated ? (pts[this.index] ?? pts[0]) : pts.at(-1);
      ctx.strokeStyle = ctx.fillStyle = selected ? "#F4806A" : "#EA4F39";

      if (selected) {
        ctx.globalAlpha = 0.85; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
        ctx.beginPath();
        pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.stroke();
        ctx.setLineDash([]);
        for (const [px, py] of pts) { ctx.beginPath(); ctx.arc(px, py, 2.2, 0, 2 * Math.PI); ctx.fill(); }
      }
      ctx.globalAlpha = 1; ctx.lineWidth = selected ? 3 : 2;
      ctx.beginPath(); ctx.arc(x, y, 12, 0, 2 * Math.PI); ctx.stroke();

      const tw = ctx.measureText(c.label).width;
      const lx = x + 16 + tw > W - 4 ? x - 16 - tw : x + 16;
      ctx.fillText(c.label, lx, Math.max(14, y - 14));
    });
    ctx.restore();
  }

  /**
   * Catalogue objects at the date on screen: a small teal ring each. The ones that move
   * (flagged `moving`) also get their name and the path the catalogue says they follow over the dates.
   * Teal: different from the cream "predicted" tracks of the test objects and the orange candidates.
   */
  _drawCatalogue() {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    ctx.save();
    ctx.shadowColor = "#000"; ctx.shadowBlur = 3;
    ctx.strokeStyle = ctx.fillStyle = "#90AEAD";
    ctx.font = "600 12px Inter, system-ui, sans-serif";
    for (const o of this.catalogue) {
      const pts = o.points.map((p) => [p.fx * W, p.fy * H]);
      if (!pts.length) continue;
      if (o.moving) {
        ctx.globalAlpha = 0.6; ctx.lineWidth = 1.2; ctx.setLineDash([3, 4]);
        ctx.beginPath();
        pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const [x, y] = this.isAnimated ? (pts[this.index] ?? pts[0]) : pts.at(-1);
      if (x < -8 || x > W + 8 || y < -8 || y > H + 8) continue;
      ctx.globalAlpha = 0.95; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, 2 * Math.PI); ctx.stroke();
      if (o.moving) {
        const text = `${o.label} · ${o.pm.toFixed(1)}″/yr`;
        const tw = ctx.measureText(text).width;
        const lx = x + 10 + tw > W - 4 ? x - 10 - tw : x + 10;
        ctx.fillText(text, Math.max(4, lx), Math.min(H - 6, Math.max(14, y + 18)));
      }
    }
    ctx.restore();
  }

  /**
   * Known asteroids and comets (SkyBoT): an amber diamond each, with its name and magnitude. One body is a
   * DIFFERENT dot on every date (hundreds of arcsec per day), so in the animated modes only the bodies of the
   * date on screen are drawn; in the others every date is drawn, which lays out the body's path as a row of diamonds.
   */
  _drawAsteroids() {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    const dates = this.isAnimated ? [this.index] : this.asteroids.map((_, k) => k);
    ctx.save();
    ctx.shadowColor = "#000"; ctx.shadowBlur = 3;
    ctx.strokeStyle = ctx.fillStyle = "#F2A93B";
    ctx.lineWidth = 1.6;
    ctx.font = "600 12px Inter, system-ui, sans-serif";
    for (const k of dates) {
      for (const a of this.asteroids[k] ?? []) {
        const x = a.fx * W, y = a.fy * H;
        if (x < -8 || x > W + 8 || y < -8 || y > H + 8) continue;
        ctx.beginPath();
        ctx.moveTo(x, y - 8); ctx.lineTo(x + 8, y); ctx.lineTo(x, y + 8); ctx.lineTo(x - 8, y); ctx.closePath();
        ctx.stroke();
        if (this.isAnimated) {
          const text = `${a.name}${a.vmag !== null ? ` · V ${a.vmag}` : ""}`;
          const tw = ctx.measureText(text).width;
          ctx.fillText(text, x + 12 + tw > W - 4 ? Math.max(4, x - 12 - tw) : x + 12, Math.min(H - 6, Math.max(14, y - 10)));
        }
      }
    }
    ctx.restore();
  }

  _drawMarker() {
    const { fx, fy, rPx } = this.marker;
    const n = this.naturalSize || 1;
    const x = fx * this.canvas.width, y = fy * this.canvas.height;
    const r = Math.max(6, (rPx / n) * this.canvas.width);
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "hsl(55 100% 60%)";
    ctx.shadowColor = "#000"; ctx.shadowBlur = 4;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.stroke();
    ctx.restore();
  }
}

/**
 * Pixel-wise grey arrays of a list of images – also used for the detector overview.
 * Returns the MEAN image as an RGBA ImageData, or null if pixels can't be read.
 */
export function meanImageData(images) {
  if (!images.length) return null;
  const n = images[0].naturalWidth;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const cx = c.getContext("2d", { willReadFrequently: true });
  const sum = new Float32Array(n * n);
  try {
    for (const im of images) {
      if (im.naturalWidth !== n) continue;
      cx.clearRect(0, 0, n, n);
      cx.drawImage(im, 0, 0);
      const d = cx.getImageData(0, 0, n, n).data;
      for (let i = 0; i < sum.length; i++) sum[i] += d[4 * i];
    }
  } catch { return null; }
  const out = new ImageData(n, n);
  for (let i = 0; i < sum.length; i++) {
    const v = sum[i] / images.length;
    out.data[4 * i] = out.data[4 * i + 1] = out.data[4 * i + 2] = v;
    out.data[4 * i + 3] = 255;
  }
  return out;
}

/** Load + decode one image. Rejects with a readable error. */
export function loadImage(url, frame) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Needed because we read pixels (diff/stack) from images served by the backend (CORS).
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image for ${frame.detector} at ${frame.dateISO}`));
    img.src = url;
  });
}
