// Run from the repo root:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"
//
// Locks the 拿過精華 rules (GLOSSARY.md): the mark's identity, the 標記狀態
// with its 還沒讀到 value, replacing it from the list, updating it from a set
// answer, and whether a flower counts as 拿過精華. Data follows the list and items formats measured on
// 2026-11-09 (01 號票 Comments); tests that need data the site has not been
// seen sending say which upstream format change they guard against.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESSENCE_NOT_LOADED, essenceMarkId, essenceTaken, marksFromList, marksFromSet } from '../../frontend/src/pipiEssence.ts';
import type { PipiEssenceMark, PipiItem } from '../../frontend/src/services/api.ts';

const HOUR = 3_600_000;

// The flower the user marked on the site, as items and the list sent it.
const REAL_ID = '9c19ee876ae44a5f9a92b68d602cc1ea.16';
const REAL_BLOOM = 1794222404790;
const REAL_WILT = 1794305204790;
const REAL_MARK: PipiEssenceMark = { id: REAL_ID, bloomedMs: REAL_BLOOM, wiltingMs: REAL_WILT };
// Server time between that bloom and its wilting.
const NOW = REAL_BLOOM + HOUR;

const flower = (id: string, bloomedMs: number, wiltingMs = bloomedMs + 23 * HOUR): PipiItem => ({
  id, itemKind: 'flower', key: 'f:Yellow:Marigold', state: 'Flower', bloomedMs, wiltingMs, lat: 24.790423, lng: 120.988557,
});
const REAL_FLOWER = flower(REAL_ID, REAL_BLOOM, REAL_WILT);
const OTHER_FLOWER = flower('43d62c2a98e14dfe961d9fd83155c828.16', 1794201157167);

test('識別是 id、|、盛開時間（實測那朵花的 id 和盛開時間）', () => {
  assert.equal(essenceMarkId(REAL_ID, REAL_BLOOM), `${REAL_ID}|${REAL_BLOOM}`);
});

test('原站若把 id 改成數字：數字 id 和同值的字串 id 是同一個識別', () => {
  assert.equal(essenceMarkId(123456, REAL_BLOOM), essenceMarkId('123456', REAL_BLOOM));
  assert.notEqual(essenceMarkId(123456, REAL_BLOOM), null);
});

test('原站若讓 id 帶頭尾空白、盛開時間帶小數：空白去掉、小數捨去，跟原站一樣', () => {
  assert.equal(essenceMarkId(`  ${REAL_ID}\t`, REAL_BLOOM + 0.9), `${REAL_ID}|${REAL_BLOOM}`);
});

test('id 是空的，或盛開時間是 0、負數、字串、沒給時，沒有識別', () => {
  for (const id of ['', '   ', undefined, null]) assert.equal(essenceMarkId(id, REAL_BLOOM), null, String(id));
  for (const bloom of [0, -5, String(REAL_BLOOM), undefined, NaN, Infinity]) {
    assert.equal(essenceMarkId(REAL_ID, bloom), null, String(bloom));
  }
});

// An account that has never marked a flower must still get its flowers drawn:
// "讀到了、一朵都沒有" has to differ from 還沒讀到, or the layer waits forever.
test('還沒讀到時每一朵花都是還不知道；讀到了、一朵都沒有時是沒拿過', () => {
  for (const it of [REAL_FLOWER, OTHER_FLOWER, flower('bud', 0, 0)]) {
    assert.equal(essenceTaken(it, ESSENCE_NOT_LOADED, NOW), 'unknown', it.id);
    assert.equal(essenceTaken(it, marksFromList([], ESSENCE_NOT_LOADED), NOW), 'notTaken', it.id);
  }
});

test('實測那朵花在清單裡就算拿過精華，旁邊沒標的花沒拿過', () => {
  const marks = marksFromList([REAL_MARK], ESSENCE_NOT_LOADED);
  assert.equal(essenceTaken(REAL_FLOWER, marks, NOW), 'taken');
  assert.equal(essenceTaken(OTHER_FLOWER, marks, NOW), 'notTaken');
});

test('原站若把 items 的 id 改成數字：清單的字串 id 照樣對得上', () => {
  const marks = marksFromList([{ id: '123456', bloomedMs: REAL_BLOOM, wiltingMs: REAL_WILT }], ESSENCE_NOT_LOADED);
  const numericId = { ...REAL_FLOWER, id: 123456 as unknown as string };
  assert.equal(essenceTaken(numericId, marks, NOW), 'taken');
});

