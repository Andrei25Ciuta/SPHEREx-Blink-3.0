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
//
// Zoom and pan (features/view.js): the player keeps `view = { zoom, cx, cy }`. Positions everywhere else stay image FRACTIONS (fx, fy);
// only drawing goes through the view (`_px`), so the sky <-> image mapping of geometry.js is untouched by zoom and pan.

import { lightCentre } from "./features/colourBlink.js?v=3";
import { combine } from "./features/compare.js";
import { createView, clampView, fracToCanvas, canvasToFrac, sourceRect, zoomAt, panBy, panStep, scaleBar, centreAndZoom, pathCentre, followView } from "./features/view.js";
import { OVERLAY_COLORS, DRAW_ORDER, clampOpacity, normaliseOrder } from "./features/layers.js";
import { gridLines } from "./features/grid.js";
import { stepActive } from "./features/timeline.js";

export const MODES = ["blink", "diff", "mean", "max", "compare", "colour"];
const ANIMATED = new Set(["blink", "diff", "colour"]);

export class BlinkPlayer {
  constructor(canvas, { onFrameChange = () => {}, onPlayStateChange = () => {}, onViewChange = () => {}, onDraw = () => {} } = {}) {
    this.canvas = canvas;
    this.reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
    this.ctx = canvas.getContext("2d");
    this.onFrameChange = onFrameChange;           // called with (index, frame)
    this.onPlayStateChange = onPlayStateChange;   // called with (isPlaying)
    this.onViewChange = onViewChange;             // called with (view) when zoom or pan changed
    this.onDraw = onDraw;                         // called after every redraw (the layer counts and the readout follow it)
    this.onMarkerChange = () => {};               // called with the new marker ({ fx, fy, rPx } or null) when the measuring circle is set or cleared
    this.view = createView();                     // which part of the image the canvas shows (features/view.js)
    this.hidden = new Set(["grid"]);              // layers switched off: "candidates", "marker", "grid", "scalebar" (flags and tracks have their own switch); the grid starts off
    this.following = null;                        // index of the candidate the view follows (the co-moving view), or null
    this.onFollowChange = () => {};               // called with the index followed, or null when it stops
    this.layerOrder = [...DRAW_ORDER];            // the order the layers are drawn in, back to front (the layer list changes it)
    this.layerOpacity = {};                       // layer id -> 0..1 (missing = fully opaque)
    this.pixelScaleArcsec = null;                 // arcsec per image pixel, for the scale bar and the grid
    this.field = null;                            // { ra, dec } of the middle of the cutout, for the grid
    this.colourOrder = [];
    this.active = null;                           // the timeline filter: sorted indices of the images the blink visits and Stack / Trail / Difference use; null = all

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
    this._grey = null;
    this._colourMasks = new Map();      // array of Uint8ClampedArray (one per frame), or null
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
    this._colourMasks = new Map();
    this._derived = {};
    this.compare = null;                            // frame indices of the old frames: invalid now
    this.catalogue = [];                            // points are per frame of the old frames
    this.asteroids = [];                            // so are these
    this.candidates = [];                           // they belong to the old frames
    this.selectedCandidate = -1;
    this.view = createView();                       // a new field: show all of it
    this.onViewChange(this.view);
    this.colourOrder = [];
    this.active = null;                             // and all of its images
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
  /** Indices of the images the timeline filter lets through (all of them when there is no filter). */
  get activeIndices() { return this.active ?? this.frames.map((_, i) => i); }
  get playbackCount() { return this.mode === "colour" ? this.colourOrder.length : (this.active?.length ?? this.length); }
  get firstPlaybackIndex() { return this.mode === "colour" ? (this.colourOrder[0] ?? this.index) : 0; }
  get showsOriginal() { return this.mode === "blink" || this.mode === "colour"; }

  setColourOrder(indices, { restart = false } = {}) {
    this.colourOrder = indices;
    if (this.playbackCount < 2) this.pause();
    if (this.mode !== "colour" || !indices.length) return;
    if (restart || !indices.includes(this.index)) this.goTo(indices[0]);
    else this.onFrameChange(this.index, this.frames[this.index]);
  }
  /**
   * The timeline filter: which images the blink steps through and which ones Stack, Trail and Difference combine. `indices` = sorted frame indices,
   * or null for all. It does not forbid looking at another image (goTo and the slider still show any), and the searches ignore it.
   */
  setActive(indices) {
    this.active = Array.isArray(indices) && indices.length !== this.frames.length ? [...indices].sort((a, b) => a - b) : null;
    if (this.playing && this.playbackCount < 2) this.pause();
    this.draw();
  }
  get isAnimated() { return ANIMATED.has(this.mode); }
  get hasFlagMasks() { return this.flagImages.some(Boolean); }
  /** Natural size of the images (pixels of the cutout). */
  get naturalSize() { const im = this.images[0]; return im ? im.naturalWidth : 0; }

  setMode(mode) {
    if (!MODES.includes(mode)) return;
    if (this.mode === "colour" && mode !== "colour") this.stopFollow();
    this.mode = mode;
    if (mode === "colour" && this.selectedCandidate >= 0) this.setFollow(this.selectedCandidate);
    if (!this.isAnimated) this.pause();
    this.draw();
  }

  setShowFlags(on) { this.showFlags = !!on; this.draw(); }
  setMarker(marker) { this.marker = marker; this.onMarkerChange(marker); this.draw(); }
  /** tracks[i].points[k] = predicted position at the date of frame k (same order as frames). */
  setTracks(tracks) { this.tracks = tracks || []; this.draw(); }
  setShowTracks(on) { this.showTracks = !!on; this.draw(); }
  /** candidates[i].points[k] = where candidate i is on frame k's date (fractions, like tracks). */
  setCandidates(candidates, selected = -1) {
    this.candidates = candidates || [];
    this.selectedCandidate = selected;
    if (this.mode === "colour" && selected >= 0) this.setFollow(selected);
    else if (this.following !== null && (this.mode === "colour" || !this.candidates[this.following])) this.stopFollow();
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
    if (this.following !== null) {                  // the co-moving view: the followed candidate stays in the middle as the images change
      this.view = followView(this.view, this.candidates[this.following]?.points, this.index, this.isAnimated);
      this.onViewChange(this.view);
    }
    this.draw();
    this.onFrameChange(this.index, this.frames[this.index]);
  }

  step(direction) {
    if (this.mode === "colour") {
      const order = this.colourOrder;
      if (!order.length) return;
      const current = order.indexOf(this.index);
      const next = current < 0 ? (direction > 0 ? 0 : order.length - 1) : (current + direction + order.length) % order.length;
      this.goTo(order[next]);
      return;
    }
    this.goTo(this.active ? stepActive(this.index, this.active, direction) : this.index + direction);
  }
  next() { this.step(1); }
  prev() { this.step(-1); }

  draw() {
    const img = this.images[this.index];
    if (!img) return;
    const { ctx, canvas } = this;
    ctx.imageSmoothingEnabled = false;            // keep SPHEREx pixels sharp
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (this.showsOriginal) {
      this._blit(img);
    } else {
      const rgba = this._renderDerived();
      if (rgba) this._drawRgba(rgba);
      else this._blit(img);                       // fallback (e.g. tainted image)
    }

    for (const id of this.layerOrder) this._drawLayer(id);          // back to front (features/layers.js DRAW_ORDER, changed from the layer list)
    if (this.mode === "colour") this.onLightCentre?.(this._drawLightCentre());
    if (this.caption) this._drawCaption();
    this.onDraw();
  }

  _drawLightCentre() {
    const size = this.naturalSize;
    const fitted = this.candidates[this.selectedCandidate]?.points[this.index];
    const predicted = this.tracks.length === 1 ? this.tracks[0].points[this.index] : null;
    const point = this.selectedCandidate >= 0 ? fitted : (this.marker ?? predicted ?? { fx: 0.5, fy: 0.5 });
    if (!point) return;
    const grey = this._greys()?.[this.index];
    if (!grey) return;
    const flagImage = this.flagImages[this.index];
    let canMeasure = !this.frames[this.index].flagsUrl || Boolean(flagImage);
    if (flagImage && !this._colourMasks.has(this.index)) {
      const scratch = this._scratch;
      scratch.width = scratch.height = size;
      const ctx = scratch.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(flagImage, 0, 0, size, size);
      try {
        const rgba = ctx.getImageData(0, 0, size, size).data;
        const mask = Uint8Array.from(grey, (_, i) => rgba[4 * i + 3]);
        this._colourMasks.set(this.index, mask);
      } catch {
        canMeasure = false;
      }
    }
    const measured = canMeasure ? lightCentre(grey, size, point, this._colourMasks.get(this.index)) : null;
    const centre = measured ?? (fitted || predicted ? point : null);
    if (!centre) return;
    const [x, y] = this._px(centre.fx, centre.fy);
    const pulse = this.playing && !this.reduceMotion?.matches ? Math.sin(performance.now() / 420) : 0;
    const radius = 29 + 3 * pulse;
    const { ctx } = this;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, "rgba(101, 69, 101, .06)");
    glow.addColorStop(.48, "rgba(122, 77, 113, .12)");
    glow.addColorStop(.62, "rgba(160, 93, 139, .68)");
    glow.addColorStop(.71, "rgba(93, 161, 167, .76)");
    glow.addColorStop(.81, "rgba(44, 133, 149, .44)");
    glow.addColorStop(1, "rgba(44, 133, 149, 0)");
    ctx.save();
    ctx.globalAlpha = measured ? 1 : .48;
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
    return { kind: measured ? "measured" : "predicted", measurement: measured };
  }

