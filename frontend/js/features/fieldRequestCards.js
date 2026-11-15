// Pure view model for the six detector cards shown while a field request is prepared.
export const FIELD_DETECTOR_IDS = Object.freeze(["D1", "D2", "D3", "D4", "D5", "D6"]);

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const finiteOrNull = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);

/**
 * Map backend status to stable D1–D6 rows. Missing values stay unknown; the view
 * must not guess that a detector has started or completed.
 */
export function fieldRequestCardRows(status, frames = []) {
  const byDetector = status?.detectors && typeof status.detectors === "object" ? status.detectors : {};
  return FIELD_DETECTOR_IDS.map((detector) => {
    const item = byDetector[detector] ?? null;
    const detectorFrames = (frames ?? []).filter((frame) => frame.detector === detector);
    const progress = finiteOrNull(item?.progress);
    return {
      detector,
      status: typeof item?.status === "string" ? item.status : "waiting",
      phase: typeof item?.phase === "string" ? item.phase : null,
      progress: progress === null ? null : clamp01(progress),
      completedFiles: finiteOrNull(item?.completedFiles),
      totalFiles: finiteOrNull(item?.totalFiles),
      completedWork: finiteOrNull(item?.completedWork),
      totalWork: finiteOrNull(item?.totalWork),
      frameCount: finiteOrNull(item?.frameCount),
      hasPlan: Boolean(item?.planKey),
      error: typeof item?.error === "string" ? item.error : null,
      frames: detectorFrames,
      canSelect: item?.status === "ready" && detectorFrames.length > 0,
    };
  });
}
