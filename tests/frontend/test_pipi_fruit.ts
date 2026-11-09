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
import { fruitStartPoint, runFruitApproach } from '../../frontend/src/pipiFruit.ts';
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
