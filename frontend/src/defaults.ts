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

/** 花的子篩選：只顯示彩帶花、顯示普花、顯示拿過精華的花（GLOSSARY.md: 彩帶花、普花、拿過精華）。 */
export type PipiFlowerFilter = { ribbonOnly: boolean; showCommon: boolean; showEssenceTaken: boolean };

export const INITIAL_PIPI_FLOWER_FILTER: Readonly<PipiFlowerFilter> = {
  ribbonOnly: false,
  showCommon: true,
  showEssenceTaken: false,
};

/** 標記大小（GLOSSARY.md）：小、中、大三級。 */
export type PipiMarkerSize = 'small' | 'medium' | 'large';

export const INITIAL_PIPI_MARKER_SIZE: PipiMarkerSize = 'medium';

/** Stored `locwarp.speed.mode` value → move mode; anything unrecognised gets the initial mode. */
export function resolveMoveMode(stored: string | null): MoveModeKey {
  return stored === 'walking' || stored === 'running' || stored === 'driving' ? stored : INITIAL_MOVE_MODE;
}

/**
 * Stored JSON object of boolean switches → a complete set of switches.
 *
 * @param storedJson raw localStorage value, or null when nothing was saved.
 * @param initial the 初始值 of every switch; its keys are the ones returned.
 * @returns a new object. Each key keeps its saved boolean; a key that is
 *   missing or not a boolean (or every key, when the value isn't a JSON
 *   object) takes its `initial` value.
 */
function resolveSwitches<K extends string>(storedJson: string | null, initial: { readonly [P in K]: boolean }): Record<K, boolean> {
  let raw: unknown = null;
  try { raw = JSON.parse(storedJson ?? 'null'); } catch { /* malformed → initial values */ }
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<K, unknown>>;
  const out = {} as Record<K, boolean>;
  for (const k of Object.keys(initial) as K[]) {
    const v = saved[k];
    out[k] = typeof v === 'boolean' ? v : initial[k];
  }
  return out;
}

/** Stored `locwarp.pipi_kinds` JSON → point-kind filter, as {@link resolveSwitches} with INITIAL_PIPI_KINDS. */
export function resolvePipiKinds(storedJson: string | null): Record<PipiKindKey, boolean> {
  return resolveSwitches(storedJson, INITIAL_PIPI_KINDS);
}

/** Stored `locwarp.pipi_flower_filter` JSON → 花的子篩選, as {@link resolveSwitches} with INITIAL_PIPI_FLOWER_FILTER. */
export function resolvePipiFlowerFilter(storedJson: string | null): PipiFlowerFilter {
  return resolveSwitches(storedJson, INITIAL_PIPI_FLOWER_FILTER);
}

/** Stored `locwarp.pipi_marker_size` value → 標記大小; anything unrecognised gets the initial size. */
export function resolvePipiMarkerSize(stored: string | null): PipiMarkerSize {
  return stored === 'small' || stored === 'medium' || stored === 'large' ? stored : INITIAL_PIPI_MARKER_SIZE;
}
