// 蘑菇地圖 拿過精華 rules (GLOSSARY.md): the identity of a mark, the
// 標記狀態 and updating it from a list or a set answer, whether a flower
// counts as 拿過精華, and the set action with its 存檔中 list. Marks come only
// from the site (`FlowerEssenceData.ashx`): its list, read through
// GET /api/pipi/essence, and its answers to a set; LocWarp keeps none of its
// own. A site format change is fixed here.
//
// No runtime imports and erasable-syntax-only so `node --test` can load it
// directly; type-only imports are stripped whole by Node.
import type { PipiEssenceMark, PipiItem } from './services/api';

/**
 * The identity of a 拿過精華 mark: one bloom of one flower, so a flower that
 * wilts and blooms again is a different mark. Same rule as the site's
 * mfmap.min.js (checked 2026-11-09).
 *
 * @param id the item's `id` (list: `mapObjectId`). The backend forwards the
 *   site's value untyped, so a number is accepted and equals its string form.
 * @param bloomedMs the item's `bloomedMs` (list: `bloomedTimeMs`).
 * @returns `"<trimmed id>|<floored bloom ms>"`, or null when the id is empty
 *   or the bloom time is not a finite number > 0 (a string counts as unset).
 */
export function essenceMarkId(id: unknown, bloomedMs: unknown): string | null {
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  const trimmed = String(id).trim();
  if (!trimmed || typeof bloomedMs !== 'number' || !Number.isFinite(bloomedMs) || bloomedMs <= 0) return null;
  return `${trimmed}|${Math.floor(bloomedMs)}`;
}

/**
 * 標記狀態: mark identity → when the mark stops counting (server ms; the
 * flower's wilting time). `null` is 還沒讀到, kept apart from an empty map
 * (讀到了、一朵都沒有): otherwise an account that never marked anything would
 * wait forever for its flowers.
 */
export type PipiEssenceMarks = ReadonlyMap<string, number> | null;

export const ESSENCE_NOT_LOADED: PipiEssenceMarks = null;

/** Whether a point is 拿過精華; `unknown` only while the list is 還沒讀到. */
export type PipiEssenceTaken = 'taken' | 'notTaken' | 'unknown';

/**
 * 標記狀態 from a list answer. The list replaces the state whole, never
 * merged, so a mark cancelled on the site goes away on the next read.
 *
 * @param list the marks GET /api/pipi/essence returned.
 * @param prev the current 標記狀態.
 * @returns `prev` itself when it is loaded and holds exactly these marks, so
 *   the layer skips a full rebuild (which closes and reopens the popup) for an
 *   unchanged list; otherwise a new state. `prev` is never changed.
 */
export function marksFromList(list: readonly PipiEssenceMark[], prev: PipiEssenceMarks): ReadonlyMap<string, number> {
  const next = new Map<string, number>();
  for (const m of list) {
    const key = essenceMarkId(m.id, m.bloomedMs);
    if (key) next.set(key, m.wiltingMs);
  }
  if (prev && prev.size === next.size && [...next].every(([k, v]) => prev.get(k) === v)) return prev;
  return next;
}

/**
 * 標記狀態 after a set answer, applied locally the way the site's page does:
 * neither side reads the list again after a set.
 *
 * @param prev the current 標記狀態.
 * @param item the flower that was marked or cancelled.
 * @param collected true for a mark, false for a cancel.
 * @param wiltingMs the answer's `wiltingMs`; 0 (unset) falls back to the
 *   flower's own `wiltingMs`, like the site.
 * @returns a new state; `prev` itself when it is 還沒讀到 (one answer must not
 *   pass for a read list) or the flower has no identity. `prev` is never changed.
 */
export function marksFromSet(
  prev: PipiEssenceMarks,
  item: Pick<PipiItem, 'id' | 'bloomedMs' | 'wiltingMs'>,
  collected: boolean,
  wiltingMs: number,
): PipiEssenceMarks {
  const key = essenceMarkId(item.id, item.bloomedMs);
  if (prev === null || key === null) return prev;
  const next = new Map(prev);
  if (collected) next.set(key, wiltingMs > 0 ? wiltingMs : (item.wiltingMs ?? 0));
  else next.delete(key);
  return next;
}

