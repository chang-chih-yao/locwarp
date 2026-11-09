// Run from the repo root:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"
//
// Locks how 蘑菇地圖 flowers are classified and filtered (GLOSSARY.md: 花種,
// 花苞, 普花, 彩帶花, 撈水果). Data follows the item format sampled from the items API
// on 2026-11-05; tests that need data the site has not been seen sending say
// which upstream format change they guard against.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canCollectFruit, fmtRibbonCountdown, isCommonFlower, passesFlowerFilter, ribbonEndMs } from '../../frontend/src/pipiFlowers.ts';
import type { PipiFlowerFilter } from '../../frontend/src/defaults.ts';
import type { PipiEssenceTaken } from '../../frontend/src/pipiEssence.ts';
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

// The four 普花 花種 as the spec lists them: key → displayName.
const COMMON_FLOWERS = [
  ['f:White:Common', '白色花朵'],
  ['f:Red:Common', '紅色花朵'],
  ['f:Yellow:Common', '黃色花朵'],
  ['f:Blue:Common', '藍色花朵'],
] as const;

test('普花是白色、紅色、黃色、藍色花朵這四個花種', () => {
  for (const [key, name] of COMMON_FLOWERS) {
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

test('剛好在盛開那一毫秒打開 popup，彩帶行顯示 60:00 而不是 1:00:00', () => {
  const justBloomed = flower('f:White:Geranium', '白色天竺葵', NOW);
  assert.equal(fmtRibbonCountdown(ribbonEndMs(justBloomed, NOW)! - NOW), '60:00');
});

test('彩帶行的倒數是分不補零、秒補零，不足一秒捨去，跟剩餘時間行一致', () => {
  assert.equal(fmtRibbonCountdown(5 * MIN + 3000), '5:03');
  assert.equal(fmtRibbonCountdown(5 * MIN + 3999), '5:03');
  assert.equal(fmtRibbonCountdown(59 * MIN + 59_000), '59:59');
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

// Every item gets the same 拿過精華 answer here; the caller works it out per
// item with pipiEssence.ts, which has its own tests.
const shown = (filter: PipiFlowerFilter, essence: PipiEssenceTaken) =>
  Object.keys(MIXED).filter((name) => passesFlowerFilter(MIXED[name], filter, NOW, essence));

const ALL = ['普花', '非普花', '彩帶普花', '彩帶非普花', '普花花苞', '非普花花苞', '蘑菇', '煙霧'];
const RIBBON = ['彩帶普花', '彩帶非普花', '蘑菇', '煙霧'];
const RIBBON_NO_COMMON = ['彩帶非普花', '蘑菇', '煙霧'];
const NO_COMMON = ['非普花', '彩帶非普花', '非普花花苞', '蘑菇', '煙霧'];
const NO_FLOWERS = ['蘑菇', '煙霧'];

// [只顯示彩帶, 顯示普花, 顯示拿過精華的花] → shown when the items are
// 拿過精華 / 沒拿過 / 還不知道. Unticking the third hides taken and unknown
// flowers alike (unknown = the list isn't read yet, so flowers wait for it).
const TRUTH_TABLE: Array<[boolean, boolean, boolean, string[], string[], string[]]> = [
  [false, true, false, NO_FLOWERS, ALL, NO_FLOWERS],
  [false, true, true, ALL, ALL, ALL],
  [true, true, false, NO_FLOWERS, RIBBON, NO_FLOWERS],
  [true, true, true, RIBBON, RIBBON, RIBBON],
  [true, false, false, NO_FLOWERS, RIBBON_NO_COMMON, NO_FLOWERS],
  [true, false, true, RIBBON_NO_COMMON, RIBBON_NO_COMMON, RIBBON_NO_COMMON],
  [false, false, false, NO_FLOWERS, NO_COMMON, NO_FLOWERS],
  [false, false, true, NO_COMMON, NO_COMMON, NO_COMMON],
];

test('三個子選項的八種勾法，在拿過、沒拿過、還不知道三種狀態下各自顯示的花，蘑菇與煙霧每一種都顯示', () => {
  for (const [ribbonOnly, showCommon, showEssenceTaken, taken, notTaken, unknown] of TRUTH_TABLE) {
    const filter = { ribbonOnly, showCommon, showEssenceTaken };
    const label = JSON.stringify(filter);
    assert.deepEqual(shown(filter, 'taken'), taken, `${label} 拿過`);
    assert.deepEqual(shown(filter, 'notTaken'), notTaken, `${label} 沒拿過`);
    assert.deepEqual(shown(filter, 'unknown'), unknown, `${label} 還不知道`);
  }
});

test('拿過精華的彩帶花在只顯示彩帶底下：沒勾顯示拿過精華的花就藏，勾了就顯示', () => {
  const ribbon = MIXED.彩帶非普花;
  assert.equal(passesFlowerFilter(ribbon, { ribbonOnly: true, showCommon: true, showEssenceTaken: false }, NOW, 'taken'), false);
  assert.equal(passesFlowerFilter(ribbon, { ribbonOnly: true, showCommon: true, showEssenceTaken: true }, NOW, 'taken'), true);
});

// Lets the layer hand every item to the filter while the list is 還沒讀到,
// with no kind check of its own: mushrooms and smoke must keep drawing.
test('蘑菇與煙霧就算傳入拿過或還不知道，沒勾顯示拿過精華的花也照樣顯示', () => {
  const filter = { ribbonOnly: true, showCommon: false, showEssenceTaken: false };
  for (const essence of ['taken', 'unknown'] as const) {
    assert.equal(passesFlowerFilter(MIXED.蘑菇, filter, NOW, essence), true, essence);
    assert.equal(passesFlowerFilter(MIXED.煙霧, filter, NOW, essence), true, essence);
  }
});

test('原站若讓花苞帶著盛開時間，勾只顯示彩帶時花苞仍被藏掉', () => {
  for (const state of BUD_STATES) {
    const filter = { ribbonOnly: true, showCommon: true, showEssenceTaken: true };
    assert.equal(passesFlowerFilter(timedBud(state), filter, NOW, 'notTaken'), false, state);
  }
});

test('取消顯示普花時，四個普花花種的花苞也藏掉', () => {
  const hideCommon = { ribbonOnly: false, showCommon: false, showEssenceTaken: true };
  for (const [key, name] of COMMON_FLOWERS) {
    for (const state of ['Leaf', 'Bud']) {
      assert.equal(passesFlowerFilter(bud(key, name, state), hideCommon, NOW, 'notTaken'), false, `${key} ${state}`);
    }
  }
});

// 撈水果 (GLOSSARY.md) is offered only for 彩帶花: only they bear 水果 (GLOSSARY.md).
// Same check and boundaries as the popup's ribbon line (pipi-fruit-approach 02).
test('彩帶花可以撈水果，盛開後剛好滿 60 分鐘就不行', () => {
  const f = flower('f:White:Geranium', '白色天竺葵', NOW - 10 * MIN);
  assert.equal(canCollectFruit(f, NOW), true);
  assert.equal(canCollectFruit(f, f.bloomedMs! + 60 * MIN - 1), true);
  assert.equal(canCollectFruit(f, f.bloomedMs! + 60 * MIN), false);
  // Still in bloom 5 h later, nowhere near wilting: the old "盛開 and not wilted" rule offered it.
  assert.equal(canCollectFruit(f, f.bloomedMs! + 5 * HOUR), false);
});

test('剛好在盛開那一刻就可以撈水果，還沒到盛開時間不行', () => {
  const f = flower('f:White:Geranium', '白色天竺葵', NOW);
  assert.equal(canCollectFruit(f, NOW), true);
  assert.equal(canCollectFruit(f, NOW - 1), false);
});

test('原站若讓花在盛開後一小時內就枯萎：到了枯萎時間就不能撈水果', () => {
  const early = { ...flower('f:White:Geranium', '白色天竺葵', NOW - 10 * MIN), wiltingMs: NOW + 20 * MIN };
  assert.equal(canCollectFruit(early, NOW + 20 * MIN - 1), true);
  assert.equal(canCollectFruit(early, NOW + 20 * MIN), false);
});

// Real 花苞 have both time fields at 0, which already fails the 彩帶花 rule;
// timedBud carries in-window times, so there only the 花苞 rule rejects.
test('花苞的三個階段（含 Pre-Flower 等寫法）都不能撈水果', () => {
  for (const state of BUD_STATES) {
    assert.equal(canCollectFruit(bud('f:White:Geranium', '白色天竺葵', state), NOW), false, `${state} 時間為 0`);
    assert.equal(canCollectFruit(timedBud(state), NOW), false, `${state} 帶盛開時間`);
  }
});

test('蘑菇與煙霧不能撈水果，就算原站讓它們帶著彩帶期內的盛開時間', () => {
  const times = { bloomedMs: NOW - 10 * MIN, wiltingMs: NOW + 23 * HOUR };
  assert.equal(canCollectFruit(MIXED.蘑菇, NOW), false);
  assert.equal(canCollectFruit(MIXED.煙霧, NOW), false);
  assert.equal(canCollectFruit({ ...MIXED.蘑菇, ...times }, NOW), false);
  assert.equal(canCollectFruit({ ...MIXED.煙霧, ...times }, NOW), false);
});

// Not seen in the sample: guards a bloomed flower whose wiltingMs arrives as
// 0, missing or a string. This is where the 彩帶花 rule differs from the old
// "盛開 and not wilted" rule (pipi-fruit-approach 01), which counted an unset
// wiltingMs as not wilted and so offered 撈水果.
test('原站若讓盛開的花沒有枯萎時間（0、沒給、字串），照彩帶花的規則不能撈水果', () => {
  const f = flower('f:White:Geranium', '白色天竺葵', NOW - 10 * MIN);
  for (const wiltingMs of [0, undefined, String(f.wiltingMs) as unknown as number]) {
    assert.equal(canCollectFruit({ ...f, wiltingMs }, NOW), false, String(wiltingMs));
  }
});
