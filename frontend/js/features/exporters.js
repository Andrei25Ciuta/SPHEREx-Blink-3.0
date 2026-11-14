// exporters.js – save the current image, record the blink as a video, copy the link.

/** Trigger a download of a data:/blob: URL. */
function download(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** caption: the lines printed into the picture (provenance.js pictureCaption); the picture on screen is not changed afterwards. */
export function savePng(player, baseName, caption = null) {
  try { player.setCaption(caption); download(player.snapshot(), `${baseName}.png`); } finally { player.setCaption(null); }
}

/** Pick a video format the browser can record. */
function pickMime() {
  const options = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  return options.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || null;
}
export const canRecord = () => !!pickMime() && !!HTMLCanvasElement.prototype.captureStream;

/**
 * Record `loops` full passes of the blink as a video file.
 * onTick(secondsLeft) lets the UI show a countdown. Resolves when the file is saved.
 */
export async function recordBlink(player, baseName, { minSeconds = 3, maxSteps = 60, onTick = () => {}, caption = null } = {}) {
  const mime = pickMime();
  if (!mime) throw new Error("This browser cannot record video.");
  const fps = player.fps;
  const stepMs = 1000 / fps;
  // Whole loops only, at least minSeconds long, but never absurdly long.
  const visited = Math.max(1, player.playbackCount);                 // the images the blink visits (the timeline filter may leave out some)
  const loops = Math.max(2, Math.ceil((minSeconds * fps) / visited));
  const totalSteps = Math.min(maxSteps, loops * visited);

  // captureStream(0) = no automatic frames: we push one with requestFrame() after every
  // draw. That works even when the browser pauses animations (hidden tab).
  const stream = player.canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const pushFrame = () => track.requestFrame?.();
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise((resolve) => { rec.onstop = resolve; });

  const wasPlaying = player.playing;
  player.pause();
  player.setCaption(caption);                        // printed into every frame of the video
  player.goTo(player.firstPlaybackIndex);
  rec.start(250);                                    // hand over data every 250 ms
  pushFrame();

  await new Promise((resolve) => {
    let steps = 0;
    const timer = setInterval(() => {
      steps += 1;
      onTick(Math.ceil(((totalSteps - steps) * stepMs) / 1000));
      if (steps >= totalSteps) { clearInterval(timer); resolve(); return; }
      player.next();
      pushFrame();
    }, stepMs);
  });
  rec.stop();
  await stopped;
  player.setCaption(null);
  stream.getTracks().forEach((t) => t.stop());
  if (wasPlaying) player.play();
  if (!chunks.length) throw new Error("The recording came out empty.");

  const ext = mime.includes("mp4") ? "mp4" : "webm";
  const url = URL.createObjectURL(new Blob(chunks, { type: mime.split(";")[0] }));
  download(url, `${baseName}.${ext}`);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Copy the current page URL (which already holds ra/dec/fov/det/mode). */
export async function copyLink() {
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    // Clipboard API blocked (e.g. not https / no permission): fall back to a prompt.
    window.prompt("Copy this link:", url);
    return false;
  }
}
