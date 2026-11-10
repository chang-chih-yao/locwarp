// Run from the repo root:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"
//
// Locks the 撈水果 flow (GLOSSARY.md: 種花, 撈水果): where it starts and how
// the teleport result gates the walk. Distances are measured with haversine
// on a 6371 km sphere, independent of the module's 111,320 m-per-degree
// offset, so the two only have to agree within 0.1 m. Q numbers refer to the
// decisions in .scratch/pipi-fruit-approach/issues/01-popup-fruit-button.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedFruitArrival, fruitStartPoint, runFruitApproach, watchFruitArrival } from '../../frontend/src/pipiFruit.ts';
import type { FruitTeleportOutcome } from '../../frontend/src/pipiFruit.ts';

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Asserts `p` is 35 m ± 0.1 m due east of `from`. */
function assertDueEast35m(from: { lat: number; lng: number }, p: { lat: number; lng: number }) {
  assert.equal(p.lat, from.lat, '緯度不變');
  assert.ok(p.lng > from.lng, `經度往東：${p.lng} > ${from.lng}`);
  const d = haversineM(from, p);
  assert.ok(Math.abs(d - 35) <= 0.1, `距離 ${d} m`);
}

test('撈水果的起點在花的正東方 35 m（台北緯度 25 與緯度 60 兩處）', () => {
  // Latitude 60 halves cos(lat): forgetting the cos(lat) term lands 17.5 m away.
  for (const flower of [{ lat: 25.04, lng: 121.56 }, { lat: 60, lng: 24.94 }]) {
    assertDueEast35m(flower, fruitStartPoint(flower.lat, flower.lng));
  }
});

const FLOWER = { lat: 25.04, lng: 121.56 };
const ALL_OK: FruitTeleportOutcome = { ok: [{ udid: 'A' }, { udid: 'B' }], failed: [] };

type LatLng = { lat: number; lng: number };

/**
 * Fake teleport / navigate that record their calls. The teleport resolves
 * only when `finishTeleport` is called, so a test can check what happens
 * while it is still in flight.
 */
function fakes(outcome: FruitTeleportOutcome) {
  const teleported: LatLng[] = [];
  const navigated: Array<LatLng & { opts: unknown }> = [];
  let finish!: () => void;
  const teleportDone = new Promise<void>((r) => { finish = r; });
  return {
    teleported,
    navigated,
    finishTeleport: () => finish(),
    deps: {
      teleport: async (lat: number, lng: number) => {
        teleported.push({ lat, lng });
        await teleportDone;
        return outcome;
      },
      navigate: async (lat: number, lng: number, opts: { straightLine: boolean; skipPreSync: boolean }) => {
        navigated.push({ lat, lng, opts });
        return 'nav-result';
      },
    },
  };
}

const settle = () => new Promise((r) => setImmediate(r));

test('全部瞬移成功：先瞬移到起點，等瞬移完成才導航到花，強制直線並跳過 preSyncStart', async () => {
  const f = fakes(ALL_OK);
  const run = runFruitApproach(FLOWER, f.deps);
  await settle();
  assert.equal(f.teleported.length, 1);
  assertDueEast35m(FLOWER, f.teleported[0]);
  assert.deepEqual(f.navigated, [], '瞬移還沒完成就導航');

  f.finishTeleport();
  const result = await run;
  assert.deepEqual(f.navigated, [{ ...FLOWER, opts: { straightLine: true, skipPreSync: true } }]);
  assert.deepEqual(result, { aborted: false, teleport: ALL_OK, navigate: 'nav-result' });
});

/** Runs 撈水果 with a teleport that resolves at once with `outcome`. */
async function runWith(outcome: FruitTeleportOutcome) {
  const f = fakes(outcome);
  f.finishTeleport();
  return { f, result: await runFruitApproach(FLOWER, f.deps) };
}

test('全部瞬移失敗：不導航，回傳中止與每台裝置的瞬移結果', async () => {
  const allFailed = { ok: [], failed: [{ udid: 'A', reason: 'cooldown' }, { udid: 'B', reason: 'disconnected' }] };
  const { f, result } = await runWith(allFailed);
  assert.deepEqual(f.navigated, []);
  assert.deepEqual(result, { aborted: true, teleport: allFailed });
});

// Q19: one failed teleport stops every device; the ones that made it stay at
// the start. Letting only the successful ones walk would turn this red.
test('只有部分裝置瞬移失敗：全部都不導航，回傳中止', async () => {
  const partial = { ok: [{ udid: 'A' }], failed: [{ udid: 'B', reason: 'disconnected' }] };
  const { f, result } = await runWith(partial);
  assert.deepEqual(f.navigated, []);
  assert.deepEqual(result, { aborted: true, teleport: partial });
});

