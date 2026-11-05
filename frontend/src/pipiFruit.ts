// 撈水果 (see GLOSSARY.md: 種花, 撈水果): teleport next to a 蘑菇地圖 flower,
// then walk onto it, so the game plants flowers along the way and hands out
// that flower's fruit. Teleporting straight onto the flower leaves no trail.
//
// No runtime imports and erasable-syntax-only so `node --test` can load it
// directly.

// Fixed by design, not a setting: due east, 30 m.
const START_OFFSET_M = 30;
// Same equirectangular offset as backend/core/flower.py `_circle_points`.
const M_PER_DEG = 111_320;

/**
 * Where 撈水果 starts: 30 m due east of the flower.
 *
 * @param lat the flower's latitude.
 * @param lng the flower's longitude.
 * @returns the start point; same latitude, longitude moved east.
 */
export function fruitStartPoint(lat: number, lng: number): { lat: number; lng: number } {
  const coslat = Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);
  return { lat, lng: lng + START_OFFSET_M / (M_PER_DEG * coslat) };
}

/**
 * Per-device teleport result. A group fan-out (`FanoutOutcome`) fits as is;
 * single-device mode wraps its one teleport in the same shape.
 */
export interface FruitTeleportOutcome {
  ok: ReadonlyArray<{ udid: string }>;
  failed: ReadonlyArray<{ udid: string; reason: string }>;
}

export interface FruitApproachDeps<T extends FruitTeleportOutcome, N> {
  /** Teleports every target device; resolves (never rejects) with each one's result. */
  teleport: (lat: number, lng: number) => Promise<T>;
  /** Starts the walk on every target device. */
  navigate: (lat: number, lng: number, opts: { straightLine: boolean; skipPreSync: boolean }) => Promise<N>;
}

export type FruitApproachResult<T extends FruitTeleportOutcome, N> =
  | { aborted: true; teleport: T }
  | { aborted: false; teleport: T; navigate: N };

/**
 * 撈水果: teleport to {@link fruitStartPoint}, wait for it, then walk a
 * straight line onto the flower.
 *
 * @param flower the flower's coordinate, already clamped / normalised.
 * @param deps the teleport and navigate calls for the target devices.
 * @returns the teleport outcome, plus the navigate result when the walk started.
 */
export async function runFruitApproach<T extends FruitTeleportOutcome, N>(
  flower: { lat: number; lng: number },
  deps: FruitApproachDeps<T, N>,
): Promise<FruitApproachResult<T, N>> {
  const start = fruitStartPoint(flower.lat, flower.lng);
  const teleport = await deps.teleport(start.lat, start.lng);
  // One failure stops every device (the user's call, not "let the rest
  // walk"); the ones that made it stay at the start.
  if (teleport.failed.length > 0 || teleport.ok.length === 0) return { aborted: true, teleport };
  // Every device has just teleported to the same start, so the group
  // pre-sync would only drag them back to the position before 撈水果.
  const navigate = await deps.navigate(flower.lat, flower.lng, { straightLine: true, skipPreSync: true });
  return { aborted: false, teleport, navigate };
}
