import { classificationDay, classificationScores, formatClassificationTime } from "./features/classificationScores.js";

export function mountClassificationLeaderboard($, scores = classificationScores()) {
  const form = $("share-score");
  const nickname = $("nickname");
  const share = $("publish-score");
  const shareStatus = $("share-status");
  const boardStatus = $("board-status");
  const refresh = $("refresh-board");
  const list = $("scores");
  let completedRun;
  let requestNumber = 0;
  let requestedDay;

  async function load() {
    const request = ++requestNumber;
    const day = classificationDay();
    requestedDay = day;
    refresh.disabled = true;
    $("board-date").textContent = `${day} UTC`;
    boardStatus.textContent = "Loading scores…";
    list.replaceChildren();
    try {
      const entries = await scores.read(day);
      if (request !== requestNumber) return;
      for (const [index, entry] of entries.entries()) {
        const row = document.createElement("li");
        const rank = document.createElement("span");
        rank.className = "classification-rank";
        rank.textContent = `#${index + 1}`;
        const player = document.createElement("strong");
        player.textContent = entry.nickname;
        const result = document.createElement("span");
        result.className = "classification-rank-result";
        result.textContent = `${entry.score}/10 · ${formatClassificationTime(entry.elapsed_ms)}`;
        row.append(rank, player, result);
        list.append(row);
      }
      boardStatus.textContent = entries.length ? "" : "No scores posted today.";
    } catch {
      if (request === requestNumber) boardStatus.textContent = "The shared leaderboard is unavailable. You can still play.";
    } finally {
      if (request === requestNumber) refresh.disabled = false;
    }
  }

  refresh.addEventListener("click", load);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!completedRun || share.disabled) return;
    if (completedRun.day !== classificationDay()) {
      shareStatus.textContent = "A new daily round has started. Play again to post today’s score.";
      share.disabled = true;
      return;
    }
    const name = nickname.value.trim();
    if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/u.test(name)) {
      shareStatus.textContent = "Enter a nickname of 1–40 characters.";
      nickname.focus();
      return;
    }
    const run = completedRun;
    share.disabled = true;
    nickname.readOnly = true;
    shareStatus.textContent = "Posting your score…";
    try {
      run.id ??= crypto.randomUUID();
      await scores.save({ ...run, nickname: name });
      if (completedRun === run) shareStatus.textContent = "Score posted to the shared leaderboard.";
      await load();
    } catch {
      if (completedRun === run) {
        shareStatus.textContent = "Could not post your score. Try again.";
        share.disabled = false;
        nickname.readOnly = false;
      }
    }
  });
  load();

  return {
    refreshForDay(day) {
      if (day !== requestedDay) load();
    },
    show(run) {
      completedRun = run;
      form.hidden = !run;
      share.disabled = false;
      nickname.readOnly = false;
      shareStatus.textContent = "";
    },
  };
}
