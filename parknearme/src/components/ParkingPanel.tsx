// Bottom-sheet content for the main screen: best parking candidate(s), or the
// "nothing open" summary with watched-camera thumbnails, or setup / error states.

import { CameraOff, Cctv, CircleSlash } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'wouter';
import type { CameraSummary, ParkingCandidate, ParkingCurrentResponse } from '../../shared/types';
import { haversineMiles } from '../../shared/geo';
import type { ApiError } from '../lib/api';
import { isCurrent, MAX_DETECTION_AGE_SECONDS } from '../lib/detection';
import { ageSeconds, reasonText } from '../lib/format';
import { CameraThumb } from './CameraThumb';
import { ErrorBanner } from './ErrorBanner';
import { ParkingCard } from './ParkingCard';

/** Must match `.pager { gap }` in sheet.css. */
const PAGER_GAP = 32;

export interface ShownCandidate {
  candidate: ParkingCandidate;
  ageSeconds: number | null;
}

/** Candidates that are still current on this device's clock (the server filtered at response time). */
export function currentCandidates(data: ParkingCurrentResponse, now: number): ShownCandidate[] {
  const byId = new Map(data.watched.map((c) => [c.id, c]));
  const out: ShownCandidate[] = [];
  for (const candidate of data.candidates) {
    const latest = byId.get(candidate.cameraId)?.latest ?? null;
    if (latest) {
      if (!isCurrent(latest, now)) continue;
      out.push({ candidate, ageSeconds: ageSeconds(latest.timestamp, now) });
    } else {
      const age = ageSeconds(data.generatedAt, now);
      if (age !== null && age > MAX_DETECTION_AGE_SECONDS) continue;
      out.push({ candidate, ageSeconds: null });
    }
  }
  return out;
}

interface Props {
  data: ParkingCurrentResponse | null;
  error: ApiError | null;
  working: boolean;
  now: number;
  shown: ShownCandidate[];
  selected: number;
  onSelect: (index: number) => void;
  onOpenCamera: (id: string) => void;
  onRetry: () => void;
}

export function ParkingPanel({ data, error, working, now, shown, selected, onSelect, onOpenCamera, onRetry }: Props) {
  if (!data) {
    if (error && !working) {
      return (
        <div className="panel">
          <ErrorBanner title="Couldn't load parking" message={error.message} onRetry={onRetry} />
        </div>
      );
    }
    return <PanelSkeleton />;
  }

  if (data.watched.length === 0) {
    return (
      <div className="panel">
        <div className="empty">
          <div className="empty-icon">
            <Cctv size={26} aria-hidden="true" />
          </div>
          <h2>No cameras set up yet</h2>
          <p>Pick the nearby traffic cameras that can see a parking lane, and they'll be checked here.</p>
          <Link href="/cameras" className="btn btn-primary empty-cta">
            Choose cameras
          </Link>
        </div>
      </div>
    );
  }

  if (shown.length > 0) {
    return (
      <div className="panel">
        <CandidatePager data={data} shown={shown} selected={selected} onSelect={onSelect} onOpenCamera={onOpenCamera} />
        <p className="disclaimer">Possible parking from a traffic camera — not a guarantee it's legal. Check signs.</p>
      </div>
    );
  }

  return <NothingOpen data={data} now={now} onOpenCamera={onOpenCamera} />;
}

