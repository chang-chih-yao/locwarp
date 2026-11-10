// 撈水果 (see GLOSSARY.md: 種花, 撈水果): teleport next to a 蘑菇地圖 flower,
// then walk onto it, so the game plants flowers along the way and hands out
// that flower's fruit. Teleporting straight onto the flower leaves no trail.
// The arrival watches at the bottom tell when that walk made it.
//
// No runtime imports and erasable-syntax-only so `node --test` can load it
// directly; the type-only import below is stripped whole by Node.
import type { WsMessage } from './hooks/useWebSocket';

type LatLng = { lat: number; lng: number };

// Fixed by design, not a setting: due east, 35 m.
const START_OFFSET_M = 35;
// Same equirectangular offset as backend/core/flower.py `_circle_points`.
const M_PER_DEG = 111_320;

/**
 * Where 撈水果 starts: 35 m due east of the flower.
 *
 * @param lat the flower's latitude.
 * @param lng the flower's longitude.
 * @returns the start point; same latitude, longitude moved east.
 */
export function fruitStartPoint(lat: number, lng: number): LatLng {
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
  flower: LatLng,
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

// ── 抵達監看 (自動標記) ───────────────────────────────────────────────
// Whether 撈水果 walked onto its flower on every device, so 自動標記 can mark
// it 拿過精華 (.scratch/pipi-flower-essence/spec.md「自動標記」).

/** `arrived` and `cancelled` are final: later events never change them. */
export type FruitArrivalVerdict = 'waiting' | 'arrived' | 'cancelled';

type FruitDeviceStage = 'notStarted' | 'walking' | 'arrived';

// An allow-list, so a state added to the backend later reads as the walk
// being over. Today any other mode goes through stop() and an idle first.
const STILL_WALKING: ReadonlySet<string> = new Set(['navigating', 'paused']);
// Counted from the watch's making, right before the walk is sent.
const START_DEADLINE_MS = 15_000;
// The backend echoes the destination the frontend sent; this absorbs float
// noise only (1e-6° is about 0.1 m).
const SAME_POINT_DEG = 1e-6;

/** One 撈水果 walk's arrival watch; never mutated, each event gives a new one. */
export interface FruitArrivalWatch {
  readonly verdict: FruitArrivalVerdict;
  readonly flower: LatLng;
  /** Local ms after which a device that hasn't started cancels the watch. */
  readonly startBy: number;
  readonly devices: ReadonlyMap<string, FruitDeviceStage>;
}

/**
 * A new arrival watch. Made right before the walk is sent: its start event
 * may beat the navigate reply, and the teleport before it must not use up
 * the 15 s start deadline.
 *
 * @param udids the devices sent walking.
 * @param flower the destination as sent to navigate.
 * @param createdAtMs now (local clock).
 */
export function watchFruitArrival(
  udids: readonly string[],
  flower: LatLng,
  createdAtMs: number,
): FruitArrivalWatch {
  return {
    verdict: 'waiting',
    flower,
    startBy: createdAtMs + START_DEADLINE_MS,
    devices: new Map(udids.map((u) => [u, 'notStarted'])),
  };
}

// Whether an event's `destination` is the flower's point.
function isSamePoint(dest: unknown, flower: LatLng): boolean {
  const d = dest as { lat?: unknown; lng?: unknown } | null | undefined;
  if (typeof d?.lat !== 'number' || typeof d.lng !== 'number') return false;
  return Math.abs(d.lat - flower.lat) <= SAME_POINT_DEG && Math.abs(d.lng - flower.lng) <= SAME_POINT_DEG;
}

// Which devices an event is about. The engine tags its events with `udid`.
// device_disconnected comes as `udids` only (USB unplugged, device lost) or
// as both `udid` and `udids` (WiFi tunnel stopped, user disconnect); one
// naming no device means all of them, as in useDevice.ts.
function eventUdids(type: string, data: Record<string, unknown>, watched: ReadonlyMap<string, unknown>): readonly unknown[] {
  const one = typeof data.udid === 'string' && data.udid ? [data.udid] : [];
  if (type !== 'device_disconnected') return one;
  const named = Array.isArray(data.udids) ? data.udids : one;
  return named.length > 0 ? named : [...watched.keys()];
}

function stepDevice(
  stage: FruitDeviceStage, type: string, data: Record<string, unknown>, flower: LatLng,
): FruitDeviceStage | 'cancelled' {
  // Until its walk to this flower starts, a device ignores everything, so the
  // idle from stopping the previous walk isn't read as a stop.
  if (stage === 'notStarted') {
    return type === 'state_change' && data.state === 'navigating' && isSamePoint(data.destination, flower) ? 'walking' : stage;
  }
  // The idle navigator.py sends right after navigation_complete included.
  if (stage === 'arrived') return stage;
  if (type === 'state_change') return STILL_WALKING.has(data.state as string) ? stage : 'cancelled';
  if (type === 'navigation_complete') return isSamePoint(data.destination, flower) ? 'arrived' : 'cancelled';
  if (type === 'device_disconnected') return 'cancelled';
  return stage;
}

/**
 * The watch after one WebSocket event. Per device: a navigating
 * state_change to the flower starts it; then navigation_complete to the
 * flower is arrival, while any state but navigating / paused, a
 * navigation_complete elsewhere or its device_disconnected cancels. Every
 * device must arrive; one cancel cancels all. Events from other devices are
 * ignored. A device not started 15 s after the watch was made cancels it.
 *
 * @param watch the current watch.
 * @param msg the event.
 * @param nowMs when it came in (local clock, as for createdAtMs).
 * @returns a new watch, or `watch` itself when the event changes nothing.
 */
export function feedFruitArrival(watch: FruitArrivalWatch, msg: WsMessage, nowMs: number): FruitArrivalWatch {
  if (watch.verdict !== 'waiting') return watch;
  // Before the event itself: the watch only moves when an event comes in, so
  // a start arriving past the deadline must not count as one.
  if (nowMs > watch.startBy && [...watch.devices.values()].includes('notStarted')) return { ...watch, verdict: 'cancelled' };
  const data = (msg.data !== null && typeof msg.data === 'object' ? msg.data : {}) as Record<string, unknown>;
  let devices: Map<string, FruitDeviceStage> | null = null;
  for (const udid of eventUdids(msg.type, data, watch.devices)) {
    const stage = typeof udid === 'string' ? (devices ?? watch.devices).get(udid) : undefined;
    if (stage === undefined) continue;
    const next = stepDevice(stage, msg.type, data, watch.flower);
    if (next === 'cancelled') return { ...watch, verdict: 'cancelled' };
    if (next === stage) continue;
    devices ??= new Map(watch.devices);
    devices.set(udid as string, next);
  }
  if (!devices) return watch;
  const verdict = [...devices.values()].every((s) => s === 'arrived') ? 'arrived' : 'waiting';
  return { ...watch, devices, verdict };
}

/** The arrival watches of 撈水果 walks under way; see {@link createFruitArrivalTracker}. */
export interface FruitArrivalTracker<T> {
  /**
   * Sends one 撈水果 walk with an arrival watch made right before it: the
   * start event may beat the reply, and the teleport before it must not use
   * up the 15 s start deadline. A walk that isn't sent drops the watch, since
   * kept it would wait out the 15 s and a 導航到這裡 onto the same flower
   * within them would be marked.
   *
   * @param flower handed to `onArrived` if every device walks onto `dest`.
   * @param walkers the devices sent walking.
   * @param dest the destination as sent to navigate.
   * @param send sends the walk; a throw drops the watch and is rethrown.
   * @param allSent whether every device's walk was sent; false drops the watch.
   * @returns what `send` resolved with.
   */
  sendWatched<N>(flower: T, walkers: readonly string[], dest: LatLng, send: () => Promise<N>, allSent: (n: N) => boolean): Promise<N>;
  /**
   * Feeds one WebSocket event to every watch ({@link feedFruitArrival}). A
   * final verdict drops the watch; arrival then calls `onArrived`. Fits
   * `ws.subscribe`.
   */
  feed(msg: WsMessage): void;
  /**
   * The WebSocket dropped: drops every watch, without waiting for the
   * reconnect. A navigation_complete missed meanwhile would leave a watch
   * walking for good, and a later 導航到這裡 onto the same flower from an idle
   * device (which sends no idle) would pass for its arrival. Watches made
   * afterwards work as usual.
   */
  socketDropped(): void;
}

/**
 * The arrival watches behind 自動標記, kept in memory only (reloading the page
 * drops them).
 *
 * @param onArrived called with the flower once every device of its walk has
 *   arrived, at most once per walk.
 * @param nowMs the local clock, read when a watch is made and per event.
 */
export function createFruitArrivalTracker<T>(onArrived: (flower: T) => void, nowMs: () => number): FruitArrivalTracker<T> {
  const watches = new Set<{ watch: FruitArrivalWatch; flower: T }>();
  return {
    async sendWatched(flower, walkers, dest, send, allSent) {
      const entry = { watch: watchFruitArrival(walkers, dest, nowMs()), flower };
      watches.add(entry);
      try {
        const n = await send();
        if (!allSent(n)) watches.delete(entry);
        return n;
      } catch (e) {
        watches.delete(entry);
        throw e;
      }
    },
    feed(msg) {
      for (const entry of watches) {
        entry.watch = feedFruitArrival(entry.watch, msg, nowMs());
        if (entry.watch.verdict === 'waiting') continue;
        watches.delete(entry);
        if (entry.watch.verdict === 'arrived') onArrived(entry.flower);
      }
    },
    socketDropped() {
      watches.clear();
    },
  };
}
