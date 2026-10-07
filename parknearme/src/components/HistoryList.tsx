import type { DetectionHistoryItem } from '../../shared/types';
import { historySummary } from '../lib/detection';
import { dayIfNotToday, formatClock, formatPercent, STATUS_TONE } from '../lib/format';

interface Props {
  items: DetectionHistoryItem[] | undefined;
  loading: boolean;
  error: string | null;
  now: number;
}

/** "12:42 AM – 1 possible spot" rows, newest first, in New York time. */
export function HistoryList({ items, loading, error, now }: Props) {
  if (!items) {
    if (error) return <p className="history-empty">{error}</p>;
    return (
      <ul className="history" aria-busy={loading}>
        {[0, 1, 2].map((i) => (
          <li key={i}>
            <span className="skeleton" style={{ width: 64, height: 14 }} />
            <span className="skeleton" style={{ width: 120, height: 14 }} />
          </li>
        ))}
      </ul>
    );
  }
  if (items.length === 0) return <p className="history-empty">No checks yet.</p>;
  return (
    <ul className="history">
      {items.map((h) => {
        const day = dayIfNotToday(h.timestamp, now);
        const hasSpots = h.status === 'likely_available' || h.status === 'possible';
        return (
          <li key={h.id}>
            <time className="history-time tabular" dateTime={h.timestamp}>
              {formatClock(h.timestamp)}
              {day && <small>{day}</small>}
            </time>
            <span className={`dot tone-${STATUS_TONE[h.status]}`} aria-hidden="true" />
            <span className="history-text">{historySummary(h)}</span>
            {hasSpots && <span className="history-conf tabular">{formatPercent(h.confidence)}</span>}
            {h.freshness !== 'live' && <span className="history-flag">{h.freshness}</span>}
          </li>
        );
      })}
    </ul>
  );
}
