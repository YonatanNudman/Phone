import { RefreshCw } from 'lucide-react';
import type { SummaryState } from '../../shared/types';
import { SUMMARY_TONE } from '../lib/format';
import { statusPillText } from './statusPillText';

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
  const { sub, subIsLive } = statusPillText({ updatedAt, working, message, errorText, failed, now });
  const subLine = <div className={`status-sub tabular${errorText && !working ? ' is-error' : ''}`}>{sub}</div>;

  return (
    <div className="status-pill glass">
      <span className={`status-dot tone-${tone}${working ? ' is-working' : ''}`} aria-hidden="true" />
      <div className="status-text">
        {/* Only state changes are announced; the ticking "Updated …" line stays outside. */}
        <div role="status" aria-live="polite">
          <div className="status-headline">{headline}</div>
          {subIsLive && subLine}
        </div>
        {!subIsLive && subLine}
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
