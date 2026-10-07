// Curb-gap analysis: given vehicle boxes and a calibrated parking lane, find
// car-sized openings along the curb.
//
// Each parking lane is a 4-point quad drawn on the frame. A homography maps it
// to a unit rectangle (u along the street, v across). Every vehicle whose
// ground-contact point lands in the lane is treated as parked and occupies an
// interval of u. Uncovered stretches of u, minus RESTRICTED / IGNORE zones, are
// gaps; a gap at least one car slot long (1 / capacity) is a candidate space.
//
// This only says "the curb looks open". It cannot know about hydrants, signs or
// rules unless the user marked them as RESTRICTED during calibration.

import {
  applyHomography,
  clamp,
  complementIntervals,
  homographyW,
  laneHomography,
  mergeIntervals,
  pointInPolygon,
  subtractIntervals,
  type Interval,
  type Mat3,
} from './geometry';
import type { DetectedObject, ParkingStatus, Point, Region } from './types';

export const VEHICLE_LABELS = ['car', 'truck', 'bus', 'motorcycle'] as const;

/** Relative length of a vehicle compared with one car slot. */
const LENGTH_FACTOR: Record<string, number> = { car: 1, truck: 1.6, bus: 2.6, motorcycle: 0.5 };

export interface GapOptions {
  imageWidth: number;
  imageHeight: number;
  /** Ignore detections below this score. */
  minVehicleScore: number;
  /** Candidate confidence needed for "likely_available". */
  minConfidence: number;
  /** A gap must be at least this many car slots to count as a likely space. */
  likelyGapSlots: number;
  /** Smallest gap (in slots) reported at all, as "possible". */
  possibleGapSlots: number;
  /** Gaps shorter than this on screen are too small to trust. */
  minGapPixels: number;
}

export const DEFAULT_GAP_OPTIONS: GapOptions = {
  imageWidth: 352,
  imageHeight: 240,
  minVehicleScore: 0.5,
  minConfidence: 0.6,
  likelyGapSlots: 1.0,
  possibleGapSlots: 0.85,
  minGapPixels: 12,
};

export interface GapResult {
  regionId: string;
  streetLabel: string;
  start: number;
  end: number;
  slots: number;
  spaces: number;
  confidence: number;
  status: Exclude<ParkingStatus, 'none' | 'unknown'>;
  boundedBothSides: boolean;
  polygon: Point[];
  reasons: string[];
}

export interface LaneResult {
  regionId: string;
  streetLabel: string;
  capacity: number;
  parkedVehicles: number;
  occupied: Interval[];
  blocked: Interval[];
  gaps: GapResult[];
  notes: string[];
}

export interface GapAnalysis {
  objects: DetectedObject[];
  vehicles: number;
  parkedVehicles: number;
  lanes: LaneResult[];
  candidates: GapResult[];
  status: ParkingStatus;
  confidence: number;
  reason: string | null;
  notes: string[];
}

interface Lane {
  region: Region;
  toLane: Mat3;
  toImage: Mat3;
  capacity: number;
  slot: number;
}

const isVehicle = (o: DetectedObject) => (VEHICLE_LABELS as readonly string[]).includes(o.label);

function toLaneUV(lane: Lane, p: Point): Point | null {
  if (homographyW(lane.toLane, p) <= 0) return null;
  const uv = applyHomography(lane.toLane, p);
  return Number.isFinite(uv[0]) && Number.isFinite(uv[1]) ? uv : null;
}

/** Where the vehicle touches the road: just above the bottom-center of its box. */
function groundPoint(o: DetectedObject): Point {
  const h = o.box.ymax - o.box.ymin;
  return [(o.box.xmin + o.box.xmax) / 2, o.box.ymax - 0.04 * h];
}

/**
 * Tolerances for "this vehicle is in the lane". Generous on the curb side
 * (a box's bottom edge often sits over the sidewalk line), tight on the traffic
 * side so cars driving in the next lane are not counted as parked.
 */
const LANE_TOLERANCE = { uMin: -0.08, uMax: 1.08, vMin: -0.4, vMax: 1.1 };

