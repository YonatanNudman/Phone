// Camera details inside the bottom sheet: live frame, latest analysis,
// actions, debug overlays and recent history.

import {
  CircleCheck,
  CircleQuestionMark,
  CircleSlash,
  Info,
  Layers,
  Navigation,
  PencilRuler,
  RefreshCw,
  SquareParking,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import type { CameraDetail, CameraSummary, Detection, DetectionHistoryItem } from '../../shared/types';
import { formatAge } from '../../shared/freshness';
import { formatMiles, haversineMiles, type LatLon } from '../../shared/geo';
import { STATUS_LABEL } from '../../shared/status';
import { useFrame } from '../hooks/useFrame';
import { usePageVisible } from '../hooks/usePageVisible';
import { useResource, type Resource } from '../hooks/useResource';
import { analyzeCamera, getHistory, toApiError } from '../lib/api';
import { historySummary, isCurrent } from '../lib/detection';
import { ageSeconds, cameraLabel, formatClock, formatClockSeconds, formatPercent, reasonText, STATUS_TONE } from '../lib/format';
import { directionsUrl } from '../lib/navigation';
import { setPref, usePrefs } from '../lib/prefs';
import { FrameView, OverlayLegend } from './FrameView';
import { FreshnessBadge } from './FreshnessBadge';
import { HistoryList } from './HistoryList';
import { IconButton } from './IconButton';
import { LockNote } from './LockNote';
import { Toggle } from './Toggle';

export function CameraSheetHeader({
  camera,
  home,
  onClose,
}: {
  camera: Pick<CameraSummary, 'name' | 'lat' | 'lon' | 'area' | 'preference'> | null;
  home: LatLon;
  onClose: () => void;
}) {
  return (
    <div className="cs-header">
      <div className="cs-title">
        {camera ? (
          <>
            <h2>{cameraLabel(camera)}</h2>
            <p className="tabular">
              {formatMiles(haversineMiles(home, camera))} from home{camera.area ? ` · ${camera.area}` : ''}
            </p>
          </>
        ) : (
          <>
            <div className="skeleton" style={{ width: 200, height: 22 }} />
            <div className="skeleton" style={{ width: 120, height: 14, marginTop: 6 }} />
          </>
        )}
      </div>
      <IconButton label="Close camera" small onClick={onClose}>
        <X size={17} strokeWidth={2.6} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

interface Props {
  cameraId: string;
  /** GET /api/cameras/:id, loaded by the page so the sheet header can use it too. */
  detail: Resource<CameraDetail>;
  /** Summary from the parking response, shown while details load. */
  summary: CameraSummary | null;
  now: number;
  /** Server's settings.maxDetectionAgeSeconds (defaults to the shared default). */
  maxAgeSeconds?: number;
  isAdmin: boolean;
  onDetection: (det: Detection) => void;
}

function newest(a: Detection | null, b: Detection | null): Detection | null {
  if (!a || !b) return a ?? b;
  return Date.parse(b.timestamp) > Date.parse(a.timestamp) ? b : a;
}

function toHistoryItem(d: Detection): DetectionHistoryItem {
  return {
    id: d.id,
    timestamp: d.timestamp,
    status: d.status,
    candidateSpaces: d.candidateSpaces,
    confidence: d.confidence,
    vehiclesDetected: d.vehiclesDetected,
    freshness: d.freshness,
    reason: d.reason,
  };
}

export function CameraSheet({ cameraId, detail, summary, now, maxAgeSeconds, isAdmin, onDetection }: Props) {
  const { debugOverlays } = usePrefs();
  const visible = usePageVisible();
  const history = useResource<DetectionHistoryItem[]>(cameraId, (signal) => getHistory(cameraId, 30, signal));
  // Overlays describe the analyzed frame, so freeze the image while they're shown.
  const frame = useFrame(cameraId, { intervalMs: debugOverlays ? 0 : 5000, active: visible });
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const cam: CameraSummary | null = detail.data ?? summary;
  // The main screen may have analyzed this camera since the details loaded: use the newest.
  const latest = newest(detail.data?.latest ?? null, summary?.latest ?? null);
  const previous = detail.data?.previous ?? null;
  const watched = cam?.preference.usefulness === 'yes';
  const canAnalyze = watched || isAdmin;

  const analyze = async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const det = await analyzeCamera(cameraId, { force: isAdmin });
      detail.mutate((d) =>
        d
          ? { ...d, latest: det, latestAgeSeconds: 0, previous: d.latest && d.latest.id !== det.id ? toHistoryItem(d.latest) : d.previous }
          : d,
      );
      history.reload();
      frame.reload();
      onDetection(det);
    } catch (err) {
      setAnalyzeError(toApiError(err).message);
    } finally {
      setAnalyzing(false);
    }
  };

  if (!cam) {
    if (detail.error) {
      return (
        <div className="panel">
          <p className="banner tone-red">
            {detail.error.status === 404 ? 'This camera is no longer in the catalog.' : detail.error.message}
          </p>
        </div>
      );
    }
    return (
      <div className="panel">
        <div className="skeleton" style={{ width: '100%', aspectRatio: '352 / 240', borderRadius: 16 }} />
      </div>
    );
  }

  const current = isCurrent(latest, now, maxAgeSeconds);
  const best = current ? latest?.candidates[0] : undefined;
  const frameAge = frame.fetchedAt ? formatAge(ageSeconds(new Date(frame.fetchedAt).toISOString(), now)) : null;
  const overlay =
    debugOverlays && latest
      ? { objects: latest.objects, candidates: latest.candidates, regions: detail.data?.calibration?.regions ?? [] }
      : null;

  return (
    <div className="panel cs">
      <FrameView
        src={frame.src}
        alt={`Live view from ${cameraLabel(cam)}`}
        aspect={frame.width && frame.height ? frame.width / frame.height : undefined}
        overlay={overlay}
        loading={!frame.error}
        errorText={frame.error?.message ?? null}
        className="cs-frame"
      >
        <span className="cs-frame-badge">
          <FreshnessBadge freshness={frame.freshness ?? cam.frame.freshness} onImage />
        </span>
        {frame.src && (
          <span className="cs-frame-caption tabular">
            {overlay && latest ? `Overlay from ${formatClockSeconds(latest.timestamp)}` : frameAge ? `Last image ${frameAge}` : ''}
            {frame.error && ' · refresh failed'}
          </span>
        )}
      </FrameView>

      <ResultBlock latest={latest} current={current} previous={previous} now={now} />

      {analyzeError && <p className="banner tone-red cs-error">{analyzeError}</p>}

      <div className="cs-actions">
        <button type="button" className="btn btn-plain" onClick={analyze} disabled={!canAnalyze || analyzing}>
          <RefreshCw size={18} strokeWidth={2.4} className={analyzing ? 'spin' : undefined} aria-hidden="true" />
          {analyzing ? 'Analyzing…' : 'Analyze'}
        </button>
        {best && (
          <a className="btn btn-primary" href={directionsUrl(best.lat, best.lon)} target="_blank" rel="noopener noreferrer">
            <Navigation size={18} strokeWidth={2.4} aria-hidden="true" />
            Navigate
          </a>
        )}
        {isAdmin ? (
          <Link href={`/calibrate/${encodeURIComponent(cameraId)}`} className="btn btn-secondary">
            <PencilRuler size={18} aria-hidden="true" />
            Calibrate
          </Link>
        ) : (
          <button type="button" className="btn btn-secondary" disabled aria-describedby="cs-lock">
            <PencilRuler size={18} aria-hidden="true" />
            Calibrate
          </button>
        )}
      </div>
      {(!isAdmin || !canAnalyze) && (
        <p className="cs-lock" id="cs-lock">
          <LockNote text={canAnalyze ? 'Unlock in Settings to calibrate' : 'Unlock in Settings to analyze unwatched cameras'} />
        </p>
      )}

      <div className="group cs-group">
        <div className="row has-icon">
          <span className="row-icon tone-gray" aria-hidden="true">
            <Layers size={17} />
          </span>
          <span className="row-label">
            Debug overlays
            <small>{debugOverlays ? 'Live image paused; shows the last analysis' : 'Boxes, gaps and lanes on the image'}</small>
          </span>
          <Toggle checked={debugOverlays} onChange={(v) => setPref('debugOverlays', v)} label="Debug overlays" />
        </div>
        {debugOverlays && (
          <div className="row is-stacked">
            <OverlayLegend />
          </div>
        )}
      </div>

      <h3 className="cs-section-title">History</h3>
      <div className="group">
        <HistoryList items={history.data} loading={history.loading} error={history.error?.message ?? null} now={now} />
      </div>
    </div>
  );
}

function ResultBlock({
  latest,
  current,
  previous,
  now,
}: {
  latest: Detection | null;
  current: boolean;
  previous: DetectionHistoryItem | null;
  now: number;
}) {
  if (!latest) {
    return (
      <section className="cs-result tone-gray">
        <div className="cs-status">
          <span className="cs-status-icon" aria-hidden="true">
            <CircleQuestionMark size={20} strokeWidth={2.3} />
          </span>
          <div>
            <h3>Not checked yet</h3>
            <p>Analyze to look for open curb.</p>
          </div>
        </div>
      </section>
    );
  }
  const tone = current ? STATUS_TONE[latest.status] : 'gray';
  const Icon =
    latest.status === 'likely_available' || latest.status === 'possible'
      ? SquareParking
      : latest.status === 'none'
        ? CircleSlash
        : current
          ? CircleQuestionMark
          : CircleCheck;
  const age = formatAge(ageSeconds(latest.timestamp, now));
  const reason = latest.status === 'unknown' ? reasonText(latest.reason) : null;

  return (
    <section className={`cs-result tone-${tone}`} aria-label="Latest analysis">
      <div className="cs-status">
        <span className="cs-status-icon" aria-hidden="true">
          <Icon size={20} strokeWidth={2.3} />
        </span>
        <div>
          <h3>{current ? STATUS_LABEL[latest.status] : 'No current result'}</h3>
          <p className="tabular">{current ? `Checked ${age}` : `Last check ${age}: ${historySummary(latest)}`}</p>
        </div>
      </div>
      <dl className="cs-stats">
        <div>
          <dt>Spaces</dt>
          <dd className="tabular">{latest.candidateSpaces}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd className="tabular">{latest.status === 'unknown' ? '—' : formatPercent(latest.confidence)}</dd>
        </div>
        <div>
          <dt>Vehicles</dt>
          <dd className="tabular">{latest.vehiclesDetected}</dd>
        </div>
      </dl>
      {reason && (
        <p className="cs-reason">
          <Info size={15} aria-hidden="true" />
          {reason}
        </p>
      )}
      {previous && (
        <p className="cs-prev tabular">
          Previous: {formatClock(previous.timestamp)} – {historySummary(previous)}
        </p>
      )}
    </section>
  );
}
