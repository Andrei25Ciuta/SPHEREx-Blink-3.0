const canvas = document.getElementById("daily-background");
const context = canvas.getContext("2d");
if (context) {
  document.body.classList.add("has-animated-stars");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const observer = new ResizeObserver(resize);
  const colours = ["239 178 79", "128 179 255", "220 231 249"];
  const stars = Array.from({ length: 240 }, (_, index) => ({
    x: Math.random(),
    y: Math.random(),
    depth: 0.25 + Math.random() * 0.75,
    colour: colours[index % 9 < 2 ? index % 9 : 2],
  }));
  let width = 0;
  let height = 0;
  let request = 0;
  let previous;
  let elapsed = 0;

  function draw() {
    context.clearRect(0, 0, width, height);
    for (const star of stars) {
      const x = (star.x * width + elapsed * star.depth * 4) % width;
      const y = (star.y * height + elapsed * star.depth * 1.4) % height;
      const size = 0.65 + star.depth * 1.5;
      context.fillStyle = `rgb(${star.colour} / ${0.15 + star.depth * 0.47})`;
      context.fillRect(x, y, size, size);
    }
  }

  function resize() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (width && height) draw();
  }

  function frame(time) {
    elapsed += previous === undefined ? 0 : Math.min((time - previous) / 1000, 0.05);
    previous = time;
    if (width && height) draw();
    request = requestAnimationFrame(frame);
  }

  function updateMotion() {
    cancelAnimationFrame(request);
    previous = undefined;
    if (!reducedMotion.matches && !document.hidden) request = requestAnimationFrame(frame);
  }

  observer.observe(canvas);
  reducedMotion.addEventListener("change", updateMotion);
  document.addEventListener("visibilitychange", updateMotion);
  resize();
  updateMotion();
}