  /** Is this layer on screen now (its switch is on and it has something to draw)? */
  _layerShown(id) {
    switch (id) {
      case "flags": return this.showFlags;
      case "grid": return !this.hidden.has("grid");
      case "tracks": return this.showTracks && this.tracks.length > 0;
      case "catalogue": return this.catalogue.length > 0;
      case "asteroids": return this.asteroids.length > 0;
      case "candidates": return this.candidates.length > 0 && !this.hidden.has("candidates");
      case "marker": return Boolean(this.marker) && !this.hidden.has("marker");
      case "scalebar": return !this.hidden.has("scalebar");
      default: return false;
    }
  }

  /** Draw one layer. Below full opacity it is drawn on a canvas of its own first (the layers set their own transparency inside), then laid over the picture. */
  _drawLayer(id) {
    if (!this._layerShown(id)) return;
    const a = this.layerOpacity[id] ?? 1;
    if (a <= 0) return;
    if (a >= 1) { this._drawLayerBody(id); return; }
    const off = (this._layerCanvas ??= document.createElement("canvas"));
    off.width = this.canvas.width; off.height = this.canvas.height;         // resizing also clears it
    const main = this.ctx;
    this.ctx = off.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;                                 // keep SPHEREx pixels sharp here too (a mask is blitted)
    try { this._drawLayerBody(id); } finally { this.ctx = main; }
    main.globalAlpha = a;
    main.drawImage(off, 0, 0);
    main.globalAlpha = 1;
  }

