// /settings — iOS grouped list. Server settings need admin (PUT /api/settings);
// device preferences (overlays, refresh) are stored locally.

import { Activity, ChevronRight, Cctv, Gauge, House, Layers, Lock, Radius, RefreshCw, Timer } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { useLocation } from 'wouter';
import type { AppSettings, BackgroundMode, HealthResponse, PushConfigResponse } from '../../shared/types';
import { RADIUS_OPTIONS, type SettingsPatch } from '../../shared/settings';
import { ErrorBanner } from '../components/ErrorBanner';
import { NavBar } from '../components/NavBar';
import { SegmentedControl } from '../components/SegmentedControl';
import { Toggle } from '../components/Toggle';
import { useAdmin } from '../hooks/useAdmin';
import { useResource } from '../hooks/useResource';
import { geocodeHome, getHealth, getPushConfig, getSettings, putSettings, toApiError } from '../lib/api';
import { setPref, usePrefs, type AutoRefreshSeconds } from '../lib/prefs';
import { toast } from '../lib/toast';
import { AdminSection } from './settings/AdminSection';
import { NotificationsSection } from './settings/NotificationsSection';
import { SectionTitle } from './settings/SectionTitle';
import './settings/settings.css';

const RADIUS_SEGMENTS = RADIUS_OPTIONS.map((r) => ({ value: r, label: `${r} mi` }));
const REFRESH_SEGMENTS = [
  { value: 0, label: 'Manual' },
  { value: 30, label: '30 s' },
  { value: 60, label: '60 s' },
] as const;
const BACKGROUND_SEGMENTS = [
  { value: 'off', label: 'Off' },
  { value: 'when_alerts_on', label: 'With alerts' },
  { value: 'always', label: 'Always' },
] as const;
const BACKGROUND_HINT: Record<BackgroundMode, string> = {
  off: 'Cameras are only checked while the app is open. No background AI cost.',
  when_alerts_on: 'Every 2 min while alerts are on or the app was open in the last 15 min.',
  always: 'Every 2 min, around the clock. Uses the most AI credits.',
};
const CHECK_LABEL: Record<string, string> = {
  db: 'Database',
  catalog: 'Camera catalog',
  ai: 'Vehicle detection',
  admin: 'Admin',
  push: 'Push notifications',
};

function focusAdmin() {
  const input = document.getElementById('admin-token');
  input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  input?.focus({ preventScroll: true });
}

