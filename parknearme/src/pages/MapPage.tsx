// Main screen: full-bleed map, floating status pill + controls, and a bottom
// sheet with the parking answer (or a camera's details for /?camera=<id>).

import { List, LocateFixed, Settings } from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useSearchParams } from 'wouter';
import type { CameraDetail, ParkingStatus } from '../../shared/types';
import { FALLBACK_HOME } from '../../shared/settings';
import { BottomSheet, type Snap } from '../components/BottomSheet';
import { CameraSheet, CameraSheetHeader } from '../components/CameraSheet';
import { MapView, type MapInsets } from '../components/MapView';
import { ParkingPanel } from '../components/ParkingPanel';
import { StatusPill } from '../components/StatusPill';
import { useAdmin } from '../hooks/useAdmin';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useNow } from '../hooks/useNow';
import { useParking } from '../hooks/useParking';
import { useResource } from '../hooks/useResource';
import { getCamera } from '../lib/api';
import { cameraMarkerStatus, currentCandidates, maxDetectionAge } from '../lib/detection';
import { usePrefs } from '../lib/prefs';
import './map-page.css';

const WIDE_QUERY = '(min-width: 760px)';

export function MapPage() {
  const prefs = usePrefs();
  const { isAdmin } = useAdmin();
  const parking = useParking(prefs.autoRefreshSeconds);
  const now = useNow(1000);
  const [, navigate] = useLocation();
  const [params, setParams] = useSearchParams();
  const cameraId = params.get('camera');

  const [snap, setSnap] = useState<Snap>(cameraId ? 'full' : 'half');
  const [sheetVisible, setSheetVisible] = useState(0);
  const [topInset, setTopInset] = useState(84);
  const [selected, setSelected] = useState(0);
  const [recenter, setRecenter] = useState(0);

  // Opening/closing a camera (incl. browser back) picks a sensible sheet height.
  const [prevCamera, setPrevCamera] = useState(cameraId);
  if (prevCamera !== cameraId) {
    setPrevCamera(cameraId);
    setSnap(cameraId ? 'full' : 'half');
  }

  const topRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTopInset(el.getBoundingClientRect().bottom));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = parking.data;
  const home = data?.home ?? FALLBACK_HOME;
  const shown = useMemo(() => (data ? currentCandidates(data, now) : []), [data, now]);
  const shownCandidates = useMemo(() => shown.map((s) => s.candidate), [shown]);
  const watchedIds = useMemo(() => new Set(data?.watched.map((c) => c.id) ?? []), [data]);
  const maxAge = maxDetectionAge(data);
  // Camera status dots expire like everything else. Keyed on the resulting
  // statuses so the marker layer only rebuilds when one flips, not every second.
  const statusKey = JSON.stringify((data?.watched ?? []).map((c) => [c.id, cameraMarkerStatus(c, true, now, maxAge)]));
  const cameraStatus = useMemo(() => new Map(JSON.parse(statusKey) as [string, ParkingStatus | null][]), [statusKey]);
  const cameras = useMemo(() => {
    // Watched cameras outside `nearby` (shouldn't happen) still get a marker.
    const list = [...(data?.nearby ?? [])];
    for (const w of data?.watched ?? []) if (!list.some((c) => c.id === w.id)) list.push(w);
    return list;
  }, [data]);
  const selectedIndex = Math.min(selected, Math.max(0, shown.length - 1));
  const detail = useResource<CameraDetail>(cameraId, (signal) => getCamera(cameraId ?? '', signal));
  const parkingCamera = cameraId ? (cameras.find((c) => c.id === cameraId) ?? null) : null;

  const openCamera = useCallback((id: string) => setParams({ camera: id }), [setParams]);
  const closeCamera = useCallback(() => setParams({}, { replace: true }), [setParams]);
  const onCandidateTap = useCallback(
    (i: number) => {
      setSelected(i);
      if (cameraId) setParams({}, { replace: true });
      setSnap((s) => (s === 'peek' ? 'half' : s));
    },
    [cameraId, setParams],
  );

  const wide = useMediaQuery(WIDE_QUERY);
  const insets: MapInsets = useMemo(() => ({ top: topInset, bottom: wide ? 0 : sheetVisible }), [topInset, sheetVisible, wide]);

  // The server summary is computed at response time; once its spots age out on
  // this device (no refresh for a while), don't keep announcing them.
  const expired = !!data && (data.summary.state === 'available' || data.summary.state === 'possible') && shown.length === 0;
  const summaryState = data ? (expired ? 'unknown' : data.summary.state) : null;
  const headline = data
    ? expired
      ? 'Parking results expired'
      : data.summary.headline
    : parking.error
      ? "Can't reach ParkNearMe"
      : 'Checking parking…';
  const errorText = parking.error ? (data ? "Couldn't refresh — tap ↻ to retry" : parking.error.message) : null;

  return (
    <div className="map-page" style={{ '--sheet-visible': `${wide ? 0 : sheetVisible}px` } as CSSProperties}>
      <MapView
        home={home}
        radiusMi={data?.radiusMi ?? null}
        cameras={cameras}
        watchedIds={watchedIds}
        cameraStatus={cameraStatus}
        candidates={shownCandidates}
        selectedCameraId={cameraId}
        selectedCandidate={cameraId ? null : selectedIndex}
        onCameraTap={openCamera}
        onCandidateTap={onCandidateTap}
        insets={insets}
        recenterToken={recenter}
      />

      <div className="map-top" ref={topRef}>
        <StatusPill
          state={summaryState}
          headline={headline}
          updatedAt={data?.summary.updatedAt ?? null}
          working={parking.working}
          message={parking.message}
          errorText={errorText}
          failed={parking.failed}
          now={now}
          onRefresh={parking.refresh}
        />
      </div>

      <div className="map-controls">
        <div className="ctl-group glass">
          <button type="button" aria-label="Cameras" title="Cameras" onClick={() => navigate('/cameras')}>
            <List size={21} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Settings" title="Settings" onClick={() => navigate('/settings')}>
            <Settings size={21} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          className="ctl-single glass"
          aria-label="Center on home"
          title="Center on home"
          onClick={() => setRecenter((n) => n + 1)}
        >
          <LocateFixed size={21} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>

      <BottomSheet
        snap={snap}
        onSnapChange={setSnap}
        onVisibleHeightChange={setSheetVisible}
        label={cameraId ? 'Camera details' : 'Parking near home'}
        header={cameraId ? <CameraSheetHeader camera={detail.data ?? parkingCamera} home={home} onClose={closeCamera} /> : undefined}
      >
        {cameraId ? (
          <CameraSheet
            key={cameraId}
            cameraId={cameraId}
            detail={detail}
            summary={parkingCamera}
            now={now}
            maxAgeSeconds={maxAge}
            isAdmin={isAdmin}
            onDetection={parking.applyDetection}
          />
        ) : (
          <ParkingPanel
            data={data}
            error={parking.error}
            working={parking.working}
            now={now}
            shown={shown}
            selected={selectedIndex}
            onSelect={setSelected}
            onOpenCamera={openCamera}
            onRetry={parking.refresh}
          />
        )}
      </BottomSheet>
    </div>
  );
}
