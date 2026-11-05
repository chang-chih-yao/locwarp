// Run from the repo root:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"
//
// Locks which 蘑菇地圖 points get drawn when the 該顯示的點位 exceed the 點位上限
// (GLOSSARY.md: 點位上限, 上限截斷, 畫面內缺點). The cap, the view size and every
// coordinate are hard-coded, and the module's cap constant is not imported:
// these tests must not move along with it.
//
// 畫面框距離 = max(|dx| / (W/2), |dy| / (H/2)); ≤ 1 is inside the view.
// Each assertion compares the full sorted id list, so a duplicate or a
// missing id fails too, not just a wrong count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPipiMarkers } from '../../frontend/src/pipiMarkerSelection.ts';

// A 1400×850 map: half sizes 700 and 425. The centre is an arbitrary
// projected pixel point, not the origin, so offsets must be taken from it.
const W = 1400;
const H = 850;
const CENTER = { x: 50_000, y: 30_000 };

interface Pt { id: string; x: number; y: number }

/** A point at pixel offset (dx, dy) from the view centre. */
const pt = (id: string, dx: number, dy: number): Pt => ({ id, x: CENTER.x + dx, y: CENTER.y + dy });

function select(
  items: Pt[],
  { cap, keepId = null, shouldShow = () => true }: { cap: number; keepId?: string | null; shouldShow?: (p: Pt) => boolean },
) {
  return selectPipiMarkers({
    items, shouldShow, point: (p) => ({ x: p.x, y: p.y }), center: CENTER, width: W, height: H, cap, keepId,
  });
}

const ids = (r: { items: Pt[] }) => r.items.map((p) => p.id).sort();

test('超過點位上限時留下畫面框距離最小的點位，跟輸入順序無關', () => {
  // Nearest last on purpose: taking the first two inputs gives the far pair.
  const r = select([
    pt('far-right', 600, 0), // 0.857
    pt('far-down', 0, 400), // 0.941
    pt('near-right', 100, 0), // 0.143
    pt('near-up', 0, -50), // 0.118
  ], { cap: 2 });
  assert.deepEqual(ids(r), ['near-right', 'near-up']);
  assert.equal(r.capped, true);
});

test('挑出的範圍是跟畫面同比例的長方形：畫面內的角落先於畫面上方外側的點位入選', () => {
  // Straight-line distance picks up-outside + right-inside (450 < 650 < 763);
  // unscaled max(|dx|, |dy|) picks up-outside + corner-inside (450, then the
  // 650 tie in input order). Only the scaled one keeps both inside points.
  const r = select([
    pt('corner-inside', 650, 400), // max(0.929, 0.941) = 0.941
    pt('right-inside', 650, 0), // 0.929
    pt('up-outside', 0, -450), // 1.059
  ], { cap: 2 });
  assert.deepEqual(ids(r), ['corner-inside', 'right-inside']);
});

test('不該顯示的點位不佔名額：即使最靠近中心也不畫，名額照樣補滿', () => {
  const r = select([
    pt('hidden', 0, 0),
    pt('a', 100, 0),
    pt('b', 200, 0),
    pt('c', 300, 0),
  ], { cap: 2, shouldShow: (p) => p.id !== 'hidden' });
  assert.deepEqual(ids(r), ['a', 'b']);
});

// Four shown points, cap 2: normal selection is a + b.
const FOUR = () => [pt('a', 100, 0), pt('b', 200, 0), pt('c', 300, 0), pt('far', 650, 0)];

test('打開中 popup 的點位不在名額內時額外多畫它一個，原本入選的一個都不少', () => {
  const r = select(FOUR(), { cap: 2, keepId: 'far' });
  assert.deepEqual(ids(r), ['a', 'b', 'far']);
});

test('打開中 popup 的點位本來就入選時不另外加，也不重複', () => {
  const r = select(FOUR(), { cap: 2, keepId: 'a' });
  assert.deepEqual(ids(r), ['a', 'b']);
});

test('打開中 popup 的點位不該顯示時照常不畫', () => {
  const r = select(FOUR(), { cap: 2, keepId: 'far', shouldShow: (p) => p.id !== 'far' });
  assert.deepEqual(ids(r), ['a', 'b']);
});

test('打開中 popup 的點位不在這批資料裡時，結果等於正常挑選', () => {
  const r = select(FOUR(), { cap: 2, keepId: 'gone' });
  assert.deepEqual(ids(r), ['a', 'b']);
});

test('該顯示的點位剛好等於點位上限時全部畫出、不算上限截斷，多一個就算', () => {
  const shouldShow = (p: Pt) => p.id !== 'hidden';
  // Three shown points plus one that isn't, for a cap of 3.
  const atCap = [pt('a', 100, 0), pt('hidden', 0, 0), pt('out-1', 2000, 0), pt('out-2', 0, -3000)];
  const exact = select(atCap, { cap: 3, shouldShow });
  assert.deepEqual(ids(exact), ['a', 'out-1', 'out-2']);
  assert.equal(exact.capped, false);
  assert.equal(exact.viewCapped, false);

  const over = select([...atCap, pt('b', 200, 0)], { cap: 3, shouldShow });
  assert.deepEqual(ids(over), ['a', 'b', 'out-1']);
  assert.equal(over.capped, true);
});

test('整批超過點位上限、但畫面內的點位都畫出來時，不算畫面內缺點', () => {
  const r = select([
    pt('out-right', 800, 0), // 1.143
    pt('a', 100, 0),
    pt('out-down', 0, 500), // 1.176
    pt('b', 200, 0),
  ], { cap: 2 });
  assert.deepEqual(ids(r), ['a', 'b']);
  assert.equal(r.capped, true);
  assert.equal(r.viewCapped, false);
});

test('畫面內該顯示的點位超過點位上限時，算畫面內缺點', () => {
  const r = select([
    pt('a', 100, 0),
    pt('b', 200, 0),
    pt('c', 300, 0),
    pt('out-right', 800, 0),
  ], { cap: 2 });
  assert.deepEqual(ids(r), ['a', 'b']);
  assert.equal(r.capped, true);
  assert.equal(r.viewCapped, true);
});

test('剛好在畫面邊上的點位算畫面內', () => {
  const r = select([pt('a', 100, 0), pt('b', 200, 0), pt('edge', 700, 0)], { cap: 2 });
  assert.deepEqual(ids(r), ['a', 'b']);
  assert.equal(r.viewCapped, true);
});

test('畫面內的點位剛好等於點位上限、打開中 popup 的點位在畫面外：畫面內全畫出再加上它，不算畫面內缺點', () => {
  const r = select([
    pt('a', 100, 0),
    pt('out-right', 800, 0),
    pt('b', 200, 0),
    pt('out-down', 0, 500),
  ], { cap: 2, keepId: 'out-down' });
  assert.deepEqual(ids(r), ['a', 'b', 'out-down']);
  assert.equal(r.capped, true);
  assert.equal(r.viewCapped, false);
});

test('畫面框距離相同時照輸入順序入選', () => {
  // All three sit at 0.5: 350 / 700 = 212.5 / 425.
  const r = select([
    pt('tie-1', 350, 0),
    pt('tie-2', 0, 212.5),
    pt('tie-3', -350, 0),
    pt('out', 900, 0),
  ], { cap: 2 });
  assert.deepEqual(ids(r), ['tie-1', 'tie-2']);
});

test('未超過點位上限時，畫面外的也全部畫出', () => {
  const r = select([pt('a', 100, 0), pt('out', 5000, 5000)], { cap: 5 });
  assert.deepEqual(ids(r), ['a', 'out']);
  assert.equal(r.capped, false);
});