  _drawLayerBody(id) {
    const { ctx } = this;
    switch (id) {
      case "flags": {
        const masks = this.isAnimated ? [this.flagImages[this.index]] : this.flagImages;
        ctx.globalAlpha = this.isAnimated ? 0.85 : 0.35;
        for (const m of masks) if (m) this._blit(m);
        ctx.globalAlpha = 1;
        break;
      }
      case "grid": this._drawGrid(); break;
      case "tracks": this._drawTracks(); break;
      case "catalogue": this._drawCatalogue(); break;
      case "asteroids": this._drawAsteroids(); break;
      case "candidates": this._drawCandidates(); break;
      case "marker": this._drawMarker(); break;
      case "scalebar": this._drawScaleBar(); break;
      default: break;
    }
  }

  /** Opacity of one layer, 0 (invisible) to 1 (as drawn). */
  setLayerOpacity(id, value) { this.layerOpacity[id] = clampOpacity(value); this.draw(); }
  /** The order the layers are drawn in, back to front (a complete list of layer ids; anything else restores the default). */
  setLayerOrder(order) { this.layerOrder = normaliseOrder(order); this.draw(); }

  // ------------------------------------------------------------------ zoom and pan (features/view.js)

  /** Draw the part of `source` (an image or canvas, square) that the view shows, over the whole canvas. */
  _blit(source) {
    const n = source.naturalWidth || source.width;
    const r = sourceRect(this.view, n);
    this.ctx.drawImage(source, r.sx, r.sy, r.sw, r.sh, 0, 0, this.canvas.width, this.canvas.height);
  }