export function SettingsPage() {
  const [, navigate] = useLocation();
  const admin = useAdmin();
  const { isAdmin } = admin;
  const prefs = usePrefs();
  const settings = useResource<AppSettings>('settings', (signal) => getSettings(signal));
  const pushConfig = useResource<PushConfigResponse>('push-config', (signal) => getPushConfig(signal));
  const health = useResource<HealthResponse>('health', (signal) => getHealth(signal));
  const [confDraft, setConfDraft] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);

  const s = settings.data;
  const { mutate } = settings;

  /** Optimistic PUT with rollback. */
  const update = async (patch: SettingsPatch): Promise<boolean> => {
    const before = s;
    mutate((prev) => (prev ? { ...prev, ...patch } : prev));
    try {
      const saved = await putSettings(patch);
      mutate(() => saved);
      return true;
    } catch (err) {
      mutate(() => before);
      toast(toApiError(err).message, 'error');
      return false;
    }
  };

  const confidence = confDraft ?? (s ? Math.round(s.minConfidence * 100) : 60);
  const commitConfidence = () => {
    if (confDraft === null || !s) return;
    const value = confDraft / 100;
    if (Math.abs(value - s.minConfidence) > 0.001) void update({ minConfidence: value }).then(() => setConfDraft(null));
    else setConfDraft(null);
  };

  const relocate = async () => {
    setLocating(true);
    try {
      const saved = await geocodeHome();
      mutate(() => saved);
      toast(`Home located (${saved.home.source})`);
    } catch (err) {
      toast(toApiError(err).message, 'error');
    } finally {
      setLocating(false);
    }
  };

  return (
    <div className="page settings-page">
      <NavBar title="Settings" />
      <h1 className="large-title">Settings</h1>

      {!isAdmin && (
        <div className="settings-banner">
          <div className="banner tone-blue">
            <Lock size={18} aria-hidden="true" />
            <div className="banner-body">
              Home, search, alerts and background checks need admin.{' '}
              <button type="button" className="btn-link" onClick={focusAdmin}>
                Unlock below
              </button>
            </div>
          </div>
        </div>
      )}

      {settings.error && !s && (
        <div className="settings-banner">
          <ErrorBanner title="Couldn't load settings" message={settings.error.message} onRetry={settings.reload} />
        </div>
      )}

      <section className="section" aria-labelledby="sec-home">
        <SectionTitle id="sec-home" locked={!isAdmin}>
          Home
        </SectionTitle>
        <div className="group">
          <div className="row has-icon">
            <span className="row-icon tone-blue" aria-hidden="true">
              <House size={17} />
            </span>
            <span className="row-label">
              {s ? s.home.address.split(',')[0] : '403 Audubon Ave'}
              <small className="tabular">{s ? `${s.home.lat.toFixed(5)}, ${s.home.lon.toFixed(5)} · ${s.home.source}` : 'Loading…'}</small>
            </span>
            <button type="button" className="btn-link" onClick={relocate} disabled={!isAdmin || locating || !s}>
              {locating ? 'Locating…' : 'Re-locate'}
            </button>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="sec-search">
        <SectionTitle id="sec-search" locked={!isAdmin}>
          Search
        </SectionTitle>
        <div className="group">
          <div className="row has-icon is-stacked">
            <div className="row-head">
              <span className="row-icon tone-orange" aria-hidden="true">
                <Radius size={17} />
              </span>
              <span className="row-label">Search radius</span>
            </div>
            <SegmentedControl
              label="Search radius"
              options={RADIUS_SEGMENTS}
              value={s?.radiusMi ?? null}
              disabled={!isAdmin || !s}
              onChange={(v) => void update({ radiusMi: v })}
            />
          </div>
          <div className="row has-icon is-stacked">
            <div className="row-head">
              <span className="row-icon tone-green" aria-hidden="true">
                <Gauge size={17} />
              </span>
              <label className="row-label" htmlFor="min-confidence">
                Minimum confidence
              </label>
              <span className="row-value tabular" aria-hidden="true">
                {confidence}%
              </span>
            </div>
            <input
              id="min-confidence"
              className="slider"
              type="range"
              min={10}
              max={95}
              step={5}
              value={confidence}
              disabled={!isAdmin || !s}
              style={{ '--fill': `${((confidence - 10) / 85) * 100}%` } as CSSProperties}
              onChange={(e) => setConfDraft(Number(e.target.value))}
              onPointerUp={commitConfidence}
              onKeyUp={commitConfidence}
              onBlur={commitConfidence}
            />
          </div>
        </div>
        <p className="group-footer">Spots below the minimum show as “possible” and never trigger alerts.</p>
      </section>

      <NotificationsSection settings={s} pushConfig={pushConfig.data} isAdmin={isAdmin} update={update} />

      <section className="section" aria-labelledby="sec-device">
        <h2 className="group-title" id="sec-device">
          This device
        </h2>
        <div className="group">
          <div className="row has-icon">
            <span className="row-icon tone-gray" aria-hidden="true">
              <Layers size={17} />
            </span>
            <span className="row-label">
              Debug overlays
              <small>Boxes, gaps and lanes on camera images</small>
            </span>
            <Toggle checked={prefs.debugOverlays} onChange={(v) => setPref('debugOverlays', v)} label="Debug overlays" />
          </div>
          <div className="row has-icon is-stacked">
            <div className="row-head">
              <span className="row-icon tone-blue" aria-hidden="true">
                <RefreshCw size={17} />
              </span>
              <span className="row-label">Refresh while open</span>
            </div>
            <SegmentedControl<AutoRefreshSeconds>
              label="Refresh while open"
              options={REFRESH_SEGMENTS}
              value={prefs.autoRefreshSeconds}
              onChange={(v) => setPref('autoRefreshSeconds', v)}
            />
          </div>
        </div>
        <p className="group-footer">Auto-refresh only runs while the app is on screen.</p>
      </section>

      <section className="section" aria-labelledby="sec-background">
        <SectionTitle id="sec-background" locked={!isAdmin}>
          Background checks
        </SectionTitle>
        <div className="group">
          <div className="row has-icon is-stacked">
            <div className="row-head">
              <span className="row-icon tone-purple" aria-hidden="true">
                <Timer size={17} />
              </span>
              <span className="row-label">Check cameras</span>
            </div>
            <SegmentedControl
              label="Background checks"
              options={BACKGROUND_SEGMENTS}
              value={s?.backgroundMode ?? null}
              disabled={!isAdmin || !s}
              onChange={(v) => void update({ backgroundMode: v })}
            />
          </div>
        </div>
        <p className="group-footer">{BACKGROUND_HINT[s?.backgroundMode ?? 'when_alerts_on']}</p>
      </section>

      <AdminSection isAdmin={isAdmin} unlock={admin.unlock} lock={admin.lock} />

      <section className="section" aria-labelledby="sec-more">
        <h2 className="group-title" id="sec-more">
          More
        </h2>
        <div className="group">
          <button type="button" className="row has-icon" onClick={() => navigate('/cameras')}>
            <span className="row-icon tone-blue" aria-hidden="true">
              <Cctv size={17} />
            </span>
            <span className="row-label">Cameras</span>
            <ChevronRight size={18} className="row-chevron" aria-hidden="true" />
          </button>
          {isAdmin && (
            <div className="row has-icon is-stacked">
              <div className="row-head">
                <span className={`row-icon tone-${health.data ? (health.data.ok ? 'green' : 'red') : 'gray'}`} aria-hidden="true">
                  <Activity size={17} />
                </span>
                <span className="row-label">System status</span>
                <span className="row-value">{health.data ? (health.data.ok ? 'OK' : 'Problem') : health.error ? 'Unavailable' : '…'}</span>
              </div>
              {health.data && (
                <ul className="health-list">
                  {Object.entries(health.data.checks).map(([key, check]) => (
                    <li key={key}>
                      <span className={`dot tone-${check.ok ? 'green' : 'red'}`} aria-hidden="true" />
                      <span className="health-name">{CHECK_LABEL[key] ?? key}</span>
                      <span className="health-detail">{check.ok ? (check.detail ?? 'OK') : (check.detail ?? 'Not working')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </section>

      <footer className="settings-footer">
        <p>
          Detections are estimates from public NYC DOT traffic cameras. ParkNearMe never guarantees legal parking. Camera imagery © NYC DOT.
        </p>
        <p className="tabular">ParkNearMe {health.data ? `v${health.data.version}` : ''}</p>
      </footer>
    </div>
  );
}