function inLane(uv: Point | null): boolean {
  return (
    !!uv &&
    uv[0] >= LANE_TOLERANCE.uMin &&
    uv[0] <= LANE_TOLERANCE.uMax &&
    uv[1] >= LANE_TOLERANCE.vMin &&
    uv[1] <= LANE_TOLERANCE.vMax
  );
}

/** Interval of u a parked vehicle covers. */
function vehicleInterval(lane: Lane, o: DetectedObject): Interval | null {
  const g = groundPoint(o);
  const center = toLaneUV(lane, g);
  if (!center) return null;
  const left = toLaneUV(lane, [o.box.xmin, g[1]]);
  const right = toLaneUV(lane, [o.box.xmax, g[1]]);
  const length = lane.slot * (LENGTH_FACTOR[o.label] ?? 1);
  const span = left && right ? Math.abs(left[0] - right[0]) : 0;

  if (span >= 0.6 * length && left && right) {
    // Seen from the side: the bottom edge already spans the vehicle's length.
    return [Math.min(left[0], right[0]) - 0.03 * lane.slot, Math.max(left[0], right[0]) + 0.03 * lane.slot];
  }
  // Seen end-on: the bottom of the box is the near end; the body extends away
  // from the camera, i.e. toward where the image y decreases.
  const h = o.box.ymax - o.box.ymin;
  const up = toLaneUV(lane, [g[0], g[1] - 0.25 * h]);
  const dir = up ? Math.sign(up[0] - center[0]) : 0;
  const u = center[0];
  if (dir > 0) return [u - 0.1 * length, u + 0.9 * length];
  if (dir < 0) return [u - 0.9 * length, u + 0.1 * length];
  return [u - 0.5 * length, u + 0.5 * length];
}

/** u-range a region covers inside the lane, if any. */
function regionInterval(lane: Lane, poly: Point[]): Interval | null {
  const uvs = poly.map((p) => toLaneUV(lane, p)).filter((p): p is Point => !!p);
  if (uvs.length < 2) return null;
  const us = uvs.map((p) => p[0]);
  const vs = uvs.map((p) => p[1]);
  if (Math.max(...vs) < -0.3 || Math.min(...vs) > 1.3) return null;
  if (Math.max(...us) < 0 || Math.min(...us) > 1) return null;
  return [Math.min(...us), Math.max(...us)];
}

function boxOverlapFraction(poly: Point[], o: DetectedObject): number {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const gx0 = Math.min(...xs), gx1 = Math.max(...xs), gy0 = Math.min(...ys), gy1 = Math.max(...ys);
  const ix = Math.max(0, Math.min(gx1, o.box.xmax) - Math.max(gx0, o.box.xmin));
  const iy = Math.max(0, Math.min(gy1, o.box.ymax) - Math.max(gy0, o.box.ymin));
  const area = (gx1 - gx0) * (gy1 - gy0);
  return area > 0 ? (ix * iy) / area : 0;
}

function pixelDistance(a: Point, b: Point, opts: GapOptions): number {
  return Math.hypot((a[0] - b[0]) * opts.imageWidth, (a[1] - b[1]) * opts.imageHeight);
}

export function buildLanes(regions: Region[]): { lanes: Lane[]; notes: string[] } {
  const lanes: Lane[] = [];
  const notes: string[] = [];
  for (const region of regions) {
    if (region.kind !== 'parking') continue;
    const h = laneHomography(region.points);
    if (!h) {
      notes.push(`Lane "${region.label ?? region.id}" is not a valid 4-point quad; skipped.`);
      continue;
    }
    const capacity = Math.max(1, Math.round(region.capacity ?? 6));
    lanes.push({ region, ...h, capacity, slot: 1 / capacity });
  }
  return { lanes, notes };
}

/**
 * Analyze one frame. `objects` must use normalized coordinates (0..1).
 */
