export const MIN_FOV_ARCMIN = 1;
export const SYNTHETIC_MAX_FOV_ARCMIN = 30;
export const REAL_DATA_MAX_FOV_ARCMIN = 10;

export function maxFovForDataSource(dataSource) {
  return dataSource === "api" ? REAL_DATA_MAX_FOV_ARCMIN : SYNTHETIC_MAX_FOV_ARCMIN;
}

export function clampFov(value, dataSource) {
  const fov = Number(value);
  if (!Number.isFinite(fov)) return MIN_FOV_ARCMIN;
  return Math.min(maxFovForDataSource(dataSource), Math.max(MIN_FOV_ARCMIN, Math.round(fov)));
}
