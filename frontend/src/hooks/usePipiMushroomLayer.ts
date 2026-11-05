import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  PipiApiError,
  pipiClearCookie,
  pipiItems,
  pipiSetCookie,
  pipiStatus,
} from '../services/api';
import type { PipiCookieResult, PipiItem, PipiItemsResponse, PipiKind, PipiStatusResponse } from '../services/api';
import type { PipiFlowerFilter } from '../defaults';
import { fmtRibbonCountdown, passesFlowerFilter, ribbonEndMs } from '../pipiFlowers';

// Pipi Mushroom 蘑菇地圖 overlay: fetches player-reported mushrooms / flowers
// for the viewport from the backend proxy and paints them as Leaflet markers.
//
// Request budget (the data comes from someone else's site):
//   * nothing below zoom 14 (the site itself only shows county clusters there)
//   * one request per settled pan (debounced), skipped while the view is still
//     inside the last fetched, padded bbox and that data is < 60 s old
//   * one forced refresh per minute while the window is visible
//   * stop entirely on missing / expired cookie; back off on 429
// The backend adds its own 1 req/s spacing and a 30 s cache on top.

export const PIPI_MIN_ZOOM = 14;
const MOVE_DEBOUNCE_MS = 700;
const REFRESH_MS = 60_000;
const PRUNE_MS = 30_000;
// Local-only poll of /api/pipi/status so a cookie pushed by the Chrome
// extension (extensions/pipi-cookie-sync) is picked up without a click.
const STATUS_POLL_MS = 15_000;
const BBOX_PAD = 0.25;
const MAX_MARKERS = 1500;
const STOP_CODES = new Set(['pipi_no_cookie', 'pipi_login_required', 'pipi_cookie_invalid']);
const ASSET_PREFIX = 'https://pipimushroom.com/';

export type PipiPhase = 'off' | 'no_cookie' | 'zoom' | 'region' | 'loading' | 'ok' | 'error';
export interface PipiLayerStatus {
  phase: PipiPhase;
  shown: number;
  truncated: boolean;
  updatedAt: number | null;
  error: string | null;
  zoom: number;
}
export type PipiKinds = Record<PipiKind, boolean>;

type TFn = (key: any, vars?: Record<string, string | number>) => string;

interface Options {
  mapRef: React.MutableRefObject<L.Map | null>;
  enabled: boolean;
  kinds: PipiKinds;
  flowerFilter: PipiFlowerFilter;
  onTeleport: (lat: number, lng: number) => void;
  onNavigate: (lat: number, lng: number) => void;
  t: TFn;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
}

