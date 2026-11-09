// 蘑菇地圖 flower rules (see GLOSSARY.md: 花種, 花苞, 普花, 彩帶花, 拿過精華):
// which items are 普花 / 彩帶花, which ones the 花的子篩選 lets through, how
// the popup writes the 彩帶期 countdown, and which flowers offer 撈水果 and
// 我拿過精華了.
//
// No runtime imports and erasable-syntax-only so `node --test` can load it
// directly; the type-only imports below are stripped whole by Node.
import type { PipiFlowerFilter } from './defaults';
import type { PipiEssenceTaken } from './pipiEssence';
import type { PipiItem } from './services/api';

// 普花 is decided by exact key, never by the `Common` variety or by name:
// a future f:Purple:Common is not 普花. Its 花苞 carry the same key.
const COMMON_FLOWER_KEYS: ReadonlySet<string> = new Set([
  'f:White:Common',
  'f:Red:Common',
  'f:Yellow:Common',
  'f:Blue:Common',
]);

const RIBBON_MS = 60 * 60_000;

// Same normalisation as the site (trim, drop spaces / underscores / hyphens,
// lowercase; removing every \s covers the trim), which labels all three 花苞.
const BUD_STATES: ReadonlySet<string> = new Set(['leaf', 'bud', 'preflower']);

function isBud(item: PipiItem): boolean {
  const state = typeof item.state === 'string' ? item.state : '';
  return BUD_STATES.has(state.replace(/[\s_-]/g, '').toLowerCase());
}

// The backend forwards the site's time fields without type checks, so a
// string (or anything but a positive finite number) counts as unset.
function isSetTime(v: unknown): v is number {
  return Number.isFinite(v) && (v as number) > 0;
}

/**
 * 彩帶花 check at a given server time.
 *
 * @param item a 蘑菇地圖 item of any kind.
 * @param nowMs server-clock time in ms (local clock + server offset).
 * @returns when the 彩帶期 ends (server ms) if the item is 彩帶花 at `nowMs`,
 *   otherwise null.
 */
export function ribbonEndMs(item: PipiItem, nowMs: number): number | null {
  if (item.itemKind !== 'flower' || isBud(item)) return null;
  const bloomed = item.bloomedMs;
  const wilting = item.wiltingMs;
  if (!isSetTime(bloomed) || !isSetTime(wilting)) return null;
  const ribbonEnd = bloomed + RIBBON_MS;
  if (nowMs < bloomed || nowMs >= wilting || nowMs >= ribbonEnd) return null;
  return Math.min(ribbonEnd, wilting);
}

/**
 * 彩帶期 countdown for the popup's ribbon line: m:ss, minutes unpadded,
 * seconds padded and rounded down. Never shows hours, so the full 彩帶期
 * (popup opened at the exact bloom ms) reads 60:00.
 *
 * @param ms time left in the 彩帶期: `ribbonEndMs(item, now) - now`.
 */
export function fmtRibbonCountdown(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Whether the popup offers 撈水果 for the item: only 彩帶花 bear 水果, so this
 * is exactly {@link ribbonEndMs}'s check, boundaries included, and agrees with
 * the popup's ribbon line. A flower without a set `wiltingMs` is not 彩帶花.
 *
 * @param item a 蘑菇地圖 item of any kind.
 * @param nowMs server-clock time in ms, as for {@link ribbonEndMs}.
 */
export function canCollectFruit(item: PipiItem, nowMs: number): boolean {
  return ribbonEndMs(item, nowMs) !== null;
}

/**
 * Whether the popup offers 我拿過精華了 / its cancel for the item (Q4): a
 * bloomed flower, not a 花苞, that has not wilted. Unlike 撈水果 it holds for
 * the whole bloom, past the 彩帶期. Here and not in pipiEssence.ts because it
 * needs the 花苞 rule, and neither module may import the other at runtime.
 *
 * The id and bloom time must be what PUT /api/pipi/essence accepts (a
 * non-blank string or a safe integer; a positive integer), so the button
 * doesn't show on a flower whose mark would be refused. The PUT's 128-character
 * cap on a string id isn't checked here: measured ids are 35.
 *
 * @param item a 蘑菇地圖 item of any kind.
 * @param nowMs server-clock time in ms, as for {@link ribbonEndMs}.
 */
export function canMarkEssence(item: PipiItem, nowMs: number): boolean {
  if (item.itemKind !== 'flower' || isBud(item)) return false;
  const id: unknown = item.id;
  if (typeof id === 'string' ? id.trim() === '' : !Number.isSafeInteger(id)) return false;
  const bloomed = item.bloomedMs;
  const wilting = item.wiltingMs;
  if (!Number.isInteger(bloomed) || (bloomed as number) <= 0 || !isSetTime(wilting)) return false;
  return (bloomed as number) <= nowMs && nowMs < wilting;
}

/** Whether the item is 普花 (including its 花苞). */
export function isCommonFlower(item: PipiItem): boolean {
  return COMMON_FLOWER_KEYS.has(item.key ?? '');
}

/**
 * Whether the 花的子篩選 lets the item through. A flower must pass all three
 * sub-filters, so a 拿過精華 彩帶花 stays hidden under 只顯示彩帶. Mushrooms
 * and smoke always pass, whatever `essenceTaken` says; the 點位種類 on/off
 * switches are applied elsewhere, not here.
 *
 * @param item a 蘑菇地圖 item of any kind.
 * @param filter the 花的子篩選.
 * @param nowMs server-clock time in ms, as for {@link ribbonEndMs}.
 * @param essenceTaken the item's 拿過精華 answer from pipiEssence.ts' `essenceTaken`.
 *   With 顯示拿過精華的花 unticked, `unknown` hides the flower like `taken`:
 *   until the list is read, flowers wait instead of flashing up and vanishing.
 */
export function passesFlowerFilter(item: PipiItem, filter: PipiFlowerFilter, nowMs: number, essenceTaken: PipiEssenceTaken): boolean {
  if (item.itemKind !== 'flower') return true;
  if (filter.ribbonOnly && ribbonEndMs(item, nowMs) === null) return false;
  if (!filter.showCommon && isCommonFlower(item)) return false;
  if (!filter.showEssenceTaken && essenceTaken !== 'notTaken') return false;
  return true;
}