/**
 * What the 拿過精華 set action did. `saving`: the same flower was still being
 * saved, so nothing was sent.
 */
export type PipiEssenceSetResult = { kind: 'ok' } | { kind: 'failed'; error: string } | { kind: 'saving' };

/** The 拿過精華 set action with its 存檔中 list; see {@link createEssenceSaver}. */
export interface PipiEssenceSaver {
  /**
   * Marks (`collected` true) or cancels the flower's 拿過精華 on the site.
   *
   * @param item the flower, as the caller got it; callers check
   *   canMarkEssence first. `id` and `bloomedMs` go out as they are.
   * @param collected true marks, false cancels.
   * @returns `ok` once the answer is applied; `failed` with the error text
   *   (nothing applied, no retry); or `saving` when the same mark is still
   *   being saved, and then nothing is sent.
   */
  setMark(item: Pick<PipiItem, 'id' | 'bloomedMs' | 'wiltingMs'>, collected: boolean): Promise<PipiEssenceSetResult>;
  /** Whether the flower's mark is being saved, for drawing its button disabled. */
  isSaving(item: Pick<PipiItem, 'id' | 'bloomedMs'>): boolean;
}

/**
 * The set action the popup button and 自動標記 share. It keeps a 存檔中 list
 * of mark identities, so a second call for a flower still being saved sends
 * nothing: disabling the button alone can't stop it, because a rebuild
 * mid-save reopens the popup with a fresh button. It never closes popups or
 * shows toasts; those are the caller's.
 *
 * @param send PUT /api/pipi/essence (`pipiSetEssence`); injected because this
 *   module may not import at runtime.
 * @param apply called once per successful answer with its `wiltingMs`, to
 *   update the 標記狀態 (`marksFromSet`).
 */
export function createEssenceSaver(
  send: (body: { id: string | number; bloomedMs: number; collected: boolean }) => Promise<{ wiltingMs: number }>,
  apply: (item: Pick<PipiItem, 'id' | 'bloomedMs' | 'wiltingMs'>, collected: boolean, wiltingMs: number) => void,
): PipiEssenceSaver {
  const saving = new Set<string>();
  return {
    async setMark(item, collected) {
      const key = essenceMarkId(item.id, item.bloomedMs);
      // Unreachable past canMarkEssence, which implies an identity.
      if (key === null) return { kind: 'failed', error: `no mark identity for ${String(item.id)}` };
      if (saving.has(key)) return { kind: 'saving' };
      saving.add(key);
      try {
        const r = await send({ id: item.id, bloomedMs: item.bloomedMs as number, collected });
        apply(item, collected, r.wiltingMs);
        return { kind: 'ok' };
      } catch (e) {
        return { kind: 'failed', error: (e as Error).message || String(e) };
      } finally {
        saving.delete(key);
      }
    },
    isSaving(item) {
      const key = essenceMarkId(item.id, item.bloomedMs);
      return key !== null && saving.has(key);
    },
  };
}

/**
 * Whether a point counts as 拿過精華 at a given server time.
 *
 * @param item the point; only `id` and `bloomedMs` are read, so callers need
 *   not check the 點位種類.
 * @param marks the 標記狀態.
 * @param nowMs server-clock time in ms (local clock + server offset). The site
 *   uses the local clock here; LocWarp deliberately doesn't.
 * @returns `unknown` while `marks` is 還沒讀到; `taken` when the point has an
 *   identity that is in `marks` with a time still ahead of `nowMs` (0 never
 *   is); otherwise `notTaken`.
 */
export function essenceTaken(item: Pick<PipiItem, 'id' | 'bloomedMs'>, marks: PipiEssenceMarks, nowMs: number): PipiEssenceTaken {
  if (marks === null) return 'unknown';
  const key = essenceMarkId(item.id, item.bloomedMs);
  const until = key === null ? undefined : marks.get(key);
  return until !== undefined && until > nowMs ? 'taken' : 'notTaken';
}
