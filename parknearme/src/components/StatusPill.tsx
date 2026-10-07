import { RefreshCw } from 'lucide-react';
import type { SummaryState } from '../../shared/types';
import { formatAge, secondsSince } from '../../shared/freshness';
import { SUMMARY_TONE } from '../lib/format';

interface Props {
  state: SummaryState | null;
  headline: string;
  updatedAt: string | null;
  working: boolean;
  message: string | null;
  /** A refresh failed (data may still be on screen). */
  errorText: string | null;
  failed: number;
  now: number;
  onRefresh: () => void;
}

/** Floating frosted pill: the one-line answer, its age, and a refresh button. */
export function StatusPill({ state, headline, updatedAt, working, message, errorText, failed, now, onRefresh }: Props) {
  const tone = state ? SUMMARY_TONE[state] : 'gray';
  const age = updatedAt ? formatAge(secondsSince(updatedAt, new Date(now))) : null;
  let sub: string;
  if (working && message) sub = message;
  else if (errorText) sub = errorText;
  else if (age) sub = `Updated ${age}${failed ? ` · ${failed} camera${failed === 1 ? '' : 's'} didn't answer` : ''}`;
  else sub = failed ? "Cameras didn't answer" : 'No recent camera checks';

  return (
    <div className="status-pill glass">
      <span className={`status-dot tone-${tone}${working ? ' is-working' : ''}`} aria-hidden="true" />
      <div className="status-text" role="status" aria-live="polite">
        <div className="status-headline">{headline}</div>
        <div className={`status-sub tabular${errorText && !working ? ' is-error' : ''}`}>{sub}</div>
      </div>
      <button
        type="button"
        className="status-refresh"
        onClick={onRefresh}
        disabled={working}
        aria-label={working ? 'Refreshing' : 'Refresh'}
        title="Refresh"
      >
        <RefreshCw size={19} strokeWidth={2.3} className={working ? 'spin' : undefined} aria-hidden="true" />
      </button>
    </div>
  );
}
