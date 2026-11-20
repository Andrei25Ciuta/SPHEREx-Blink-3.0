import { PIN_BOARD_KEY, PIN_BOARD_URL } from "../config.js";
import { sharedConfig } from "./pinSync.js";

const config = sharedConfig(PIN_BOARD_URL, PIN_BOARD_KEY);
const LIMIT = 10;

export function classificationDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function formatClassificationTime(milliseconds) {
  return `${(milliseconds / 1000).toFixed(3)} s`;
}

export function classificationScores(cfg = config, fetchFn = fetch) {
  function request(path, options) {
    if (!cfg) throw new Error("Shared scores are not configured.");
    const headers = { ...options?.headers, apikey: cfg.key };
    if (cfg.key.startsWith("eyJ")) headers.Authorization = `Bearer ${cfg.key}`;
    return fetchFn(`${cfg.url}/rest/v1/${path}`, { ...options, headers, signal: AbortSignal.timeout(8000) });
  }

  return {
    async read(day) {
      const query = new URLSearchParams({
        select: "nickname,score,elapsed_ms",
        play_day: `eq.${day}`,
        order: "score.desc,elapsed_ms.asc,created_at.asc,id.asc",
        limit: String(LIMIT),
      });
      const response = await request(`classification_daily_best?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Could not load scores (${response.status}).`);
      return response.json();
    },
    async save({ id, day, nickname, score, elapsedMs }) {
      const response = await request("classification_scores", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=minimal,resolution=ignore-duplicates",
        },
        body: JSON.stringify({ id, play_day: day, nickname, score, elapsed_ms: elapsedMs }),
      });
      if (!response.ok) throw new Error(`Could not save score (${response.status}).`);
    },
  };
}
