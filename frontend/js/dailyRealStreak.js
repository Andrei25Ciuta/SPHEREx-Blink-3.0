const day = Math.floor(Date.now() / 86400000);
const storageKey = "spherex-real-daily-v1";
let progress = {};

function renderStreak(completed) {
  try { progress = JSON.parse(localStorage.getItem(storageKey)) ?? {}; } catch { /* storage is optional */ }
  const previous = progress.day >= day - 1 ? progress.streak : 0;
  if (completed && progress.day !== day) {
    progress = { day, streak: progress.day === day - 1 ? previous + 1 : 1 };
    try { localStorage.setItem(storageKey, JSON.stringify(progress)); } catch { /* storage is optional */ }
  }
  const streak = progress.day >= day - 1 ? progress.streak : 0;
  document.getElementById("real-game-streak-count").textContent = String(streak);
  if (completed && streak > previous && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const bubble = document.getElementById("real-game-streak-bubble");
    bubble.classList.add("is-glowing");
    bubble.addEventListener("animationend", () => bubble.classList.remove("is-glowing"), { once: true });
  }
  return streak;
}

export const updateRealStreak = () => renderStreak(false);
export const recordRealCompletion = () => renderStreak(true);
