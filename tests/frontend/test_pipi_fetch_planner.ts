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

test('縮到門檻以下再放大回同一個畫面，60 秒內沿用縮小前的資料，不重抓', () => {
  const planner = plannerWithFetch();
  assert.equal(planner.plan({ zoom: 14, view: VIEW, now: T0 + 5000, force: false }), 'hide');
  assert.equal(planner.plan({ zoom: 15, view: VIEW, now: T0 + 10_000, force: false }), 'reuse');
});

test('縮小期間 60 秒自動更新觸發，放大回同一個畫面時仍沿用縮小前的資料', () => {
  const planner = plannerWithFetch();
  assert.equal(planner.plan({ zoom: 14, view: VIEW, now: T0 + 5000, force: true }), 'hide');
  assert.equal(planner.plan({ zoom: 15, view: VIEW, now: T0 + 10_000, force: false }), 'reuse');
});

test('縮小期間平移到抓取範圍外，放大回來就重抓', () => {
  const planner = plannerWithFetch();
  const elsewhere: PipiBox = { north: 25.16, south: 25.13, east: 121.54, west: 121.49 };
  assert.equal(planner.plan({ zoom: 14, view: VIEW, now: T0 + 5000, force: false }), 'hide');
  assert.equal(planner.plan({ zoom: 15, view: elsewhere, now: T0 + 10_000, force: false }), 'fetch');
});

test('縮小期間資料滿 60 秒，放大回同一個畫面就重抓，不沿用過期的資料', () => {
  const planner = plannerWithFetch();
  assert.equal(planner.plan({ zoom: 14, view: VIEW, now: T0 + 5000, force: false }), 'hide');
  assert.equal(planner.plan({ zoom: 15, view: VIEW, now: T0 + 60_000, force: false }), 'fetch');
});

// 標記清單 (拿過精華, GLOSSARY.md): read once per fetch loop. One planner is
// one loop; opening the layer, a cookie re-set and 重新整理 each start a new
// one. The decisions below come from `plan` itself, as the layer feeds them.

test('新的一輪在第一個不是 hide 的決定時要讀標記清單', () => {
  const planner = createPipiFetchPlanner();
  const decision = planner.plan({ zoom: 15, view: VIEW, now: T0, force: false });
  assert.equal(decision, 'fetch');
  assert.equal(planner.shouldReadEssence(decision), true);
});

test('hide 時不讀標記清單；zoom 14 打開圖層、縮放到 15 那個決定才要讀', () => {
  const planner = createPipiFetchPlanner();
  const hidden = planner.plan({ zoom: 14, view: VIEW, now: T0, force: false });
  assert.equal(hidden, 'hide');
  assert.equal(planner.shouldReadEssence(hidden), false);
  const forcedWhileHidden = planner.plan({ zoom: 14, view: VIEW, now: T0 + 60_000, force: true });
  assert.equal(planner.shouldReadEssence(forcedWhileHidden), false);
  const back = planner.plan({ zoom: 15, view: VIEW, now: T0 + 61_000, force: false });
  assert.equal(planner.shouldReadEssence(back), true);
});

// A 429 on the list leaves it unread; after the back-off the next decision
// may well be a reuse of items fetched earlier in the same loop.
test('還沒記下讀過時，沿用資料的決定也要讀標記清單', () => {
  const planner = plannerWithFetch();
  const decision = planner.plan({ zoom: 15, view: VIEW, now: T0 + 1000, force: false });
  assert.equal(decision, 'reuse');
  assert.equal(planner.shouldReadEssence(decision), true);
});

test('記下讀過之後，同一輪的強制刷新、平移、縮放回來都不再讀標記清單', () => {
  const planner = createPipiFetchPlanner();
  assert.equal(planner.shouldReadEssence(planner.plan({ zoom: 15, view: VIEW, now: T0, force: false })), true);
  planner.recordEssenceRead();
  planner.record({ bounds: RECORDED, at: T0, zoom: 15, truncated: false });
  const elsewhere: PipiBox = { north: 25.16, south: 25.13, east: 121.54, west: 121.49 };
  const decisions = [
    planner.plan({ zoom: 15, view: VIEW, now: T0 + 1000, force: true }),
    // Panned out of the recorded box: a fetch the test doesn't record, so
    // panning back still reuses the T0 fetch.
    planner.plan({ zoom: 15, view: elsewhere, now: T0 + 2000, force: false }),
    planner.plan({ zoom: 15, view: VIEW, now: T0 + 3000, force: false }),
    planner.plan({ zoom: 14, view: VIEW, now: T0 + 4000, force: false }),
    planner.plan({ zoom: 16, view: VIEW, now: T0 + 5000, force: false }),
  ];
  assert.deepEqual(decisions, ['fetch', 'fetch', 'reuse', 'hide', 'reuse']);
  for (const d of decisions) assert.equal(planner.shouldReadEssence(d), false, d);
});

test('新的 planner（新的一輪）又會要讀標記清單', () => {
  const first = createPipiFetchPlanner();
  first.recordEssenceRead();
  const next = createPipiFetchPlanner();
  assert.equal(next.shouldReadEssence(next.plan({ zoom: 15, view: VIEW, now: T0, force: false })), true);
});
