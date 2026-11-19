export function showShootingStars() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const overlay = document.getElementById("daily-celebration");
  const meteors = Array.from({ length: 12 }, (_, index) => {
    const star = document.createElement("span");
    star.style.setProperty("--start", `${-9 + (index * 43) % 101}%`);
    star.style.setProperty("--height", `${-15 + (index * 23) % 96}%`);
    star.style.setProperty("--delay", `${index * 105}ms`);
    star.addEventListener("animationend", () => star.remove(), { once: true });
    return star;
  });
  overlay.replaceChildren(...meteors);
}