test('失效時間大於現在算拿過，剛好等於現在就不算', () => {
  const marks = marksFromList([REAL_MARK], ESSENCE_NOT_LOADED);
  assert.equal(essenceTaken(REAL_FLOWER, marks, REAL_WILT - 1), 'taken');
  assert.equal(essenceTaken(REAL_FLOWER, marks, REAL_WILT), 'notTaken');
});

test('過期只依傳入的伺服器時間判斷，不看本機時鐘', () => {
  // Both far from the real clock: one before the bloom's wilting, one after.
  const early = Date.UTC(2001, 0, 1);
  const late = Date.UTC(2100, 0, 1);
  const marks = marksFromList([{ id: 'x', bloomedMs: early - HOUR, wiltingMs: early + HOUR }], ESSENCE_NOT_LOADED);
  assert.equal(essenceTaken(flower('x', early - HOUR), marks, early), 'taken');
  assert.equal(essenceTaken(flower('x', early - HOUR), marks, late), 'notTaken');
});

test('原站若讓清單的失效時間是 0（後端把沒有值、不合格的都填 0）：不算拿過', () => {
  const marks = marksFromList([{ ...REAL_MARK, wiltingMs: 0 }], ESSENCE_NOT_LOADED);
  assert.equal(essenceTaken(REAL_FLOWER, marks, NOW), 'notTaken');
});

test('同一個花點枯萎後重新開花：同一個 id、不同的盛開時間，不算拿過', () => {
  const marks = marksFromList([REAL_MARK], ESSENCE_NOT_LOADED);
  const rebloomed = flower(REAL_ID, REAL_WILT + 2 * HOUR);
  assert.equal(essenceTaken(rebloomed, marks, REAL_WILT + 3 * HOUR), 'notTaken');
});

test('沒有識別的點位（花苞的盛開時間是 0、沒有 id）讀到清單後永遠不算拿過', () => {
  const marks = marksFromList([REAL_MARK], ESSENCE_NOT_LOADED);
  assert.equal(essenceTaken({ ...REAL_FLOWER, state: 'Bud', bloomedMs: 0, wiltingMs: 0 }, marks, NOW), 'notTaken');
  assert.equal(essenceTaken({ ...REAL_FLOWER, id: '' }, marks, NOW), 'notTaken');
});

test('清單整份取代：舊狀態有、新清單沒有的標記會消失（原站已經取消的標記）', () => {
  const before = marksFromList([REAL_MARK], ESSENCE_NOT_LOADED);
  const after = marksFromList([{ id: OTHER_FLOWER.id, bloomedMs: OTHER_FLOWER.bloomedMs!, wiltingMs: OTHER_FLOWER.wiltingMs! }], before);
  assert.equal(essenceTaken(REAL_FLOWER, after, NOW), 'notTaken');
  assert.equal(essenceTaken(OTHER_FLOWER, after, NOW), 'taken');
});

// The layer rebuilds every marker whenever the 標記狀態 object changes, which
// closes and reopens the open popup; an unchanged list must not cause that.
test('新清單的內容跟舊狀態一樣時，回傳原本那個狀態物件', () => {
  const before = marksFromList([REAL_MARK], ESSENCE_NOT_LOADED);
  assert.equal(marksFromList([{ ...REAL_MARK }], before), before);
  const empty = marksFromList([], ESSENCE_NOT_LOADED);
  assert.equal(marksFromList([], empty), empty);
});

test('新清單的內容跟舊狀態不一樣時回傳新的狀態：多一筆、少一筆、失效時間不同都算', () => {
  const before = marksFromList([REAL_MARK], ESSENCE_NOT_LOADED);
  const other: PipiEssenceMark = { id: 'o', bloomedMs: REAL_BLOOM, wiltingMs: REAL_WILT };
  for (const list of [[REAL_MARK, other], [], [other], [{ ...REAL_MARK, wiltingMs: REAL_WILT + 1 }]]) {
    assert.notEqual(marksFromList(list, before), before, JSON.stringify(list));
  }
});

