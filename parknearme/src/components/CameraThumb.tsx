import { useRef } from 'react';
import type { CameraSummary } from '../../shared/types';
import { formatAge } from '../../shared/freshness';
import { useFrame } from '../hooks/useFrame';
import { useInView } from '../hooks/useInView';
import { usePageVisible } from '../hooks/usePageVisible';
import { detectionChip } from '../lib/detection';
import { ageSeconds, cameraLabel } from '../lib/format';
import { FrameView } from './FrameView';
import { FreshnessBadge } from './FreshnessBadge';

interface Props {
  camera: CameraSummary;
  now: number;
  index: number;
  onOpen: () => void;
}

/** Watched-camera thumbnail for the "nothing open" state of the sheet. */
export function CameraThumb({ camera, now, index, onOpen }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const inView = useInView(ref);
  const visible = usePageVisible();
  const frame = useFrame(camera.id, { intervalMs: 30_000, active: inView && visible, initialDelayMs: index * 400 });
  const chip = detectionChip(camera.latest, now);
  const name = cameraLabel(camera);
  const age = ageSeconds(camera.latest?.timestamp, now);

  return (
    <button ref={ref} type="button" className="thumb" onClick={onOpen} aria-label={`${name}: ${chip.text}. Open camera`}>
      <FrameView src={frame.src} alt="" errorText={frame.error ? 'No image' : null} className="thumb-frame">
        <span className={`badge is-solid tone-${chip.tone} thumb-chip`}>{chip.text}</span>
      </FrameView>
      <span className="thumb-name">{name}</span>
      <span className="thumb-meta">
        <FreshnessBadge freshness={camera.frame.freshness} />
        <span className="tabular">{age === null ? 'never checked' : formatAge(age)}</span>
      </span>
    </button>
  );
}
