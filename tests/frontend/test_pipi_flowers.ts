// Run from the repo root:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"
//
// Locks how 蘑菇地圖 flowers are classified and filtered (GLOSSARY.md: 花種,
// 花苞, 普花, 彩帶花). Data follows the item format sampled from the items API
// on 2026-11-05; tests that need data the site has not been seen sending say
// which upstream format change they guard against.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCommonFlower, passesFlowerFilter, ribbonEndMs } from '../../frontend/src/pipiFlowers.ts';
import type { PipiFlowerFilter } from '../../frontend/src/defaults.ts';
import type { PipiItem } from '../../frontend/src/services/api.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
// 2026-11-05 14:00 Taipei, as server time.
const NOW = Date.UTC(2026, 10, 5, 6, 0, 0);

let nextId = 0;
const base = () => ({ id: `t${++nextId}`, lat: 25.04, lng: 121.56 });

/** A real 花苞: same key as its flower, both time fields 0. */
function bud(key: string, displayName: string, state = 'Bud'): PipiItem {
  return { ...base(), itemKind: 'flower', key, displayName, state, bloomedMs: 0, wiltingMs: 0 };
}

/**
 * A bloomed flower; real ones wilt 23 h after blooming. Its exact `state`
 * value is not relied on, only that it is not a 花苞 state.
 */
function flower(key: string, displayName: string, bloomedMs = NOW - 5 * HOUR): PipiItem {
  return { ...base(), itemKind: 'flower', key, displayName, state: 'Flower', bloomedMs, wiltingMs: bloomedMs + 23 * HOUR };
}

test('普花是白色、紅色、黃色、藍色花朵這四個花種', () => {
  for (const [key, name] of [
    ['f:White:Common', '白色花朵'],
    ['f:Red:Common', '紅色花朵'],
    ['f:Yellow:Common', '黃色花朵'],
    ['f:Blue:Common', '藍色花朵'],
  ]) {
    assert.equal(isCommonFlower(flower(key, name)), true, key);
  }
});

test('同色的其他花種與 key 以 Common 結尾的新花種都不是普花', () => {
  for (const [key, name] of [
    ['f:White:Geranium', '白色天竺葵'],
    ['f:White:Cherryblossom', '白色櫻花'],
    ['f:Purple:Common', '紫色花朵'],
  ]) {
    assert.equal(isCommonFlower(flower(key, name)), false, key);
  }
});

test('剛好在盛開那一刻就是彩帶花，彩帶期在盛開後 60 分鐘結束', () => {
  assert.equal(ribbonEndMs(flower('f:White:Geranium', '白色天竺葵', NOW), NOW), NOW + 60 * MIN);
});

test('盛開後 59 分 59 秒還是彩帶花，剛好滿 60 分鐘就不是', () => {
  const bloomed = NOW - 59 * MIN - 59_000;
  assert.equal(ribbonEndMs(flower('f:White:Geranium', '白色天竺葵', bloomed), NOW), NOW + 1000);
  assert.equal(ribbonEndMs(flower('f:White:Geranium', '白色天竺葵', NOW - 60 * MIN), NOW), null);
});

test('原站若讓花在盛開後一小時內就枯萎：彩帶期在枯萎時結束，到了枯萎時間就不是彩帶花', () => {
  const early = { ...flower('f:White:Geranium', '白色天竺葵', NOW - 10 * MIN), wiltingMs: NOW + 20 * MIN };
  assert.equal(ribbonEndMs(early, NOW), NOW + 20 * MIN);
  assert.equal(ribbonEndMs(early, NOW + 20 * MIN), null);
});

test('還沒到盛開時間的花不是彩帶花', () => {
  assert.equal(ribbonEndMs(flower('f:White:Geranium', '白色天竺葵', NOW + 1000), NOW), null);
});

test('盛開或枯萎時間是 0 的花不是彩帶花', () => {
  const inWindow = flower('f:White:Geranium', '白色天竺葵', NOW - 10 * MIN);
  assert.equal(ribbonEndMs({ ...inWindow, bloomedMs: 0 }, NOW), null);
  assert.equal(ribbonEndMs({ ...inWindow, wiltingMs: 0 }, NOW), null);
});

// Real 花苞 have both time fields at 0, which already fails the time rules;
// these carry an in-window bloom time so only the 花苞 rule can reject them.
const BUD_STATES = ['Leaf', 'Bud', 'Pre-Flower', 'pre_flower', ' preflower ', 'PRE FLOWER'];
const timedBud = (state: string): PipiItem => ({
  ...bud('f:White:Geranium', '白色天竺葵', state),
  bloomedMs: NOW - 10 * MIN,
  wiltingMs: NOW - 10 * MIN + 23 * HOUR,
});

test('原站若讓花苞帶著盛開時間（含樣本沒見過的 Pre-Flower 等寫法），花苞仍不是彩帶花', () => {
  for (const state of BUD_STATES) assert.equal(ribbonEndMs(timedBud(state), NOW), null, state);
});

test('彩帶花只依傳入的伺服器時間判斷，不看本機時鐘', () => {
  for (const serverNow of [Date.UTC(2001, 0, 1), Date.UTC(2100, 0, 1)]) {
    const f = flower('f:White:Geranium', '白色天竺葵', serverNow - 10 * MIN);
    assert.equal(ribbonEndMs(f, serverNow), serverNow + 50 * MIN, new Date(serverNow).toISOString());
  }
});