  /** Image fraction -> canvas pixel [x, y] under the current view. Everything that is drawn on top of the picture goes through this. */
  _px(fx, fy) {
    const p = fracToCanvas(this.view, fx, fy, this.canvas.width, this.canvas.height);
    return [p.x, p.y];
  }
  _pts(points) { return points.map((p) => this._px(p.fx, p.fy)); }

  get zoom() { return this.view.zoom; }

  setView(view) {
    this.view = clampView(view);
    this.draw();
    this.onViewChange(this.view);
  }
  resetView() { this.stopFollow(); this.setView(createView()); }

  /**
   * Follow a candidate (index into `candidates`): from now on every image that is shown puts it in the middle of the picture (same zoom, at least x6 to start),
   * the "co-moving view". Panning by hand stops it. Returns false when the candidate has no position to follow.
   */
  setFollow(i, minZoom = 6) {
    const c = this.candidates[i];
    if (!c || !pathCentre(c.points, this.index, this.isAnimated)) { this.stopFollow(); return false; }
    this.following = i;
    this.setView(followView(centreAndZoom(this.view, 0.5, 0.5, minZoom), c.points, this.index, this.isAnimated));
    this.onFollowChange(i);
    return true;
  }
  stopFollow() {
    if (this.following === null) return;
    this.following = null;
    this.onFollowChange(null);
  }
  /** Zoom by `factor` keeping the canvas pixel (x, y) in place (default: the middle). */
  zoomBy(factor, x = this.canvas.width / 2, y = this.canvas.height / 2) {
    this.setView(zoomAt(this.view, factor, x, y, this.canvas.width, this.canvas.height));
  }
  /** The picture follows a drag of (dx, dy) canvas pixels. */
  panByCanvas(dx, dy) { this.stopFollow(); this.setView(panBy(this.view, dx, dy, this.canvas.width, this.canvas.height)); }
  /** Keyboard pan: dirX, dirY in {-1, 0, 1}. */
  panByStep(dirX, dirY) { this.stopFollow(); this.setView(panStep(this.view, dirX, dirY)); }

  /** A mouse or touch position on the page -> { fx, fy } image fractions under the current view (what a click measures). */
  pointToFrac(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * this.canvas.width;
    const y = ((clientY - rect.top) / rect.height) * this.canvas.height;
    return canvasToFrac(this.view, x, y, this.canvas.width, this.canvas.height);
  }

  /** Layers that have no switch of their own: "candidates", "marker", "scalebar". */
  setLayerVisible(id, on) { if (on) this.hidden.delete(id); else this.hidden.add(id); this.draw(); }
  setPixelScale(arcsecPerPixel) { this.pixelScaleArcsec = Number(arcsecPerPixel) > 0 ? Number(arcsecPerPixel) : null; this.draw(); }
  /** The field on screen: RA/Dec of the middle of the cutout (degrees) and arcsec per pixel; the coordinate grid and the scale bar need them. */
  setField({ ra, dec, scaleArcsec }) {
    this.field = Number.isFinite(ra) && Number.isFinite(dec) ? { ra, dec } : null;
    this.setPixelScale(scaleArcsec);
  }

  /**
   * Centre the view on a candidate (index into `candidates`, default the selected one) and zoom in to at least minZoom.
   * Animated modes: its place on the image shown now; combined modes: the middle of its path. Returns false when there is nothing to centre on.
   */
  centreOnCandidate(i = this.selectedCandidate, minZoom = 6) {
    const c = this.candidates[i];
    const p = c ? pathCentre(c.points, this.index, this.isAnimated) : null;
    if (!p) return false;
    this.setView(centreAndZoom(this.view, p.fx, p.fy, minZoom));
    return true;
  }

  /** The 8-bit display level (0..255) of one pixel of the frame on screen, or null (pixels unreadable, or outside the image). */
  greyLevelAt(ix, iy) {
    const n = this.naturalSize;
    if (!n || ix < 0 || iy < 0 || ix >= n || iy >= n) return null;
    const g = this._greys();
    return g ? g[this.index][iy * n + ix] : null;
  }

