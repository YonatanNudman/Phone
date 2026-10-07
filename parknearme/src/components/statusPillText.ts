// Sub-line text for the status pill, and whether it may be announced.

import { formatAge, secondsSince } from '../../shared/freshness';

export interface StatusPillText {
  /** Line under the headline. */
  sub: string;
  /**
   * Whether `sub` goes in the live region with the headline. Progress and
   * errors do. The ticking "Updated 6 sec ago" line changes every second, so
   * it must stay out, or screen readers re-announce the pill every second.
   */
  subIsLive: boolean;
}

export function statusPillText(o: {
  updatedAt: string | null;
  working: boolean;
  message: string | null;
  errorText: string | null;
  failed: number;
  now: number;
}): StatusPillText {
  if (o.working && o.message) return { sub: o.message, subIsLive: true };
  if (o.errorText) return { sub: o.errorText, subIsLive: true };
  const age = o.updatedAt ? formatAge(secondsSince(o.updatedAt, new Date(o.now))) : null;
  if (age) {
    const failed = o.failed ? ` · ${o.failed} camera${o.failed === 1 ? '' : 's'} didn't answer` : '';
    return { sub: `Updated ${age}${failed}`, subIsLive: false };
  }
  return { sub: o.failed ? "Cameras didn't answer" : 'No recent camera checks', subIsLive: true };
}