function CandidatePager({
  data,
  shown,
  selected,
  onSelect,
  onOpenCamera,
}: Pick<Props, 'selected' | 'onSelect' | 'onOpenCamera'> & { data: ParkingCurrentResponse; shown: ShownCandidate[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const multiple = shown.length > 1;

  // Slides are equal width with a fixed gap, so slide i snaps at i * step.
  const step = () => {
    const first = scroller.current?.firstElementChild as HTMLElement | null;
    return first ? first.offsetWidth + PAGER_GAP : 1;
  };

  // Keep the carousel on the selected candidate (e.g. after tapping a map pin).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const first = el.firstElementChild as HTMLElement | null;
    const target = selected * ((first?.offsetWidth ?? 0) + PAGER_GAP);
    if (Math.abs(el.scrollLeft - target) > 4) el.scrollTo({ left: target, behavior: 'smooth' });
  }, [selected]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const index = Math.min(shown.length - 1, Math.max(0, Math.round(el.scrollLeft / step())));
    if (index !== selected) onSelect(index);
  };

  return (
    <>
      <div ref={scroller} className={`pager${multiple ? ' is-multiple' : ''}`} onScroll={multiple ? onScroll : undefined}>
        {shown.map(({ candidate, ageSeconds: age }, i) => (
          <div
            className="pager-slide"
            key={`${candidate.cameraId}:${candidate.regionId}:${candidate.gapStart}:${i}`}
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${shown.length}`}
          >
            <ParkingCard
              candidate={candidate}
              ageSeconds={age}
              distanceMi={haversineMiles(data.home, candidate)}
              onViewCamera={() => onOpenCamera(candidate.cameraId)}
              position={multiple ? `${i + 1} of ${shown.length}` : undefined}
            />
          </div>
        ))}
      </div>
    </>
  );
}

function NothingOpen({ data, now, onOpenCamera }: { data: ParkingCurrentResponse; now: number; onOpenCamera: (id: string) => void }) {
  const watched = useMemo(() => [...data.watched].sort((a, b) => a.distanceMi - b.distanceMi), [data.watched]);
  // Cameras that actually looked at the curb just now (not "unknown").
  const current = watched.filter((c) => isCurrent(c.latest, now) && c.latest?.status !== 'unknown');
  const { title, detail, tone, Icon } = describeNothing(watched, current.length, data, now);

  return (
    <div className="panel">
      <div className="none-head">
        <span className={`none-icon tone-${tone}`} aria-hidden="true">
          <Icon size={22} strokeWidth={2.2} />
        </span>
        <div className="none-text">
          <h2>{title}</h2>
          <p>{detail}</p>
        </div>
      </div>
      <div className="thumb-strip" aria-label="Watched cameras">
        {watched.map((cam, i) => (
          <CameraThumb key={cam.id} camera={cam} now={now} index={i} onOpen={() => onOpenCamera(cam.id)} />
        ))}
        <Link href="/cameras" className="thumb thumb-more">
          <span className="thumb-more-icon">
            <Cctv size={20} aria-hidden="true" />
          </span>
          <span>All cameras</span>
        </Link>
      </div>
    </div>
  );
}

function describeNothing(watched: CameraSummary[], currentCount: number, data: ParkingCurrentResponse, now: number) {
  if (currentCount > 0) {
    const updated = ageSeconds(data.summary.updatedAt, now);
    return {
      title: `No open curb seen on ${currentCount} ${currentCount === 1 ? 'camera' : 'cameras'}`,
      detail:
        updated !== null && updated < 90
          ? 'Cars are filling the visible parking lanes.'
          : 'Cars are filling the visible lanes. Refresh for a new look.',
      tone: 'red' as const,
      Icon: CircleSlash,
    };
  }
  // Nothing current: say why, using the most common reason among watched cameras.
  const reasons = new Map<string, number>();
  for (const c of watched) {
    const r = c.latest?.reason ?? (c.frame.freshness === 'offline' ? 'frame_unavailable' : c.calibrated ? null : 'needs_calibration');
    if (r) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    title: "Can't see the curb right now",
    detail: top ? `${reasonText(top[0])} · ${top[1]} of ${watched.length} cameras` : 'Tap refresh to check the cameras again.',
    tone: 'gray' as const,
    Icon: CameraOff,
  };
}

function PanelSkeleton() {
  return (
    <div className="panel" aria-busy="true" aria-label="Loading parking">
      <div className="skeleton" style={{ width: 120, height: 14 }} />
      <div className="skeleton" style={{ width: '72%', height: 26, marginTop: 12 }} />
      <div className="skeleton" style={{ width: '100%', height: 132, marginTop: 18, borderRadius: 12 }} />
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <div className="skeleton" style={{ flex: 1, height: 50, borderRadius: 14 }} />
        <div className="skeleton" style={{ flex: 1, height: 50, borderRadius: 14 }} />
      </div>
    </div>
  );
}