  /**
   * The display levels (0..255) behind one pixel of the picture on screen in the modes that combine images (Stack, Trail, Difference, Compare), or null.
   * Blink mode has greyLevelAt (and the real values of the file). Uses the cached statistics, so it is cheap enough to follow the pointer.
   */
  levelsAt(ix, iy) {
    const n = this.naturalSize;
    if (!n || ix < 0 || iy < 0 || ix >= n || iy >= n) return null;
    const g = this._greys();
    if (!g) return null;
    const k = iy * n + ix;
    if (this.mode === "mean" || this.mode === "max") { const s = this._stat(this.mode); return s ? { level: s[k] } : null; }
    if (this.mode === "diff") { const ref = this._referenceFor(this.index); return ref ? { current: g[this.index][k], reference: ref[k] } : null; }
    if (this.mode === "compare") {
      const c = this.compare;
      if (!c || !c.a.length || !c.b.length) return null;
      return { a: this._stat("mean", c.a)[k], b: this._stat("mean", c.b)[k] };
    }
    return null;
  }

  /** The image currently on screen, as a PNG data: URL (for "save frame"). */
  snapshot() { return this.canvas.toDataURL("image/png"); }

  setFps(fps) { this.fps = Math.max(0.1, Number(fps) || 1); }

  play() {
    if (this.playing || this.playbackCount < 2 || !this.isAnimated) return;
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
    if (this.mode === "colour") this.draw();
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
      this.lastHaloDraw = now;
    } else if (this.mode === "colour" && !this.reduceMotion?.matches && now - (this.lastHaloDraw ?? 0) >= 50) {
      this.lastHaloDraw = now;
      this.draw();
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
    const idx = members ?? this.activeIndices;         // default: the images the timeline filter lets through
    if (!idx.length) return null;
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
    // With a timeline filter the reference is built from the images it lets through (same wavelength window: fewer leftovers of bright stars);
    // if that leaves none from another pass, all the other passes are used as before.
    const kept = this.active ? far.filter((j) => this.active.includes(j)) : far;
    const pool = kept.length ? kept : far;
    const members = pool.length ? pool : this.frames.map((f, j) => j).filter((j) => j !== i);
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
      if (!s) return null;                                   // the filter left no image: the plain picture is shown
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
    this._blit(c);
  }

