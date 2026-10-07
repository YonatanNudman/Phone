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
  /** "1 of 3" when there are several candidates. */
  position?: string;
}

/** One possible parking spot: where, how sure, how old, and how to get there. */
export function ParkingCard({ candidate: c, ageSeconds, distanceMi, onViewCamera, position }: Props) {
  const likely = c.status === 'likely_available';
  const tone = likely ? 'green' : 'yellow';
  const detail = [c.reasons[0], c.lengthM ? `about ${Math.round(c.lengthM)} m of open curb` : null].filter(Boolean).join(' · ');
  return (
    <article className={`pcard tone-${tone}`} aria-label={`${likely ? 'Parking detected' : 'Possible parking'}: ${c.streetLabel}`}>
      <div className="pcard-top">
        <div className="pcard-eyebrow">
          <span className="dot" aria-hidden="true" />
          {likely ? 'Parking detected' : 'Possible parking'}
        </div>
        {position && <span className="pcard-count tabular">{position}</span>}
      </div>
      <h2 className="pcard-title">{c.streetLabel}</h2>
      {detail && <p className="pcard-reason">{detail}</p>}

      <dl className="pcard-stats">
        <div>
          <dt>
            <SquareParking size={15} aria-hidden="true" />
            Possible spaces
          </dt>
          <dd className="tabular">{c.spaces}</dd>
        </div>
        <div>
          <dt>
            <Gauge size={15} aria-hidden="true" />
            Confidence
          </dt>
          <dd className="tabular">{formatPercent(c.confidence)}</dd>
        </div>
        <div>
          <dt>
            <Clock size={15} aria-hidden="true" />
            Detected
          </dt>
          <dd className="tabular">{formatAge(ageSeconds)}</dd>
        </div>
        <div>
          <dt>
            <House size={15} aria-hidden="true" />
            From home
          </dt>
          <dd className="tabular">{formatMiles(distanceMi)}</dd>
        </div>
      </dl>

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
