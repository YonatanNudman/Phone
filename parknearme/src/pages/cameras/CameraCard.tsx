// One camera on the discovery page: live frame, usefulness vote, notes,
// on-demand analysis with boxes drawn over the frame, and a calibrate link.

import { BadgeCheck, Lock, PencilRuler, ScanSearch } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'wouter';
import type { CameraPreference, CameraSummary, Detection, Usefulness } from '../../../shared/types';
import { formatAge } from '../../../shared/freshness';
import { formatMiles } from '../../../shared/geo';
import { prettyCameraName } from '../../../shared/status';
import { FrameView } from '../../components/FrameView';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { SegmentedControl } from '../../components/SegmentedControl';
import { useFrame } from '../../hooks/useFrame';
import { useInView } from '../../hooks/useInView';
import { analyzeCamera, setUsefulness, toApiError } from '../../lib/api';
import { ageSeconds, formatClockSeconds, formatPercent, reasonText } from '../../lib/format';
import { toast } from '../../lib/toast';

const USEFULNESS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unknown', label: 'Unknown' },
] as const;

interface Props {
  camera: CameraSummary;
  index: number;
  now: number;
  isAdmin: boolean;
  paused: boolean;
  pageVisible: boolean;
  onPreference: (id: string, pref: CameraPreference) => void;
}

function analysisSummary(d: Detection): string {
  if (d.status === 'unknown') return `${d.vehiclesDetected} vehicles · ${reasonText(d.reason) ?? 'Unknown'}`;
  const spaces = d.candidateSpaces === 0 ? 'no open curb' : `${d.candidateSpaces} possible ${d.candidateSpaces === 1 ? 'space' : 'spaces'}`;
  return `${d.vehiclesDetected} vehicles · ${spaces} · ${formatPercent(d.confidence)}`;
}

export function CameraCard({ camera, index, now, isAdmin, paused, pageVisible, onPreference }: Props) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref);
  const [result, setResult] = useState<Detection | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [notes, setNotes] = useState(camera.preference.notes ?? '');
  const [saving, setSaving] = useState(false);

  // While an analysis is on screen, stop refreshing so the boxes match the image
  // (one more fetch right after analyzing grabs the frame the server just used).
  const frame = useFrame(camera.id, {
    intervalMs: result ? 0 : 15_000,
    active: inView && pageVisible && !paused,
    initialDelayMs: (index % 15) * 1000,
  });

  const pref = camera.preference;
  const watched = pref.usefulness === 'yes';
  const pretty = prettyCameraName(camera.name);
  const frameAge = frame.fetchedAt ? ageSeconds(new Date(frame.fetchedAt).toISOString(), now) : null;

  const save = async (usefulness: Usefulness, nextNotes: string) => {
    const before = pref;
    // Optimistic: show the change now, roll back if the server refuses.
    onPreference(camera.id, { ...pref, usefulness, notes: nextNotes || null });
    setSaving(true);
    try {
      const saved = await setUsefulness(camera.id, { usefulness, notes: nextNotes });
      onPreference(camera.id, saved);
    } catch (err) {
      onPreference(camera.id, before);
      setNotes(before.notes ?? '');
      toast(toApiError(err).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const det = await analyzeCamera(camera.id, { force: true });
      setResult(det);
      frame.reload();
    } catch (err) {
      toast(toApiError(err).message, 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <article ref={ref} className={`ccard card${watched ? ' is-watched' : ''}`} aria-label={pretty}>
      <FrameView
        src={frame.src}
        alt={`Live view from ${pretty}`}
        aspect={frame.width && frame.height ? frame.width / frame.height : undefined}
        loading={!frame.error}
        errorText={frame.error?.message ?? (paused ? 'Images paused' : null)}
        overlay={result ? { objects: result.objects, candidates: result.candidates } : null}
        className="ccard-frame"
      >
        <span className="ccard-badges">
          <FreshnessBadge freshness={frame.freshness ?? camera.frame.freshness} onImage />
          {watched && <span className="badge is-solid tone-green">Watching</span>}
        </span>
      </FrameView>

      <div className="ccard-body">
        <div className="ccard-head">
          <h2>{pretty}</h2>
          <span className="ccard-dist tabular">{formatMiles(camera.distanceMi)}</span>
        </div>
        <p className="ccard-meta tabular">
          {paused ? 'Paused' : frameAge === null ? 'Loading…' : `Last refresh ${formatAge(frameAge)}`}
          {camera.calibrated && (
            <span className="ccard-calibrated">
              <BadgeCheck size={14} aria-hidden="true" /> Calibrated
            </span>
          )}
        </p>

        <div className="ccard-field">
          <span>Useful for parking?</span>
          <SegmentedControl
            label="Useful for parking?"
            options={USEFULNESS}
            value={pref.usefulness}
            disabled={!isAdmin || saving}
            onChange={(v) => void save(v, notes)}
          />
        </div>

        {(isAdmin || notes) && (
          <label className="sr-only" htmlFor={`notes-${camera.id}`}>
            Notes
          </label>
        )}
        {(isAdmin || notes) && (
          <textarea
            id={`notes-${camera.id}`}
            className="field ccard-notes"
            rows={1}
            maxLength={500}
            placeholder={isAdmin ? 'Notes (e.g. south curb visible, ~8 cars)' : 'No notes'}
            value={notes}
            disabled={!isAdmin}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes.trim() !== (pref.notes ?? '').trim()) void save(pref.usefulness, notes.trim());
            }}
          />
        )}

        {result && (
          <div className={`ccard-result tone-${result.candidateSpaces > 0 ? 'green' : result.status === 'none' ? 'red' : 'gray'}`}>
            <span className="dot" aria-hidden="true" />
            <span className="ccard-result-text tabular">
              {analysisSummary(result)}
              <small>Boxes from {formatClockSeconds(result.timestamp)} · image paused</small>
            </span>
            <button type="button" className="btn-link" onClick={() => setResult(null)}>
              Resume live
            </button>
          </div>
        )}

        <div className="ccard-actions">
          <button type="button" className="btn btn-plain btn-sm" onClick={analyze} disabled={!isAdmin || analyzing}>
            {isAdmin ? (
              <ScanSearch size={17} aria-hidden="true" className={analyzing ? 'pulse' : undefined} />
            ) : (
              <Lock size={15} aria-hidden="true" />
            )}
            {analyzing ? 'Analyzing…' : 'Analyze'}
          </button>
          {isAdmin ? (
            <Link href={`/calibrate/${encodeURIComponent(camera.id)}`} className="btn btn-secondary btn-sm">
              <PencilRuler size={17} aria-hidden="true" />
              {camera.calibrated ? 'Edit calibration' : 'Calibrate'}
            </Link>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm" disabled>
              <Lock size={15} aria-hidden="true" />
              Calibrate
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
