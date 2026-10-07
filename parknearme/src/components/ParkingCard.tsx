import { Clock, Gauge, House, Navigation, SquareParking, Video } from 'lucide-react';
import type { ParkingCandidate } from '../../shared/types';
import { formatAge } from '../../shared/freshness';
import { formatMiles } from '../../shared/geo';
import { formatPercent } from '../lib/format';
import { directionsUrl } from '../lib/navigation';

interface Props {
  candidate: ParkingCandidate;
  ageSeconds: number | null;
  distanceMi: number;
  onViewCamera: () => void;
}

/** One possible parking spot: where, how sure, how old, and how to get there. */
export function ParkingCard({ candidate: c, ageSeconds, distanceMi, onViewCamera }: Props) {
  const likely = c.status === 'likely_available';
  const tone = likely ? 'green' : 'yellow';
  return (
    <article className={`pcard tone-${tone}`} aria-label={`${likely ? 'Parking detected' : 'Possible parking'}: ${c.streetLabel}`}>
      <div className="pcard-eyebrow">
        <span className="dot" aria-hidden="true" />
        {likely ? 'Parking detected' : 'Possible parking'}
      </div>
      <h2 className="pcard-title">{c.streetLabel}</h2>
      {c.reasons[0] && <p className="pcard-reason">{c.reasons[0]}</p>}

      <ul className="pcard-rows">
        <li>
          <SquareParking size={18} aria-hidden="true" />
          <span>Possible spaces</span>
          <strong className="tabular">{c.spaces}</strong>
        </li>
        <li>
          <Gauge size={18} aria-hidden="true" />
          <span>Confidence</span>
          <strong className="tabular">{formatPercent(c.confidence)}</strong>
        </li>
        <li>
          <Clock size={18} aria-hidden="true" />
          <span>Detected</span>
          <strong className="tabular">{formatAge(ageSeconds)}</strong>
        </li>
        <li>
          <House size={18} aria-hidden="true" />
          <span>Distance from home</span>
          <strong className="tabular">{formatMiles(distanceMi)}</strong>
        </li>
      </ul>

      <div className="pcard-actions">
        <a className="btn btn-primary" href={directionsUrl(c.lat, c.lon)} target="_blank" rel="noopener noreferrer">
          <Navigation size={18} strokeWidth={2.4} aria-hidden="true" />
          Navigate
        </a>
        <button type="button" className="btn btn-secondary" onClick={onViewCamera}>
          <Video size={19} strokeWidth={2.2} aria-hidden="true" />
          View Camera
        </button>
      </div>
      {c.approximateLocation && <p className="pcard-approx">The pin marks the camera's area, not the exact space.</p>}
    </article>
  );
}