test('沒有任何裝置瞬移成功（零台）也不導航', async () => {
  const none = { ok: [], failed: [] };
  const { f, result } = await runWith(none);
  assert.deepEqual(f.navigated, []);
  assert.deepEqual(result, { aborted: true, teleport: none });
});

// ── 抵達監看 (自動標記) ───────────────────────────────────────────────
// Locks when 撈水果 counts as having walked onto the flower, so 自動標記
// (.scratch/pipi-flower-essence/spec.md「自動標記」, Q17, Q22–Q26) marks it.
// The events copy what the backend broadcasts: the engine tags each with
// its udid (backend/main.py event_callback), navigator.py sends the
// navigating state_change with the destination and, on arrival,
// navigation_complete then idle.

type WsMsg = { type: string; data: Record<string, unknown> };

const T0 = 1_000_000;
const startEv = (udid: string, dest: LatLng = FLOWER): WsMsg =>
  ({ type: 'state_change', data: { state: 'navigating', destination: dest, udid } });
const stateEv = (udid: string, state: string): WsMsg => ({ type: 'state_change', data: { state, udid } });
const completeEv = (udid: string, dest: LatLng = FLOWER): WsMsg =>
  ({ type: 'navigation_complete', data: { destination: dest, udid } });

/**
 * Feeds `steps` (event, ms after the watch was made) to a new watch for
 * `udids`, and returns the verdict after each one.
 */
function verdicts(udids: string[], steps: Array<[WsMsg, number]>): string[] {
  let w = watchFruitArrival(udids, FLOWER, T0);
  return steps.map(([msg, at]) => {
    w = feedFruitArrival(w, msg, T0 + at);
    return w.verdict;
  });
}

test('單機：開始走、終點是這朵花，之後 navigation_complete 終點相同，算抵達', () => {
  assert.deepEqual(verdicts(['A'], [[startEv('A'), 100], [completeEv('A'), 9_000]]), ['waiting', 'arrived']);
});

test('開始之後、完成之前收到 idle（中途按了停止）或斷線狀態，算取消', () => {
  for (const state of ['idle', 'disconnected']) {
    assert.deepEqual(verdicts(['A'], [[startEv('A'), 100], [stateEv('A', state), 3_000]]), ['waiting', 'cancelled'], state);
  }
});

// Only navigating / paused count as still walking: a state added later must
// read as "not walking anymore", not slip through as one.
test('開始之後收到 navigating、paused 以外的狀態（teleporting、joystick、looping、reconnecting、以後新增的），算取消', () => {
  for (const state of ['teleporting', 'joystick', 'looping', 'reconnecting', 'some_future_state']) {
    assert.deepEqual(verdicts(['A'], [[startEv('A'), 100], [stateEv('A', state), 3_000]]), ['waiting', 'cancelled'], state);
  }
});

test('暫停 → 繼續 → 完成，還是抵達（Q22：暫停不算取消）', () => {
  const pause: WsMsg = { type: 'state_change', data: { state: 'paused', paused_from: 'navigating', udid: 'A' } };
  // resume() sends the state it paused from, without a destination.
  assert.deepEqual(
    verdicts(['A'], [[startEv('A'), 100], [pause, 2_000], [stateEv('A', 'navigating'), 60_000], [completeEv('A'), 70_000]]),
    ['waiting', 'waiting', 'waiting', 'arrived'],
  );
});

test('完成時終點不是這朵花（走到一半改去別的地方），算取消', () => {
  const elsewhere = { lat: FLOWER.lat + 0.001, lng: FLOWER.lng };
  assert.deepEqual(verdicts(['A'], [[startEv('A'), 100], [completeEv('A', elsewhere), 9_000]]), ['waiting', 'cancelled']);
});

test('抵達之後緊接著的 idle（navigator.py 完成後會送），結果仍然是抵達', () => {
  assert.deepEqual(
    verdicts(['A'], [[startEv('A'), 100], [completeEv('A'), 9_000], [stateEv('A', 'idle'), 9_001]]),
    ['waiting', 'arrived', 'arrived'],
  );
});

test('最終結果之後再餵事件，結果不變：取消之後的完成不算抵達，抵達之後的取消事件也不算', () => {
  assert.deepEqual(
    verdicts(['A'], [[startEv('A'), 100], [stateEv('A', 'idle'), 3_000], [startEv('A'), 4_000], [completeEv('A'), 9_000]]),
    ['waiting', 'cancelled', 'cancelled', 'cancelled'],
  );
  assert.deepEqual(
    verdicts(['A'], [[startEv('A'), 100], [completeEv('A'), 9_000], [startEv('A'), 10_000], [stateEv('A', 'teleporting'), 11_000]]),
    ['waiting', 'arrived', 'arrived', 'arrived'],
  );
});

