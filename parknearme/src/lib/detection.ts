// Interpreting detections for display. Old or non-live results are never
// presented as current parking.

import type { Detection, DetectionHistoryItem } from '../../shared/types';
import { isDetectionCurrent } from '../../shared/freshness';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { STATUS_TONE, type Tone } from './format';

/** Client-side guard matching the server default (settings.maxDetectionAgeSeconds). */
export const MAX_DETECTION_AGE_SECONDS = DEFAULT_SETTINGS.maxDetectionAgeSeconds;

export function isCurrent(det: { timestamp: string; freshness: Detection['freshness'] } | null | undefined, nowMs: number): boolean {
  return isDetectionCurrent(det ?? null, MAX_DETECTION_AGE_SECONDS, new Date(nowMs));
}

const SHORT_REASON: Record<string, string> = {
  needs_calibration: 'Not calibrated',
  stale_frame: 'Frozen image',
  frame_unavailable: 'Offline',
  detector_unavailable: 'No analysis',
  detector_error: 'Analysis failed',
  no_vehicles_detected: 'No cars seen',
};

/** Compact chip for camera thumbnails: tone + a couple of words. */
export function detectionChip(det: Detection | null, nowMs: number): { tone: Tone; text: string } {
  if (!det) return { tone: 'gray', text: 'Not checked' };
  if (!isCurrent(det, nowMs)) return { tone: 'gray', text: 'Old result' };
  if (det.status === 'likely_available' || det.status === 'possible') {
    const n = det.candidateSpaces;
    return { tone: STATUS_TONE[det.status], text: `${n} ${n === 1 ? 'spot' : 'spots'}` };
  }
  if (det.status === 'none') return { tone: 'red', text: 'No spots' };
  return { tone: 'gray', text: (det.reason && SHORT_REASON[det.reason]) || 'Unknown' };
}

/** "1 possible spot", "no spots", "Not calibrated yet" for history rows. */
export function historySummary(h: Pick<DetectionHistoryItem, 'status' | 'candidateSpaces' | 'reason'>): string {
  if (h.status === 'likely_available' || h.status === 'possible') {
    return `${h.candidateSpaces} possible ${h.candidateSpaces === 1 ? 'spot' : 'spots'}`;
  }
  if (h.status === 'none') return 'no spots';
  return (h.reason && SHORT_REASON[h.reason]?.toLowerCase()) || 'unknown';
}
