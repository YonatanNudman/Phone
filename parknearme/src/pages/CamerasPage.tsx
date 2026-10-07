// /cameras — discovery tool: every stored camera near home, nearest first,
// with live frames, a "useful for parking?" vote and quick analysis.

import { Lock, RefreshCw } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'wouter';
import type { CameraPreference, CameraSummary } from '../../shared/types';
import { ErrorBanner } from '../components/ErrorBanner';
import { NavBar } from '../components/NavBar';
import { Toggle } from '../components/Toggle';
import { useAdmin } from '../hooks/useAdmin';
import { useNow } from '../hooks/useNow';
import { usePageVisible } from '../hooks/usePageVisible';
import { useResource } from '../hooks/useResource';
import { getCameras, syncCameras, toApiError } from '../lib/api';
import { setPref, usePrefs } from '../lib/prefs';
import { toast } from '../lib/toast';
import { CameraCard } from './cameras/CameraCard';
import './cameras/cameras.css';

const RADII = [0.25, 0.5, 0.75, 1.0] as const;

export function CamerasPage() {
  const { isAdmin } = useAdmin();
  const { pauseImages } = usePrefs();
  const visible = usePageVisible();
  const now = useNow(1000);
  const list = useResource<CameraSummary[]>('cameras', (signal) => getCameras(signal));
  const [radius, setRadius] = useState<number>(0.5);
  const [syncing, setSyncing] = useState(false);

  const cameras = useMemo(
    () => (list.data ?? []).filter((c) => c.distanceMi <= radius + 1e-9).sort((a, b) => a.distanceMi - b.distanceMi),
    [list.data, radius],
  );
  const watchedCount = cameras.filter((c) => c.preference.usefulness === 'yes').length;

  const { mutate } = list;
  const onPreference = useCallback(
    (id: string, pref: CameraPreference) => mutate((prev) => prev?.map((c) => (c.id === id ? { ...c, preference: pref } : c))),
    [mutate],
  );

  const resync = async () => {
    setSyncing(true);
    try {
      const res = await syncCameras();
      toast(typeof res.count === 'number' ? `Catalog synced · ${res.count} cameras` : 'Catalog synced');
      list.reload();
    } catch (err) {
      toast(toApiError(err).message, 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="page cameras-page">
      <NavBar title="Cameras" />
      <h1 className="large-title">Cameras</h1>
      <p className="large-subtitle">Sorted by distance from 403 Audubon</p>

      <div className="cameras-toolbar">
        <div className="chip-row" role="group" aria-label="Distance from home">
          {RADII.map((r) => (
            <button key={r} type="button" className="chip" aria-pressed={radius === r} onClick={() => setRadius(r)}>
              {r === 1 ? '1 mi' : `${r} mi`}
            </button>
          ))}
        </div>
        <div className="cameras-tools">
          <label className="cameras-pause">
            <span>Pause images</span>
            <Toggle checked={pauseImages} onChange={(v) => setPref('pauseImages', v)} label="Pause images" />
          </label>
          <button type="button" className="btn btn-plain btn-sm" onClick={resync} disabled={!isAdmin || syncing}>
            {isAdmin ? (
              <RefreshCw size={16} className={syncing ? 'spin' : undefined} aria-hidden="true" />
            ) : (
              <Lock size={15} aria-hidden="true" />
            )}
            Resync catalog
          </button>
        </div>
      </div>

      {!isAdmin && (
        <div className="cameras-banner">
          <div className="banner tone-blue">
            <Lock size={18} aria-hidden="true" />
            <div className="banner-body">
              Marking cameras, notes and analysis need admin. <Link href="/settings">Unlock in Settings</Link>
            </div>
          </div>
        </div>
      )}

      {list.error && !list.data && (
        <div className="cameras-banner">
          <ErrorBanner title="Couldn't load cameras" message={list.error.message} onRetry={list.reload} />
        </div>
      )}

      {list.data && (
        <p className="cameras-count tabular">
          {cameras.length} {cameras.length === 1 ? 'camera' : 'cameras'} within {radius} mi · {watchedCount} watched
        </p>
      )}

      <div className="cameras-grid">
        {!list.data &&
          !list.error &&
          [0, 1, 2].map((i) => (
            <div key={i} className="ccard card" aria-hidden="true">
              <div className="skeleton" style={{ aspectRatio: '352 / 240', borderRadius: 0 }} />
              <div className="ccard-body">
                <div className="skeleton" style={{ width: '60%', height: 20 }} />
                <div className="skeleton" style={{ width: '40%', height: 14, marginTop: 8 }} />
              </div>
            </div>
          ))}
        {cameras.map((cam, i) => (
          <CameraCard
            key={cam.id}
            camera={cam}
            index={i}
            now={now}
            isAdmin={isAdmin}
            paused={pauseImages}
            pageVisible={visible}
            onPreference={onPreference}
          />
        ))}
      </div>
      {list.data && cameras.length === 0 && (
        <p className="cameras-empty">
          No cameras within {radius} mi. Try a wider distance{isAdmin ? ' or resync the catalog' : ''}.
        </p>
      )}
    </div>
  );
}
