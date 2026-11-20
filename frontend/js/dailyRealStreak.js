const day = Math.floor(Date.now() / 86400000);
const storageKey = "spherex-real-daily-v1";
let progress = {};

export function streakState(saved, today) {
  const gap = today - saved.day;
  const freezeUsed = Boolean(saved.freezeUsed);
  const active = gap === 0 || gap === 1 || (gap === 2 && !freezeUsed);
  return { streak: active ? saved.streak ?? 0 : 0, freezeAvailable: !active || (!freezeUsed && gap !== 2) };
}

export function advanceStreak(saved, today) {
  if (saved.day === today) return saved;
  const gap = today - saved.day;
  const { streak } = streakState(saved, today);
  return { day: today, streak: streak + 1, freezeUsed: streak > 0 && (gap === 2 || Boolean(saved.freezeUsed)) };
}

function renderStreak(completed) {
  try { progress = JSON.parse(localStorage.getItem(storageKey)) ?? {}; } catch { /* storage is optional */ }
  const previous = streakState(progress, day).streak;
  if (completed && progress.day !== day) {
    progress = advanceStreak(progress, day);
    try { localStorage.setItem(storageKey, JSON.stringify(progress)); } catch { /* storage is optional */ }
  }
  const { streak, freezeAvailable } = streakState(progress, day);
  document.getElementById("real-game-streak-count").textContent = String(streak);
  document.getElementById("daily-real-freeze").textContent = freezeAvailable ? "1 freeze available" : "Freeze used";
  if (completed && streak > previous && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const bubble = document.getElementById("real-game-streak-bubble");
    bubble.classList.add("is-glowing");
    bubble.addEventListener("animationend", () => bubble.classList.remove("is-glowing"), { once: true });
  }
  return streak;
}

export const updateRealStreak = () => renderStreak(false);
export const recordRealCompletion = () => renderStreak(true);
