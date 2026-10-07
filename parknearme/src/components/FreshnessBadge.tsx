import type { Freshness } from '../../shared/types';
import { FRESHNESS_LABEL, FRESHNESS_TONE } from '../lib/format';

interface Props {
  freshness: Freshness | null | undefined;
  /** Variant for use on top of camera images. */
  onImage?: boolean;
}

/** LIVE / STALE / OFFLINE / UNKNOWN capsule. Text always accompanies the color. */
export function FreshnessBadge({ freshness, onImage }: Props) {
  const f = freshness ?? 'unknown';
  return (
    <span className={`badge tone-${FRESHNESS_TONE[f]}${onImage ? ' on-image' : ''}`}>
      <span className={`dot${f === 'live' ? ' pulse' : ''}`} aria-hidden="true" />
      {FRESHNESS_LABEL[f]}
    </span>
  );
}