test('原站若不給 state，花仍依盛開時間判斷彩帶花', () => {
  const noState = { ...flower('f:White:Geranium', '白色天竺葵', NOW - 10 * MIN), state: undefined };
  assert.equal(ribbonEndMs(noState, NOW), NOW + 50 * MIN);
});

test('原站若讓蘑菇、煙霧也帶盛開時間，它們仍不是彩帶花', () => {
  const times = { bloomedMs: NOW - 10 * MIN, wiltingMs: NOW + 23 * HOUR };
  const mushroom: PipiItem = { ...base(), itemKind: 'mushroom', displayName: '蘑菇', finishMs: NOW + HOUR, ...times };
  const smoke: PipiItem = { ...base(), itemKind: 'smoke', displayName: '煙霧', smokeEndMs: NOW + HOUR, ...times };
  assert.equal(ribbonEndMs(mushroom, NOW), null);
  assert.equal(ribbonEndMs(smoke, NOW), null);
});

// With a 2026 `now`, a bloom time of 0 already fails the 60-minute rule, so
// these run within an hour of the epoch, where only the "> 0" rule rejects it.
test('原站若用 0 或負數代表盛開時間沒有值，就算伺服器時間在 epoch 後一小時內也不算彩帶花', () => {
  const nearEpoch = 30 * MIN;
  for (const bloomedMs of [0, -10 * MIN]) {
    const unset = { ...flower('f:White:Geranium', '白色天竺葵'), bloomedMs, wiltingMs: 23 * HOUR };
    assert.equal(ribbonEndMs(unset, nearEpoch), null, String(bloomedMs));
  }
});

test('原站若用 Infinity 代表不會枯萎，當作沒有值，不算彩帶花', () => {
  const neverWilts = { ...flower('f:White:Geranium', '白色天竺葵', NOW - 10 * MIN), wiltingMs: Infinity };
  assert.equal(ribbonEndMs(neverWilts, NOW), null);
});

test('原站若把時間欄位改成字串（後端原樣轉送不檢查型別），當作沒有值，不算彩帶花', () => {
  const inWindow = flower('f:White:Geranium', '白色天竺葵', NOW - 10 * MIN);
  const asString = (ms: number) => String(ms) as unknown as number;
  assert.equal(ribbonEndMs({ ...inWindow, bloomedMs: asString(inWindow.bloomedMs!) }, NOW), null);
  assert.equal(ribbonEndMs({ ...inWindow, wiltingMs: asString(inWindow.wiltingMs!) }, NOW), null);
});

// One of each case the 花的子篩選 must tell apart, keyed by a readable name.
const MIXED: Record<string, PipiItem> = {
  普花: flower('f:White:Common', '白色花朵'),
  非普花: flower('f:White:Geranium', '白色天竺葵'),
  彩帶普花: flower('f:Red:Common', '紅色花朵', NOW - 10 * MIN),
  彩帶非普花: flower('f:White:Cherryblossom', '白色櫻花', NOW - 10 * MIN),
  普花花苞: bud('f:Yellow:Common', '黃色花朵', 'Leaf'),
  非普花花苞: bud('f:White:Geranium', '白色天竺葵', 'Bud'),
  蘑菇: { ...base(), itemKind: 'mushroom', displayName: '蘑菇', finishMs: NOW + HOUR },
  煙霧: { ...base(), itemKind: 'smoke', displayName: '煙霧', smokeEndMs: NOW + HOUR },
};

const shown = (filter: PipiFlowerFilter) =>
  Object.keys(MIXED).filter((name) => passesFlowerFilter(MIXED[name], filter, NOW));

test('四種勾法各自顯示的花，蘑菇與煙霧每一種都顯示', () => {
  assert.deepEqual(shown({ ribbonOnly: false, showCommon: true }), [
    '普花', '非普花', '彩帶普花', '彩帶非普花', '普花花苞', '非普花花苞', '蘑菇', '煙霧',
  ]);
  assert.deepEqual(shown({ ribbonOnly: true, showCommon: true }), ['彩帶普花', '彩帶非普花', '蘑菇', '煙霧']);
  assert.deepEqual(shown({ ribbonOnly: true, showCommon: false }), ['彩帶非普花', '蘑菇', '煙霧']);
  assert.deepEqual(shown({ ribbonOnly: false, showCommon: false }), ['非普花', '彩帶非普花', '非普花花苞', '蘑菇', '煙霧']);
});

test('原站若讓花苞帶著盛開時間，勾只顯示彩帶時花苞仍被藏掉', () => {
  for (const state of BUD_STATES) {
    assert.equal(passesFlowerFilter(timedBud(state), { ribbonOnly: true, showCommon: true }, NOW), false, state);
  }
});

test('取消顯示普花時，四個普花花種的花苞也藏掉', () => {
  const hideCommon = { ribbonOnly: false, showCommon: false };
  for (const [key, name] of [
    ['f:White:Common', '白色花朵'],
    ['f:Red:Common', '紅色花朵'],
    ['f:Yellow:Common', '黃色花朵'],
    ['f:Blue:Common', '藍色花朵'],
  ]) {
    for (const state of ['Leaf', 'Bud']) {
      assert.equal(passesFlowerFilter(bud(key, name, state), hideCommon, NOW), false, `${key} ${state}`);
    }
  }
});