test('舊狀態是還沒讀到時，一律回傳新的狀態，空清單也是（不能停在還沒讀到）', () => {
  assert.notEqual(marksFromList([], ESSENCE_NOT_LOADED), ESSENCE_NOT_LOADED);
  assert.notEqual(marksFromList([REAL_MARK], ESSENCE_NOT_LOADED), ESSENCE_NOT_LOADED);
});

test('用清單建立狀態不改動舊的狀態物件', () => {
  const before = marksFromList([REAL_MARK], ESSENCE_NOT_LOADED);
  marksFromList([], before);
  assert.equal(essenceTaken(REAL_FLOWER, before, NOW), 'taken');
});

// ── 設定回覆 (PUT /api/pipi/essence answers {wiltingMs}) ─────────────────

test('標記時用設定回覆的失效時間，不是那朵花的枯萎時間', () => {
  const before = marksFromList([], ESSENCE_NOT_LOADED);
  const replyWilt = REAL_WILT - 2 * HOUR;
  const after = marksFromSet(before, REAL_FLOWER, true, replyWilt);
  assert.equal(essenceTaken(REAL_FLOWER, after, replyWilt - 1), 'taken');
  assert.equal(essenceTaken(REAL_FLOWER, after, replyWilt), 'notTaken');
});

test('原站的設定回覆沒有失效時間（後端填 0）時，改用那朵花的 wiltingMs，跟原站一樣', () => {
  const after = marksFromSet(marksFromList([], ESSENCE_NOT_LOADED), REAL_FLOWER, true, 0);
  assert.equal(essenceTaken(REAL_FLOWER, after, REAL_WILT - 1), 'taken');
  assert.equal(essenceTaken(REAL_FLOWER, after, REAL_WILT), 'notTaken');
});

test('取消時刪掉這朵花的識別，其他標記留著', () => {
  const otherMark: PipiEssenceMark = { id: OTHER_FLOWER.id, bloomedMs: OTHER_FLOWER.bloomedMs!, wiltingMs: OTHER_FLOWER.wiltingMs! };
  const before = marksFromList([REAL_MARK, otherMark], ESSENCE_NOT_LOADED);
  const after = marksFromSet(before, REAL_FLOWER, false, 0);
  assert.equal(essenceTaken(REAL_FLOWER, after, NOW), 'notTaken');
  assert.equal(essenceTaken(OTHER_FLOWER, after, NOW), 'taken');
});

// The layer rebuilds from the new state; the old one may still be drawn.
test('用設定回覆更新狀態不改動舊的狀態物件，標記和取消都是', () => {
  const before = marksFromList([REAL_MARK], ESSENCE_NOT_LOADED);
  marksFromSet(before, OTHER_FLOWER, true, OTHER_FLOWER.wiltingMs!);
  marksFromSet(before, REAL_FLOWER, false, 0);
  assert.equal(essenceTaken(REAL_FLOWER, before, NOW), 'taken');
  assert.equal(essenceTaken(OTHER_FLOWER, before, NOW), 'notTaken');
});

// A mark can be set while the layer is off (自動標記). Turning one reply into
// a loaded state would read as "only this flower is marked" when the layer
// opens, and every other 拿過精華 flower would flash up.
test('套在還沒讀到的狀態上，結果仍然是還沒讀到', () => {
  assert.equal(marksFromSet(ESSENCE_NOT_LOADED, REAL_FLOWER, true, REAL_WILT), ESSENCE_NOT_LOADED);
  assert.equal(marksFromSet(ESSENCE_NOT_LOADED, REAL_FLOWER, false, 0), ESSENCE_NOT_LOADED);
});

test('數字 id 的花標記之後，清單裡同值的字串 id 也算同一朵', () => {
  const numericId = { ...REAL_FLOWER, id: 123456 as unknown as string };
  const after = marksFromSet(marksFromList([], ESSENCE_NOT_LOADED), numericId, true, REAL_WILT);
  assert.equal(essenceTaken({ ...REAL_FLOWER, id: '123456' }, after, NOW), 'taken');
});

test('沒有識別的點位（盛開時間是 0）設定回覆不改變狀態', () => {
  const before = marksFromList([REAL_MARK], ESSENCE_NOT_LOADED);
  assert.equal(marksFromSet(before, { ...REAL_FLOWER, bloomedMs: 0 }, true, REAL_WILT), before);
});