// The teleport to the start, and stopping the previous walk, send their own
// events, which may reach the frontend after the watch is made.
test('開始之前收到的事件一律忽略：瞬移的 teleporting、idle，上一段走路的 navigation_complete，之後正常開始、完成還是抵達', () => {
  const elsewhere = { lat: 24.79, lng: 120.99 };
  assert.deepEqual(
    verdicts(['A'], [
      [stateEv('A', 'teleporting'), 10], [stateEv('A', 'idle'), 20], [completeEv('A', elsewhere), 30],
      [startEv('A'), 100], [completeEv('A'), 9_000],
    ]),
    ['waiting', 'waiting', 'waiting', 'waiting', 'arrived'],
  );
});

// Only the navigating state_change starts a device. The idle at 20 ms is the
// teleport's: had the earlier event started it, that idle would cancel.
test('開始之前，終點是這朵花的其他事件也不算開始：上一次撈同一朵花晚到的 navigation_complete，或後端以後讓別的狀態也帶終點', () => {
  const pausedWithDest: WsMsg = { type: 'state_change', data: { state: 'paused', destination: FLOWER, udid: 'A' } };
  for (const [name, early] of [['上一次的 navigation_complete', completeEv('A')], ['帶終點的 paused', pausedWithDest]] as const) {
    assert.deepEqual(
      verdicts(['A'], [[early, 10], [stateEv('A', 'idle'), 20], [startEv('A'), 100], [completeEv('A'), 9_000]]),
      ['waiting', 'waiting', 'waiting', 'arrived'],
      name,
    );
  }
});

test('開始走的終點不是這朵花：不算開始，之後的完成也不算抵達', () => {
  const elsewhere = { lat: FLOWER.lat, lng: FLOWER.lng + 0.001 };
  assert.deepEqual(
    verdicts(['A'], [[startEv('A', elsewhere), 100], [completeEv('A', elsewhere), 9_000], [completeEv('A'), 9_500]]),
    ['waiting', 'waiting', 'waiting'],
  );
});

const usbLost = (udids: string[]): WsMsg =>
  ({ type: 'device_disconnected', data: { udids, reason: 'usb_unplugged', remaining_count: 0 } });
const wifiStopped = (udid: string): WsMsg =>
  ({ type: 'device_disconnected', data: { udid, udids: [udid], reason: 'wifi_tunnel_stopped', remaining_count: 0 } });

test('device_disconnected 的各種形狀，開始之後收到都算取消', () => {
  const shapes: Array<[string, WsMsg]> = [
    ['只帶 udids（USB 拔掉、裝置掉線）', usbLost(['A'])],
    ['同時帶 udid 和 udids（WiFi 通道停掉、使用者斷線）', wifiStopped('A')],
    ['只帶 udid', { type: 'device_disconnected', data: { udid: 'A' } }],
    ['兩個都沒有：當成所有裝置都斷線', { type: 'device_disconnected', data: { reason: 'user' } }],
    // useDevice.ts does the same; the backend sends no such event today.
    ['udids 是空陣列：一樣當成所有裝置都斷線', usbLost([])],
  ];
  for (const [name, ev] of shapes) {
    assert.deepEqual(verdicts(['A'], [[startEv('A'), 100], [ev, 3_000]]), ['waiting', 'cancelled'], name);
  }
});

test('device_disconnected 的 udids 裡沒有這台裝置時，不影響結果；udids 是陣列就不看 udid', () => {
  const other: WsMsg = { type: 'device_disconnected', data: { udid: 'A', udids: ['B'] } };
  assert.deepEqual(
    verdicts(['A'], [[startEv('A'), 100], [usbLost(['B']), 3_000], [other, 3_500], [completeEv('A'), 9_000]]),
    ['waiting', 'waiting', 'waiting', 'arrived'],
  );
});

// Q23: every device is a different game account, so one that didn't make it
// means no 自動標記.
test('群組：兩台都完成才算抵達，只有一台完成時還在等', () => {
  assert.deepEqual(
    verdicts(['A', 'B'], [[startEv('A'), 100], [startEv('B'), 120], [completeEv('A'), 9_000], [completeEv('B'), 9_100]]),
    ['waiting', 'waiting', 'waiting', 'arrived'],
  );
});

test('群組：一台取消就整個取消，另一台之後完成也不算抵達', () => {
  assert.deepEqual(
    verdicts(['A', 'B'], [
      [startEv('A'), 100], [startEv('B'), 120], [completeEv('A'), 9_000], [stateEv('B', 'idle'), 9_050], [completeEv('B'), 9_100],
    ]),
    ['waiting', 'waiting', 'waiting', 'cancelled', 'cancelled'],
  );
  assert.deepEqual(
    verdicts(['A', 'B'], [[startEv('A'), 100], [startEv('B'), 120], [usbLost(['B']), 3_000]]),
    ['waiting', 'waiting', 'cancelled'],
  );
});