function fmtClock(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function kindOf(it: PipiItem): PipiKind {
  return it.itemKind === 'flower' || it.itemKind === 'smoke' ? it.itemKind : 'mushroom';
}

// When the marker should disappear (server clock).
function endMs(it: PipiItem, kind: PipiKind): number | undefined {
  if (kind === 'flower') return it.wiltingMs;
  if (kind === 'smoke') return it.smokeEndMs ?? it.finishMs;
  return it.finishMs;
}

function safeImage(it: PipiItem): string | null {
  return it.image && it.image.startsWith(ASSET_PREFIX) ? it.image : null;
}

function itemName(it: PipiItem): string {
  const name = it.displayName || it.key || '?';
  return it.sizeName && it.itemKind !== 'flower' ? `${name} · ${it.sizeName}` : name;
}

function popupHtml(it: PipiItem, kind: PipiKind, offset: number, t: TFn): string {
  const img = safeImage(it);
  const end = endMs(it, kind);
  const now = Date.now() + offset;
  // Re-checked at open time, not taken from the layer build: the 彩帶期 may
  // have ended since, and then the line is left out instead of going negative.
  const ribbonEnd = ribbonEndMs(it, now);
  const ribbonLine = ribbonEnd === null ? '' : t('map.pipi_ribbon_ends_in', { time: fmtRibbonCountdown(ribbonEnd - now) });
  let timeLine = '';
  if (end && end > now) {
    timeLine = t('map.pipi_remaining', { time: fmtDuration(end - now) });
    // Local clock time of server-side `end`.
    if (kind === 'flower') timeLine += ` · ${t('map.pipi_wilts_at', { time: fmtClock(end - offset) })}`;
  }
  return `<div class="map-popup pipi-popup-body">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      ${img ? `<img src="${escapeHtml(img)}" alt="" style="width:36px;height:36px;object-fit:contain;flex-shrink:0;" />` : ''}
      <div style="min-width:0;">
        <div class="map-popup-title" style="margin-bottom:2px;">${escapeHtml(itemName(it))}</div>
        ${it.title ? `<div style="font-size:11px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px;">${escapeHtml(it.title)}</div>` : ''}
      </div>
    </div>
    ${ribbonLine ? `<div style="font-size:11px;color:var(--accent-pink);margin-bottom:2px;">${escapeHtml(ribbonLine)}</div>` : ''}
    ${timeLine ? `<div style="font-size:11px;color:var(--accent-yellow);margin-bottom:4px;">${escapeHtml(timeLine)}</div>` : ''}
    <div class="map-popup-coords">${it.lat.toFixed(6)}, ${it.lng.toFixed(6)}</div>
    <div class="map-popup-actions">
      <button type="button" class="btn btn-primary" style="padding:5px 10px;" data-pipi-act="teleport">${escapeHtml(t('map.teleport_here'))}</button>
      <button type="button" class="btn btn-secondary" style="padding:5px 10px;" data-pipi-act="navigate">${escapeHtml(t('map.navigate_here'))}</button>
    </div>
  </div>`;
}

export function usePipiMushroomLayer({ mapRef, enabled, kinds, flowerFilter, onTeleport, onNavigate, t }: Options) {
  // null = unknown (backend not reachable yet); we still try to load.
  const [configured, setConfigured] = useState<boolean | null>(null);
  // offset: server clock - local clock. lngShift: multiple of 360 that moves
  // the (wrapped, -180..180) results onto the world copy currently on screen.
  const [data, setData] = useState<{ res: PipiItemsResponse; offset: number; lngShift: number } | null>(null);
  const [status, setStatus] = useState<PipiLayerStatus>({
    phase: 'off', shown: 0, truncated: false, updatedAt: null, error: null, zoom: 0,
  });
  const [reloadToken, setReloadToken] = useState(0);

  const tRef = useRef(t);
  tRef.current = t;
  const onTeleportRef = useRef(onTeleport);
  onTeleportRef.current = onTeleport;
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  // Id of the item whose popup is open, so a data refresh can reopen it.
  const openIdRef = useRef<string | null>(null);
  const reopenIdRef = useRef<string | null>(null);

  const [cookieInfo, setCookieInfo] = useState<Pick<PipiStatusResponse, 'source' | 'updated_at'>>({
    source: null, updated_at: null,
  });
  // updated_at of the cookie the fetch loop is currently using; undefined
  // until the first status answer.
  const cookieStampRef = useRef<number | null | undefined>(undefined);

  const applyStatus = useCallback((r: PipiStatusResponse) => {
    setConfigured(r.configured);
    setCookieInfo({ source: r.source, updated_at: r.updated_at });
    const prev = cookieStampRef.current;
    cookieStampRef.current = r.updated_at;
    // A different cookie arrived (extension push / another window): restart
    // the fetch loop, which also clears a "login required" stop.
    if (prev !== undefined && r.configured && r.updated_at !== prev) setReloadToken((x) => x + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    const check = () => {
      if (document.hidden) return;
      pipiStatus().then((r) => { if (alive) applyStatus(r); }).catch(() => { /* backend down */ });
    };
    check();
    const id = enabled ? window.setInterval(check, STATUS_POLL_MS) : undefined;
    return () => { alive = false; window.clearInterval(id); };
  }, [enabled, applyStatus]);

  // ── Fetch loop ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !enabled) {
      setData(null);
      setStatus((s) => ({ ...s, phase: 'off', shown: 0, truncated: false, error: null }));
      return;
    }
    if (configured === false) {
      setData(null);
      setStatus((s) => ({ ...s, phase: 'no_cookie', shown: 0, truncated: false, error: null }));
      return;
    }
    let disposed = false;
    let stopped = false;
    let blockedUntil = 0;
    let last: { bounds: L.LatLngBounds; at: number; zoom: number; truncated: boolean } | null = null;
    let ctrl: AbortController | null = null;
    let debounce: number | undefined;

    const load = async (force: boolean) => {
      if (disposed || stopped || document.hidden) return;
      const zoom = Math.round(map.getZoom());
      if (zoom < PIPI_MIN_ZOOM) {
        ctrl?.abort();
        last = null;
        setData(null);
        setStatus((s) => ({ ...s, phase: 'zoom', shown: 0, truncated: false, error: null, zoom }));
        return;
      }
      if (Date.now() < blockedUntil) return;
      const view = map.getBounds();
      if (
        !force && last && last.bounds.contains(view) && Date.now() - last.at < REFRESH_MS
        && (!last.truncated || last.zoom === zoom)
      ) return;
      const padded = view.pad(BBOX_PAD);
      // Leaflet doesn't wrap longitude when the user pans across the
      // antimeridian; query the -180..180 equivalent and shift results back.
      const wrapped = map.wrapLatLngBounds(padded);
      const lngShift = padded.getCenter().lng - wrapped.getCenter().lng;
      ctrl?.abort();
      const c = new AbortController();
      ctrl = c;
      setStatus((s) => ({ ...s, phase: 'loading', zoom }));
      try {
        const res = await pipiItems({
          north: Math.min(85, wrapped.getNorth()), south: Math.max(-85, wrapped.getSouth()),
          east: Math.min(180, wrapped.getEast()), west: Math.max(-180, wrapped.getWest()), zoom,
        }, c.signal);
        if (disposed || c.signal.aborted) return;
        last = { bounds: padded, at: Date.now(), zoom, truncated: res.truncated };
        setData({ res, offset: res.now_ms - Date.now(), lngShift });
        setStatus((s) => ({
          ...s, phase: res.region ? 'ok' : 'region', truncated: res.truncated,
          updatedAt: Date.now(), error: null, zoom,
        }));
      } catch (e) {
        if (disposed || c.signal.aborted || (e as Error)?.name === 'AbortError') return;
        const err = e instanceof PipiApiError ? e : null;
        if (err?.code === 'pipi_rate_limited') blockedUntil = Date.now() + (err.retryAfter ?? 60) * 1000;
        if (err && STOP_CODES.has(err.code)) {
          stopped = true;
          if (err.code === 'pipi_no_cookie') setConfigured(false);
        }
        setStatus((s) => ({ ...s, phase: 'error', error: (e as Error).message || String(e), zoom }));
      }
    };

    const onMove = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => { void load(false); }, MOVE_DEBOUNCE_MS);
    };
    const onVisibility = () => { if (!document.hidden) void load(false); };
    map.on('moveend', onMove);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => { void load(true); }, REFRESH_MS);
    void load(false);
    return () => {
      disposed = true;
      ctrl?.abort();
      window.clearTimeout(debounce);
      window.clearInterval(timer);
      map.off('moveend', onMove);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, configured, reloadToken, mapRef]);

  // ── Markers ───────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const reopenId = reopenIdRef.current;
    reopenIdRef.current = null;
    if (!map || !enabled || !data) {
      setStatus((s) => (s.shown ? { ...s, shown: 0 } : s));
      return;
    }
    const { res, offset, lngShift } = data;
    const now = Date.now() + offset;
    const layer = L.layerGroup();
    const icons = new Map<string, L.DivIcon>();
    const entries: Array<{ marker: L.Marker; end?: number }> = [];
    let reopen: L.Marker | null = null;

    // Only markers actually drawn count toward MAX_MARKERS, so items dropped
    // by the 花的子篩選 below don't use up the cap.
    for (const it of res.items) {
      if (entries.length >= MAX_MARKERS) break;
      const kind = kindOf(it);
      if (!kinds[kind]) continue;
      const end = endMs(it, kind);
      if (end && end <= now) continue;
      // Every kind goes through it; mushrooms / smoke always pass.
      if (!passesFlowerFilter(it, flowerFilter, now)) continue;
      // Decided per rebuild only; prune never re-checks it.
      const ribbon = ribbonEndMs(it, now) !== null;
      const img = safeImage(it);
      const iconKey = `${kind}|${ribbon ? 'ribbon' : ''}|${img ?? ''}`;
      let icon = icons.get(iconKey);
      if (!icon) {
        icon = L.divIcon({
          className: 'pipi-pin',
          html: `<div class="pipi-pin-inner pipi-${kind}${ribbon ? ' pipi-ribbon' : ''}">${img
            ? `<img src="${escapeHtml(img)}" alt="" draggable="false" />`
            : '<span class="pipi-pin-dot"></span>'}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
          popupAnchor: [0, -14],
          tooltipAnchor: [0, -14],
        });
        icons.set(iconKey, icon);
      }
      // zIndexOffset 0 keeps these under the user's position marker (1000)
      // and bookmark pins (2000).
      // Drawn on the visible world copy; teleport / navigate keep it.lng.
      const marker = L.marker([it.lat, it.lng + lngShift], { icon, keyboard: false, riseOnHover: true });
      marker.bindTooltip(escapeHtml(itemName(it)), { direction: 'top' });
      marker.bindPopup(() => popupHtml(it, kind, offset, tRef.current), { maxWidth: 280, minWidth: 200 });
      marker.on('popupopen', (e: L.PopupEvent) => {
        openIdRef.current = it.id;
        e.popup.getElement()?.querySelectorAll<HTMLButtonElement>('[data-pipi-act]').forEach((btn) => {
          btn.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            map.closePopup();
            const fn = btn.dataset.pipiAct === 'navigate' ? onNavigateRef.current : onTeleportRef.current;
            fn(it.lat, it.lng);
          };
        });
      });
      marker.on('popupclose', () => { if (openIdRef.current === it.id) openIdRef.current = null; });
      layer.addLayer(marker);
      entries.push({ marker, end });
      if (reopenId && it.id === reopenId) reopen = marker;
    }
    layer.addTo(map);
    setStatus((s) => ({ ...s, shown: entries.length }));
    if (reopen) (reopen as L.Marker).openPopup();

    // Drop markers as their timers run out, without rebuilding the layer
    // (a rebuild would close whatever popup the user has open).
    const prune = window.setInterval(() => {
      const n = Date.now() + offset;
      let removed = 0;
      for (const e of entries) {
        if (e.end && e.end <= n && layer.hasLayer(e.marker)) {
          layer.removeLayer(e.marker);
          removed++;
        }
      }
      if (removed) setStatus((s) => ({ ...s, shown: Math.max(0, s.shown - removed) }));
    }, PRUNE_MS);

    return () => {
      window.clearInterval(prune);
      reopenIdRef.current = openIdRef.current;
      layer.remove();
    };
  }, [
    data, enabled, kinds.mushroom, kinds.flower, kinds.smoke,
    flowerFilter.ribbonOnly, flowerFilter.showCommon, mapRef,
  ]);

  const refresh = useCallback(() => setReloadToken((x) => x + 1), []);

  const saveCookie = useCallback(async (cookie: string): Promise<PipiCookieResult> => {
    const r = await pipiSetCookie(cookie);
    // Adopt the new stamp without triggering applyStatus' own reload.
    cookieStampRef.current = undefined;
    await pipiStatus().then(applyStatus).catch(() => setConfigured(true));
    setReloadToken((x) => x + 1);
    return r;
  }, [applyStatus]);

  const clearCookie = useCallback(async () => {
    await pipiClearCookie();
    cookieStampRef.current = null;
    setConfigured(false);
    setCookieInfo({ source: null, updated_at: null });
  }, []);

  return { status, configured, cookieInfo, refresh, saveCookie, clearCookie };
}