export function analyzeCurbGaps(
  objects: DetectedObject[],
  regions: Region[],
  options: Partial<GapOptions> = {},
): GapAnalysis {
  const opts = { ...DEFAULT_GAP_OPTIONS, ...options };
  const { lanes, notes } = buildLanes(regions);
  const ignore = regions.filter((r) => r.kind === 'ignore');
  const roadway = regions.filter((r) => r.kind === 'roadway');
  const restricted = regions.filter((r) => r.kind === 'restricted');

  const vehicles = objects.filter((o) => isVehicle(o) && o.score >= opts.minVehicleScore);
  const annotated: DetectedObject[] = [];
  const parkedByLane = new Map<string, DetectedObject[]>();

  for (const o of vehicles) {
    const g = groundPoint(o);
    let role: DetectedObject['role'] = 'outside';
    if (ignore.some((r) => pointInPolygon(g, r.points))) {
      role = 'ignored';
    } else {
      // Pick the lane whose v-center is closest to the vehicle footprint.
      let best: { lane: Lane; score: number } | null = null;
      for (const lane of lanes) {
        const uv = toLaneUV(lane, g);
        if (!inLane(uv)) continue;
        const score = Math.abs(uv![1] - 0.5);
        if (!best || score < best.score) best = { lane, score };
      }
      const onRoadway = roadway.some((r) => pointInPolygon(g, r.points));
      if (best && onRoadway && best.score > 0.35) {
        // Straddling the lane edge and inside the marked roadway: treat as traffic.
        role = 'roadway';
      } else if (best) {
        role = 'parked';
        const list = parkedByLane.get(best.lane.region.id) ?? [];
        list.push(o);
        parkedByLane.set(best.lane.region.id, list);
      } else if (onRoadway) {
        role = 'roadway';
      }
    }
    annotated.push({ ...o, role });
  }
  // Keep non-vehicle objects out of the stored result; they are noise for parking.

  if (lanes.length === 0) {
    return {
      objects: annotated,
      vehicles: vehicles.length,
      parkedVehicles: 0,
      lanes: [],
      candidates: [],
      status: 'unknown',
      confidence: 0,
      reason: 'needs_calibration',
      notes: [...notes, 'No parking lane is calibrated for this camera.'],
    };
  }

  const laneResults: LaneResult[] = [];
  const occluders = annotated.filter((o) => o.role === 'roadway' || o.role === 'outside');

  for (const lane of lanes) {
    const parked = parkedByLane.get(lane.region.id) ?? [];
    const laneNotes: string[] = [];
    const streetLabel = lane.region.streetLabel || lane.region.label || 'Curb lane';

    const occupied = mergeIntervals(
      parked.map((o) => vehicleInterval(lane, o)).filter((iv): iv is Interval => !!iv),
      0.02 * lane.slot,
    );
    const blocked = mergeIntervals(
      [...restricted, ...ignore]
        .map((r) => regionInterval(lane, r.points))
        .filter((iv): iv is Interval => !!iv),
    );
    const open = subtractIntervals(complementIntervals(occupied, 0, 1), blocked);
    const emptyLane = parked.length === 0 && lane.capacity >= 3;
    if (emptyLane) {
      laneNotes.push('No parked vehicles detected in this lane; may be a detection failure (night, glare, occlusion).');
    }

    const gaps: GapResult[] = [];
    for (const [a, b] of open) {
      const slots = (b - a) / lane.slot;
      if (slots < opts.possibleGapSlots) continue;
      const reasons: string[] = [];
      const atStart = a <= 0.001;
      const atEnd = b >= 0.999;
      const boundedBothSides = !atStart && !atEnd && !blocked.some(([x, y]) => Math.abs(x - b) < 1e-6 || Math.abs(y - a) < 1e-6);

      let confidence = 0.5;
      confidence += clamp((slots - 1) * 0.25, -0.15, 0.15);
      if (boundedBothSides) {
        confidence += 0.15;
        reasons.push('Opening between two parked vehicles');
      } else if (atStart && atEnd) {
        confidence -= 0.2;
        reasons.push('Whole lane looks empty');
      } else {
        reasons.push('Opening at the edge of the visible lane');
      }

      const pStart = applyHomography(lane.toImage, [a, 0.5]);
      const pEnd = applyHomography(lane.toImage, [b, 0.5]);
      const px = pixelDistance(pStart, pEnd, opts);
      const pxPerSlot = px / slots;
      if (px < opts.minGapPixels) {
        confidence -= 0.25;
        reasons.push(`Opening is only ${px.toFixed(0)} px on screen`);
      } else if (pxPerSlot < 8) {
        confidence -= 0.15;
        reasons.push('Far from the camera; hard to measure');
      } else if (px > 30) {
        confidence += 0.05;
      }

      const polygon: Point[] = [
        applyHomography(lane.toImage, [a, 0]),
        applyHomography(lane.toImage, [a, 1]),
        applyHomography(lane.toImage, [b, 1]),
        applyHomography(lane.toImage, [b, 0]),
      ];
      const occluded = occluders.some((o) => boxOverlapFraction(polygon, o) > 0.3);
      if (occluded) {
        confidence -= 0.3;
        reasons.push('A vehicle in the roadway may be hiding the curb');
      }
      if (emptyLane) confidence = Math.min(confidence, 0.3);

      const neighbors = parked.filter((o) => {
        const iv = vehicleInterval(lane, o);
        return !!iv && (Math.abs(iv[1] - a) < 0.5 * lane.slot || Math.abs(iv[0] - b) < 0.5 * lane.slot);
      });
      if (neighbors.length && neighbors.every((o) => o.score >= 0.85)) confidence += 0.05;

      confidence = clamp(confidence, 0.05, 0.95);
      const spaces = Math.max(1, Math.floor(slots + 0.15));
      const status = confidence >= opts.minConfidence && slots >= opts.likelyGapSlots ? 'likely_available' : 'possible';
      gaps.push({
        regionId: lane.region.id,
        streetLabel,
        start: clamp(a, 0, 1),
        end: clamp(b, 0, 1),
        slots: Number(slots.toFixed(2)),
        spaces,
        confidence: Number(confidence.toFixed(3)),
        status,
        boundedBothSides,
        polygon,
        reasons,
      });
    }
    laneResults.push({
      regionId: lane.region.id,
      streetLabel,
      capacity: lane.capacity,
      parkedVehicles: parked.length,
      occupied,
      blocked,
      gaps,
      notes: laneNotes,
    });
  }

  const candidates = laneResults.flatMap((l) => l.gaps).sort((p, q) => q.confidence - p.confidence);
  const parkedVehicles = laneResults.reduce((s, l) => s + l.parkedVehicles, 0);
  const allLanesEmpty = laneResults.every((l) => l.parkedVehicles === 0) && laneResults.some((l) => l.capacity >= 3);

  let status: ParkingStatus;
  let confidence: number;
  let reason: string | null = null;
  if (allLanesEmpty) {
    status = 'unknown';
    confidence = 0.2;
    reason = 'no_vehicles_detected';
  } else if (candidates.length) {
    status = candidates.some((c) => c.status === 'likely_available') ? 'likely_available' : 'possible';
    confidence = candidates[0]!.confidence;
  } else {
    status = 'none';
    // More parked cars seen => more sure the curb is full.
    confidence = clamp(0.5 + 0.08 * parkedVehicles, 0.5, 0.9);
  }

  return {
    objects: annotated,
    vehicles: vehicles.length,
    parkedVehicles,
    lanes: laneResults,
    candidates,
    status,
    confidence: Number(confidence.toFixed(3)),
    reason,
    notes: [...notes, ...laneResults.flatMap((l) => l.notes)],
  };
}

/**
 * Raise confidence for gaps that were also open in the previous analysis
 * (same lane, overlapping position). A gap that persists across frames is less
 * likely to be a car passing through or a detector miss.
 */
export function applyTemporalConsistency(
  current: GapResult[],
  previous: Pick<GapResult, 'regionId' | 'start' | 'end'>[],
  minConfidence: number,
  likelyGapSlots = DEFAULT_GAP_OPTIONS.likelyGapSlots,
): GapResult[] {
  return current.map((gap) => {
    const seen = previous.some((p) => {
      if (p.regionId !== gap.regionId) return false;
      const overlap = Math.min(p.end, gap.end) - Math.max(p.start, gap.start);
      const union = Math.max(p.end, gap.end) - Math.min(p.start, gap.start);
      return union > 0 && overlap / union > 0.3;
    });
    if (!seen) return gap;
    const confidence = Number(clamp(gap.confidence + 0.1, 0.05, 0.95).toFixed(3));
    return {
      ...gap,
      confidence,
      status: confidence >= minConfidence && gap.slots >= likelyGapSlots ? 'likely_available' : 'possible',
      reasons: [...gap.reasons, 'Also open in the previous check'],
    };
  });
}