  /**
   * Predicted track: a thin dashed line through all predicted positions, a dot per date,
   * and – for the frame on screen – four ticks AROUND the spot (never on top of it, so the
   * real object stays visible). Green: distinct from the diff colours and the yellow aperture.
   */
  _drawTracks() {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    const COLOR = OVERLAY_COLORS.tracks;
    ctx.save();
    ctx.shadowColor = "#000"; ctx.shadowBlur = 3;
    for (const t of this.tracks) {
      const pts = this._pts(t.points);
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
      const pts = this._pts(c.points);
      if (!pts.length) return;
      const selected = i === this.selectedCandidate;
      if (selected && this.mode === "colour") return;
      const [x, y] = this.isAnimated ? (pts[this.index] ?? pts[0]) : pts.at(-1);
      if (x < -20 || x > W + 20 || y < -20 || y > H + 20) { if (!selected) return; }   // off screen after zooming (the selected path still shows)
      ctx.strokeStyle = ctx.fillStyle = selected ? OVERLAY_COLORS.candidateSelected : OVERLAY_COLORS.candidates;

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
    ctx.strokeStyle = ctx.fillStyle = OVERLAY_COLORS.catalogue;
    ctx.font = "600 12px Inter, system-ui, sans-serif";
    for (const o of this.catalogue) {
      const pts = this._pts(o.points);
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
    ctx.strokeStyle = ctx.fillStyle = OVERLAY_COLORS.asteroids;
    ctx.lineWidth = 1.6;
    ctx.font = "600 12px Inter, system-ui, sans-serif";
    for (const k of dates) {
      for (const a of this.asteroids[k] ?? []) {
        const [x, y] = this._px(a.fx, a.fy);
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

  /** The measuring aperture. Its radius is in IMAGE pixels, so it grows with the zoom (what the circle covers does not change). */
  _drawMarker() {
    const { fx, fy, rPx } = this.marker;
    const n = this.naturalSize || 1;
    const [x, y] = this._px(fx, fy);
    const r = Math.max(6, (rPx / n) * this.canvas.width * this.view.zoom);
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = OVERLAY_COLORS.marker;
    ctx.shadowColor = "#000"; ctx.shadowBlur = 4;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.stroke();
    ctx.restore();
  }

  /**
   * The coordinate grid (features/grid.js): thin see-through lines of constant RA (vertical) and Dec (horizontal) on round values, labelled at the
   * bottom and left edges, with the spacing written in the top-left corner. The positions come from the same flat-sky mapping as everything else.
   */
  _drawGrid() {
    const n = this.naturalSize, scale = this.pixelScaleArcsec ?? this.frames[0]?.pixelScaleArcsec;
    if (!n || !scale || !this.field) return;
    const { ctx, canvas } = this, W = canvas.width, H = canvas.height;
    const g = gridLines(this.view, { ra: this.field.ra, dec: this.field.dec, n, scaleArcsec: scale }, W, H);
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = OVERLAY_COLORS.grid;
    ctx.lineWidth = 1; ctx.globalAlpha = 0.4;
    ctx.beginPath();
    for (const l of g.raLines) { const x = Math.round(l.x) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (const l of g.decLines) { const y = Math.round(l.y) + 0.5; ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.shadowColor = "#000"; ctx.shadowBlur = 3;
    ctx.font = "600 12px Inter, system-ui, sans-serif";
    let lastEnd = -Infinity;                                       // RA labels never overlap: skip one that would
    for (const l of [...g.raLines].sort((a, b) => a.x - b.x)) {
      const tw = ctx.measureText(l.label).width;
      let x = l.x + 4;
      if (x + tw > W - 4) x = l.x - 4 - tw;
      if (x < 4 || x < lastEnd + 6) continue;
      ctx.fillText(l.label, x, H - 6);
      lastEnd = x + tw;
    }
    // Dec labels: on the right edge (the bottom-left is where the scale bar is), except in the top strip where the zoom buttons are: there on the left
    for (const l of g.decLines) {
      if (l.y < 34 || l.y > H - 26) continue;
      const atRight = l.y > 100;
      ctx.textAlign = atRight ? "right" : "left";
      ctx.fillText(l.label, atRight ? W - 5 : 5, l.y - 4);
    }
    ctx.textAlign = "left";
    if (g.raStep || g.decStep) ctx.fillText(`grid ${[g.raStep, g.decStep].filter(Boolean).join(" × ")}`, 5, 15);
    ctx.restore();
  }

  /** Lines printed into the picture while it is being saved or recorded (null = none): what the data are and which image this is. */
  setCaption(lines) { this.caption = lines && lines.length ? lines : null; this.draw(); }
  _drawCaption() {
    const { ctx, canvas } = this, size = Math.max(11, Math.round(canvas.width / 48)), pad = Math.round(size * 0.5), h = this.caption.length * (size + 4) + pad * 2;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.78)"; ctx.fillRect(0, canvas.height - h, canvas.width, h);
    ctx.textBaseline = "top";
    this.caption.forEach((line, i) => {
      ctx.font = `${i === 0 ? "700" : "500"} ${size}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = i === 0 && /SYNTHETIC/.test(line) ? "#ffb347" : "#ffffff";
      let t = line;
      while (t.length > 8 && ctx.measureText(t).width > canvas.width - 2 * pad) t = t.slice(0, -2);
      ctx.fillText(t.length < line.length ? t.trimEnd() + "…" : t, pad, canvas.height - h + pad + i * (size + 4));
    });
    ctx.restore();
  }

  /** A scale bar in the bottom-left corner: a round angle (features/view.js scaleBar) as long as it is on the canvas at this zoom. */
  _drawScaleBar() {
    const n = this.naturalSize;
    const scale = this.frames[this.index]?.pixelScaleArcsec ?? this.pixelScaleArcsec;
    if (!n || !scale) return;
    const bar = scaleBar((scale * n) / (this.canvas.width * this.view.zoom), this.canvas.width * 0.3);
    if (!bar) return;
    const { ctx, canvas } = this;
    const x0 = 16, y0 = canvas.height - 16 - (this.hidden.has("grid") ? 0 : 22);       // above the RA labels when the grid is on
    ctx.save();
    ctx.shadowColor = "#000"; ctx.shadowBlur = 3;
    ctx.strokeStyle = ctx.fillStyle = OVERLAY_COLORS.scalebar;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0 - 5); ctx.lineTo(x0, y0); ctx.lineTo(x0 + bar.px, y0); ctx.lineTo(x0 + bar.px, y0 - 5);
    ctx.stroke();
    ctx.font = "600 12px Inter, system-ui, sans-serif";
    ctx.fillText(bar.label, x0, y0 - 9);
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
