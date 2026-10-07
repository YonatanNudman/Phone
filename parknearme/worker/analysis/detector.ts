// Detector interfaces. The pipeline depends only on these, so a different
// model or provider can be swapped in without touching the rest of the app.

import type { Calibration, DetectedObject, ParkingAnalysis, ParkingCandidate } from '../../shared/types';

export interface Frame {
  cameraId: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  fetchedAt: string;
  hash: string;
}

/** Finds vehicles in a frame. Boxes are returned in normalized (0..1) coordinates. */
export interface VehicleDetector {
  readonly name: string;
  detect(frame: Frame): Promise<DetectedObject[]>;
}

export interface AnalysisContext {
  calibration: Calibration | null;
  /** Candidates from the previous analysis of this camera, if recent. */
  previousCandidates: Pick<ParkingCandidate, 'regionId' | 'gapStart' | 'gapEnd'>[];
  minConfidence: number;
  camera: { lat: number; lon: number; name: string };
}

/** Turns a frame into a parking verdict. */
export interface ParkingDetector {
  readonly name: string;
  analyze(frame: Frame, context: AnalysisContext): Promise<Omit<ParkingAnalysis, 'freshness'>>;
}

/** Optional second opinion on a candidate (e.g. a vision LLM). */
export interface CandidateVerifier {
  readonly name: string;
  verify(frame: Frame, candidate: ParkingCandidate): Promise<{ agrees: boolean | null; note: string }>;
}
