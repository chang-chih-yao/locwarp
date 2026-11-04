import React, { useState } from 'react';
import { describePipiError } from '../services/api';
import type { PipiCookieResult, PipiKind, PipiStatusResponse } from '../services/api';
import { PIPI_MIN_ZOOM } from '../hooks/usePipiMushroomLayer';
import type { PipiKinds, PipiLayerStatus } from '../hooks/usePipiMushroomLayer';

interface Props {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  kinds: PipiKinds;
  onKindsChange: (k: PipiKinds) => void;
  status: PipiLayerStatus;
  configured: boolean | null;
  cookieInfo: Pick<PipiStatusResponse, 'source' | 'updated_at'>;
  onRefresh: () => void;
  onSaveCookie: (cookie: string) => Promise<PipiCookieResult>;
  onClearCookie: () => Promise<void>;
  onClose: () => void;
  t: (key: any, vars?: Record<string, string | number>) => string;
}

const KIND_COLORS: Record<PipiKind, string> = {
  mushroom: '#ff9f43',
  flower: '#ff6fa8',
  smoke: '#9aa3b2',
};
const KIND_ORDER: PipiKind[] = ['mushroom', 'flower', 'smoke'];

function clock(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

const PipiMushroomPanel: React.FC<Props> = ({
  enabled, onEnabledChange, kinds, onKindsChange, status, configured, cookieInfo,
  onRefresh, onSaveCookie, onClearCookie, onClose, t,
}) => {
  const cookieBadge = !configured
    ? t('map.pipi_cookie_unset')
    : cookieInfo.updated_at
      ? t(cookieInfo.source === 'extension' ? 'map.pipi_cookie_via_extension' : 'map.pipi_cookie_via_manual',
        { time: clock(cookieInfo.updated_at) })
      : t('map.pipi_cookie_set');
  const [cookieInput, setCookieInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [cookieMsg, setCookieMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    const v = cookieInput.trim();
    if (!v || busy) return;
    setBusy(true);
    setCookieMsg(null);
    try {
      const r = await onSaveCookie(v);
      setCookieInput('');
      if (r.logged_in) setCookieMsg({ ok: true, text: t('map.pipi_cookie_ok') });
      else if (r.error === 'pipi_login_required') setCookieMsg({ ok: false, text: t('map.pipi_cookie_not_logged_in') });
      else setCookieMsg({ ok: false, text: describePipiError(r.error || 'pipi_unavailable') });
    } catch (e) {
      setCookieMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onClearCookie();
      setCookieMsg({ ok: true, text: t('map.pipi_cookie_cleared') });
    } catch (e) {
      setCookieMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  let statusText: string;
  let statusColor = '#9499ac';
  switch (status.phase) {
    case 'off': statusText = t('map.pipi_status_off'); break;
    case 'no_cookie': statusText = t('map.pipi_status_no_cookie'); statusColor = '#ffd54f'; break;
    case 'zoom': statusText = t('map.pipi_status_zoom', { zoom: PIPI_MIN_ZOOM, current: status.zoom }); statusColor = '#ffd54f'; break;
    case 'region': statusText = t('map.pipi_status_region'); break;
    case 'loading': statusText = t('map.pipi_status_loading'); break;
    case 'ok':
      statusText = t('map.pipi_status_ok', { count: status.shown, time: status.updatedAt ? clock(status.updatedAt) : '-' });
      statusColor = '#8fe3a8';
      break;
    default: statusText = status.error || 'error'; statusColor = '#ff8a8a';
  }

  const chip = (active: boolean, color: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5,
    background: active ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.03)',
    border: `1px solid ${active ? color : 'rgba(255,255,255,0.12)'}`,
    color: active ? '#fff' : '#7d8399',
    fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 12, cursor: 'pointer',
  });

  return (
    <div
      onContextMenu={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className="anim-fade-slide-up"
      style={{
        position: 'absolute', left: 56, top: 236, zIndex: 851, width: 292,
        background: 'rgba(26, 29, 39, 0.95)',
        backdropFilter: 'blur(14px) saturate(160%)',
        WebkitBackdropFilter: 'blur(14px) saturate(160%)',
        border: '1px solid rgba(255, 159, 67, 0.35)',
        borderRadius: 10, padding: '10px 12px',
        boxShadow: '0 12px 32px rgba(12, 18, 40, 0.55)',
        color: '#e8eaf0', fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 600 }}>{t('map.pipi_title')}</span>
        <button
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: '#9499ac', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}
          aria-label="close"
        >×</button>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 8 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} />
        {t('map.pipi_layer_on')}
      </label>

      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {KIND_ORDER.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onKindsChange({ ...kinds, [k]: !kinds[k] })}
            style={chip(kinds[k], KIND_COLORS[k])}
            aria-pressed={kinds[k]}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: kinds[k] ? KIND_COLORS[k] : '#4a4f63' }} />
            {t(`map.pipi_kind_${k}`)}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ flex: 1, fontSize: 11, color: statusColor, lineHeight: 1.45 }}>{statusText}</div>
        {enabled && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={status.phase === 'loading'}
            style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
              color: '#c7d0e4', fontSize: 11, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', flexShrink: 0,
            }}
          >{t('map.pipi_refresh')}</button>
        )}
      </div>
      {enabled && status.truncated && status.phase === 'ok' && (
        <div style={{
          marginTop: 6, padding: '5px 8px', background: 'rgba(255,193,7,0.12)',
          border: '1px solid rgba(255,193,7,0.45)', borderRadius: 4, fontSize: 11, color: '#ffd54f', lineHeight: 1.4,
        }}>{t('map.pipi_truncated')}</div>
      )}

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '10px 0 8px' }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 11 }}>{t('map.pipi_cookie_label')}</span>
        <span style={{
          fontSize: 10, padding: '1px 7px', borderRadius: 8,
          background: configured ? 'rgba(78,205,196,0.15)' : 'rgba(255,255,255,0.06)',
          color: configured ? '#4ecdc4' : '#9499ac',
        }}>{cookieBadge}</span>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="password"
          value={cookieInput}
          onChange={(e) => setCookieInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
          placeholder={t('map.pipi_cookie_placeholder')}
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: 1, minWidth: 0, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 4, color: '#e8eaf0', fontSize: 11, padding: '4px 6px',
          }}
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !cookieInput.trim()}
          className="btn btn-primary"
          style={{ padding: '4px 10px', fontSize: 11 }}
        >{t('generic.save')}</button>
        {configured && (
          <button
            type="button"
            onClick={() => void clear()}
            disabled={busy}
            className="btn btn-secondary"
            style={{ padding: '4px 8px', fontSize: 11 }}
          >{t('generic.clear')}</button>
        )}
      </div>
      {cookieMsg && (
        <div style={{ marginTop: 6, fontSize: 11, color: cookieMsg.ok ? '#8fe3a8' : '#ff8a8a', lineHeight: 1.4 }}>
          {cookieMsg.text}
        </div>
      )}
      <div style={{ marginTop: 6, fontSize: 10.5, color: '#9ac0ff', lineHeight: 1.5 }}>{t('map.pipi_cookie_ext_hint')}</div>
      <div style={{ marginTop: 4, fontSize: 10.5, color: '#7d8399', lineHeight: 1.5 }}>{t('map.pipi_cookie_help')}</div>
      <div style={{ marginTop: 6, fontSize: 10.5, color: '#6b7089' }}>{t('map.pipi_source')}</div>
    </div>
  );
};

export default PipiMushroomPanel;