// Unlike a single device, the first arrival isn't final here, so only the
// device's own stage keeps the idle that follows it from cancelling.
test('群組：先抵達的那台緊接著送 idle，另一台之後完成，還是抵達', () => {
  assert.deepEqual(
    verdicts(['A', 'B'], [
      [startEv('A'), 100], [startEv('B'), 120], [completeEv('A'), 9_000], [stateEv('A', 'idle'), 9_001], [completeEv('B'), 9_400],
    ]),
    ['waiting', 'waiting', 'waiting', 'waiting', 'arrived'],
  );
});

test('不在清單裡的裝置送來的事件，不影響結果', () => {
  assert.deepEqual(
    verdicts(['A'], [
      [startEv('A'), 100], [startEv('C'), 200], [stateEv('C', 'idle'), 300], [completeEv('C'), 400],
      [completeEv('C', { lat: 0, lng: 0 }), 500], [completeEv('A'), 9_000],
    ]),
    ['waiting', 'waiting', 'waiting', 'waiting', 'waiting', 'arrived'],
  );
});

const posEv = (udid: string): WsMsg => ({ type: 'position_update', data: { lat: FLOWER.lat, lng: FLOWER.lng, udid } });

// The deadline is checked only when an event comes in, so without it a watch
// whose walk never started would still be armed when the user later uses
// 導航到這裡 on the same flower, and that walk would be marked.
test('從建立監看算起，過了 15 秒還有裝置沒開始，算取消；15 秒內都開始了就不受期限影響', () => {
  assert.deepEqual(verdicts(['A'], [[posEv('A'), 15_000], [posEv('A'), 15_001]]), ['waiting', 'cancelled']);
  assert.deepEqual(
    verdicts(['A', 'B'], [[startEv('A'), 100], [posEv('A'), 15_001]]),
    ['waiting', 'cancelled'],
    '群組裡有一台還沒開始',
  );
  assert.deepEqual(
    verdicts(['A', 'B'], [[startEv('A'), 100], [startEv('B'), 15_000], [posEv('A'), 600_000], [completeEv('A'), 600_100], [completeEv('B'), 600_200]]),
    ['waiting', 'waiting', 'waiting', 'waiting', 'arrived'],
  );
});

test('15 秒後才收到開始事件：先看期限再看事件，判成取消，不當成開始', () => {
  assert.deepEqual(verdicts(['A'], [[startEv('A'), 15_001], [completeEv('A'), 20_000]]), ['cancelled', 'cancelled']);
  // The later 導航到這裡 the deadline is for: the first event fed is its start.
  assert.deepEqual(verdicts(['A'], [[startEv('A'), 20 * 60_000], [completeEv('A'), 20 * 60_000 + 9_000]]), ['cancelled', 'cancelled']);
});

// The backend echoes the coordinate the frontend sent, so this only absorbs
// float noise from a round trip; 1e-6° is about 0.1 m.
test('終點的座標差在 1e-6 度以內算相等，超過就不是這朵花', () => {
  const near = { lat: FLOWER.lat + 5e-7, lng: FLOWER.lng - 5e-7 };
  assert.deepEqual(verdicts(['A'], [[startEv('A', near), 100], [completeEv('A', near), 9_000]]), ['waiting', 'arrived']);
  for (const off of [{ lat: 2e-6, lng: 0 }, { lat: 0, lng: -2e-6 }]) {
    const far = { lat: FLOWER.lat + off.lat, lng: FLOWER.lng + off.lng };
    assert.deepEqual(verdicts(['A'], [[startEv('A', far), 100]]), ['waiting'], `開始 ${JSON.stringify(off)}`);
    assert.deepEqual(verdicts(['A'], [[startEv('A'), 100], [completeEv('A', far), 9_000]]), ['waiting', 'cancelled'], `完成 ${JSON.stringify(off)}`);
  }
});

test('終點沒有座標或座標不是數字，不是這朵花', () => {
  const noDest: WsMsg = { type: 'state_change', data: { state: 'navigating', udid: 'A' } };
  const strDest: WsMsg = { type: 'navigation_complete', data: { destination: { lat: String(FLOWER.lat), lng: String(FLOWER.lng) }, udid: 'A' } };
  assert.deepEqual(verdicts(['A'], [[noDest, 100], [completeEv('A'), 9_000]]), ['waiting', 'waiting']);
  assert.deepEqual(verdicts(['A'], [[startEv('A'), 100], [strDest, 9_000]]), ['waiting', 'cancelled']);
});
