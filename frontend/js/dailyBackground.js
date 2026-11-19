(() => {
  const { THREE, createOverviewStarfield } = window;
  if (!THREE || !createOverviewStarfield) return;

  const canvas = document.getElementById("daily-background");
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); }
  catch { return; }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0b0f19, 0.0006);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 4000);
  camera.position.z = 820;
  const stars = createOverviewStarfield(THREE);
  scene.add(stars);

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let scrollProgress = 0;
  let request;

  function draw() {
    const height = document.body.scrollHeight - window.innerHeight;
    const target = height > 0 ? Math.min(1, Math.max(0, window.scrollY / height)) : 0;
    scrollProgress += (target - scrollProgress) * 0.055;
    camera.position.z = 820 - scrollProgress * 360;
    stars.rotation.y += 0.0002;
    stars.rotation.z = scrollProgress * 0.5;
    renderer.render(scene, camera);
    request = requestAnimationFrame(draw);
  }

  function resize() {
    const { innerWidth, innerHeight } = window;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }

  function updateMotion() {
    cancelAnimationFrame(request);
    if (!reducedMotion.matches && !document.hidden) request = requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", updateMotion);
  reducedMotion.addEventListener("change", updateMotion);
  resize();
  document.body.classList.add("has-animated-stars");
  updateMotion();
})();
