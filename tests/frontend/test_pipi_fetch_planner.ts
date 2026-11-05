// Run from the repo root:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"
//
// Locks when the 蘑菇地圖圖層 hides its markers, reuses the last fetch, or asks
// the backend again. Zoom is hard-coded and the threshold constant is not
// imported: if it went back to a lower zoom, these tests must go red with it.
// The threshold test pins both sides of it, 14 and 15.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPipiFetchPlanner } from '../../frontend/src/pipiFetchPlanner.ts';
import type { PipiBox } from '../../frontend/src/pipiFetchPlanner.ts';

// 2026-11-05 14:00 Taipei.
const T0 = Date.UTC(2026, 10, 5, 6, 0, 0);

// A Taipei view, and the padded bbox a fetch would record around it.
const VIEW: PipiBox = { north: 25.06, south: 25.03, east: 121.54, west: 121.49 };
const RECORDED: PipiBox = { north: 25.08, south: 25.01, east: 121.57, west: 121.46 };

test('載入門檻是 zoom 15：沒有抓取紀錄時 zoom 14 藏起來、zoom 15 要抓（原站在 zoom 14 只回 5 分鐘內結束的點位）', () => {
  const planner = createPipiFetchPlanner();
  assert.equal(planner.plan({ zoom: 14, view: VIEW, now: T0, force: false }), 'hide');
  assert.equal(planner.plan({ zoom: 15, view: VIEW, now: T0, force: false }), 'fetch');
});

test('zoom 13 時 60 秒自動更新也不發請求，只把點位藏起來', () => {
  const planner = createPipiFetchPlanner();
  assert.equal(planner.plan({ zoom: 13, view: VIEW, now: T0, force: true }), 'hide');
});

/** A planner holding one untruncated zoom-15 fetch of RECORDED, made at T0. */
function plannerWithFetch(fetch: Partial<{ bounds: PipiBox; zoom: number; truncated: boolean }> = {}) {
  const planner = createPipiFetchPlanner();
  planner.record({ bounds: RECORDED, at: T0, zoom: 15, truncated: false, ...fetch });
  return planner;
}

test('資料記下後 60 秒內沿用，剛好滿 60 秒就重抓', () => {
  const planner = plannerWithFetch();
  assert.equal(planner.plan({ zoom: 15, view: VIEW, now: T0 + 59_999, force: false }), 'reuse');
  assert.equal(planner.plan({ zoom: 15, view: VIEW, now: T0 + 60_000, force: false }), 'fetch');
});

test('門檻以上的 60 秒自動更新，即使資料還新、畫面還在範圍內也重抓', () => {
  const planner = plannerWithFetch();
  assert.equal(planner.plan({ zoom: 15, view: VIEW, now: T0 + 1000, force: true }), 'fetch');
});

test('畫面剛好等於抓取範圍時沿用（邊界相等算在範圍內，跟 Leaflet 的 contains 一樣）', () => {
  const planner = plannerWithFetch();
  assert.equal(planner.plan({ zoom: 15, view: { ...RECORDED }, now: T0 + 1000, force: false }), 'reuse');
});

const OUTSIDE_BY_ONE_SIDE: Array<[string, PipiBox]> = [
  ['北', { ...RECORDED, north: 25.0801 }],
  ['南', { ...RECORDED, south: 25.0099 }],
  ['東', { ...RECORDED, east: 121.5701 }],
  ['西', { ...RECORDED, west: 121.4599 }],
];
for (const [side, view] of OUTSIDE_BY_ONE_SIDE) {
  test(`畫面的${side}邊超出抓取範圍一點點就重抓`, () => {
    const planner = plannerWithFetch();
    assert.equal(planner.plan({ zoom: 15, view, now: T0 + 1000, force: false }), 'fetch');
  });
}

test('被截斷的資料只在同一個 zoom 沿用，換 zoom 就重抓', () => {
  const planner = plannerWithFetch({ zoom: 15, truncated: true });
  assert.equal(planner.plan({ zoom: 15, view: VIEW, now: T0 + 1000, force: false }), 'reuse');
  assert.equal(planner.plan({ zoom: 16, view: VIEW, now: T0 + 1000, force: false }), 'fetch');
});

test('沒被截斷的資料換 zoom 也沿用', () => {
  const planner = plannerWithFetch({ zoom: 15, truncated: false });
  assert.equal(planner.plan({ zoom: 16, view: VIEW, now: T0 + 1000, force: false }), 'reuse');
});

test('zoom 13 時即使有新鮮、涵蓋畫面的資料也藏起來，不沿用', () => {
  const planner = plannerWithFetch();
  assert.equal(planner.plan({ zoom: 13, view: VIEW, now: T0 + 1000, force: false }), 'hide');
});
