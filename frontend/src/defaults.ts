// Mode speeds and the initial values used when the user has never picked a
// setting (see GLOSSARY.md: 模式速度, 初始值).
//
// Kept import-free and erasable-syntax-only so `node --test` can load it
// directly. backend/config.py MODE_SPEED_KMH and backend/static/phone.html
// repeat these numbers in other runtimes; tests/frontend/test_defaults.ts
// fails when they drift apart.

export type MoveModeKey = 'walking' | 'running' | 'driving';
export type PipiKindKey = 'mushroom' | 'flower' | 'smoke';

/** 模式速度 in km/h. `running` is the 腳踏車 mode (legacy name). */
export const MODE_SPEED_KMH: Readonly<Record<MoveModeKey, number>> = {
  walking: 10.8,
  running: 19.5,
  driving: 60,
};

export const INITIAL_MOVE_MODE: MoveModeKey = 'running';

export const INITIAL_PIPI_KINDS: Readonly<Record<PipiKindKey, boolean>> = {
  mushroom: true,
  flower: false,
  smoke: false,
};

/** 花的子篩選：只顯示彩帶花、顯示普花（GLOSSARY.md: 彩帶花、普花）。 */
export type PipiFlowerFilter = { ribbonOnly: boolean; showCommon: boolean };

export const INITIAL_PIPI_FLOWER_FILTER: Readonly<PipiFlowerFilter> = {
  ribbonOnly: false,
  showCommon: true,
};

/** Stored `locwarp.speed.mode` value → move mode; anything unrecognised gets the initial mode. */
export function resolveMoveMode(stored: string | null): MoveModeKey {
  return stored === 'walking' || stored === 'running' || stored === 'driving' ? stored : INITIAL_MOVE_MODE;
}

/**
 * Stored `locwarp.pipi_kinds` JSON → point-kind filter.
 *
 * @param storedJson raw localStorage value, or null when nothing was saved.
 * @returns a complete filter. Each kind keeps its saved boolean; a kind that
 *   is missing or not a boolean (or the whole value, when it isn't a JSON
 *   object) takes its INITIAL_PIPI_KINDS value.
 */
export function resolvePipiKinds(storedJson: string | null): Record<PipiKindKey, boolean> {
  let raw: unknown = null;
  try { raw = JSON.parse(storedJson ?? 'null'); } catch { /* malformed → initial values */ }
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<PipiKindKey, unknown>>;
  const pick = (k: PipiKindKey): boolean => {
    const v = saved[k];
    return typeof v === 'boolean' ? v : INITIAL_PIPI_KINDS[k];
  };
  return { mushroom: pick('mushroom'), flower: pick('flower'), smoke: pick('smoke') };
}

/**
 * Stored `locwarp.pipi_flower_filter` JSON → 花的子篩選.
 *
 * @param storedJson raw localStorage value, or null when nothing was saved.
 * @returns a complete filter. Each field keeps its saved boolean; a field that
 *   is missing or not a boolean (or the whole value, when it isn't a JSON
 *   object) takes its INITIAL_PIPI_FLOWER_FILTER value.
 */
export function resolvePipiFlowerFilter(storedJson: string | null): PipiFlowerFilter {
  let raw: unknown = null;
  try { raw = JSON.parse(storedJson ?? 'null'); } catch { /* malformed → initial values */ }
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof PipiFlowerFilter, unknown>>;
  const pick = (k: keyof PipiFlowerFilter): boolean => {
    const v = saved[k];
    return typeof v === 'boolean' ? v : INITIAL_PIPI_FLOWER_FILTER[k];
  };
  return { ribbonOnly: pick('ribbonOnly'), showCommon: pick('showCommon') };
}
