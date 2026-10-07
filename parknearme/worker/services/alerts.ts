// Web Push alerts for new parking candidates.
//
// A candidate triggers an alert when notifications are on, push is configured,
// the detection is current (live frame, younger than maxDetectionAgeSeconds),
// it has spaces, meets minConfidence and lies within the radius of home.
// Per subscription: the same spot (camera + lane + position) is not repeated
// within 30 min, and there is at most one push every 5 min.

import { isDetectionCurrent } from '../../shared/freshness';
import { haversineMiles } from '../../shared/geo';
import type { AppSettings, Detection, ParkingCandidate } from '../../shared/types';
import { disableSubscription, listEnabledSubscriptions, markNotified, recordPushFailure, type SubscriptionRow } from '../db';
import type { Env } from '../env';
import { pushConfigured, sendPush, type PushMessage } from '../push';
import { readSettingsState } from './settings';

const SAME_SPOT_REPEAT_MS = 30 * 60_000;
const MIN_PUSH_INTERVAL_MS = 5 * 60_000;
/** Consecutive failed deliveries after which a subscription is disabled. */
const MAX_PUSH_FAILURES = 5;

/** Identifies "the same spot" across analyses: camera, lane and gap position (in tenths of the lane). */
export function alertKey(c: Pick<ParkingCandidate, 'cameraId' | 'regionId' | 'gapStart'>): string {
  return `${c.cameraId}:${c.regionId}:${Math.round(c.gapStart * 10)}`;
}

export function alertMessage(c: ParkingCandidate): PushMessage {
  const spots = `${c.spaces} possible ${c.spaces === 1 ? 'spot' : 'spots'}`;
  return {
    title: 'Parking spotted',
    body: `${c.streetLabel} · ${spots} · ${Math.round(c.confidence * 100)}%`,
    path: `/?camera=${encodeURIComponent(c.cameraId)}`,
    // One notification per camera on the device; a newer alert replaces the older one.
    tag: `parking-${c.cameraId.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}`,
  };
}

/** Candidates of `detection` that deserve an alert, best first. */
export function alertCandidates(detection: Detection, settings: AppSettings, now = new Date()): ParkingCandidate[] {
  if (!settings.notificationsEnabled || detection.candidateSpaces <= 0) return [];
  if (!isDetectionCurrent(detection, settings.maxDetectionAgeSeconds, now)) return [];
  return detection.candidates
    .filter((c) => c.spaces > 0 && c.confidence >= settings.minConfidence && haversineMiles(settings.home, c) <= settings.radiusMi)
    .sort((a, b) => b.confidence - a.confidence);
}

/** The candidate to send to this subscription now, or null when rate limits say wait. */
export function pickForSubscription(
  sub: Pick<SubscriptionRow, 'last_notified_at' | 'last_notified_key'>,
  candidates: ParkingCandidate[],
  now = new Date(),
): ParkingCandidate | null {
  const last = sub.last_notified_at ? Date.parse(sub.last_notified_at) : NaN;
  const since = Number.isFinite(last) ? now.getTime() - last : Infinity;
  if (since < MIN_PUSH_INTERVAL_MS) return null;
  return candidates.find((c) => !(alertKey(c) === sub.last_notified_key && since < SAME_SPOT_REPEAT_MS)) ?? null;
}

/** Send one push and keep the subscription's health up to date. Returns true when delivered. */
export async function deliverPush(env: Env, sub: SubscriptionRow, message: PushMessage, origin: string | null): Promise<boolean> {
  const result = await sendPush(env, sub, message, origin);
  if (result.ok) return true;
  if (result.gone) await disableSubscription(env.DB, sub.id);
  else await recordPushFailure(env.DB, sub.id, MAX_PUSH_FAILURES);
  console.error(`push: subscription ${sub.id} failed (HTTP ${result.status}${result.reason ? `, ${result.reason}` : ''}${result.gone ? ', disabled' : ''})`);
  return false;
}

/** Send alerts for a freshly stored detection. Returns how many pushes were delivered. */
export async function evaluateAlerts(env: Env, detection: Detection, now = new Date()): Promise<number> {
  if (!pushConfigured(env)) return 0;
  const { settings, appOrigin } = await readSettingsState(env);
  const candidates = alertCandidates(detection, settings, now);
  if (candidates.length === 0) return 0;

  let sent = 0;
  for (const sub of await listEnabledSubscriptions(env.DB)) {
    const pick = pickForSubscription(sub, candidates, now);
    if (!pick) continue;
    if (await deliverPush(env, sub, alertMessage(pick), appOrigin)) {
      await markNotified(env.DB, sub.id, alertKey(pick), now.toISOString());
      sent++;
    }
  }
  if (sent > 0) console.log(`alerts: camera ${detection.cameraId} detection ${detection.id}: sent ${sent} push(es)`);
  return sent;
}
