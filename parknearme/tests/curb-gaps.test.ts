import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeCurbGaps, applyTemporalConsistency } from '../shared/curb-gaps';
import type { DetectedObject, Region } from '../shared/types';
import { cleanVehicles, parseObjectDetections } from '../worker/analysis/vehicles';

// Side-on view of a curb lane: u runs along x from 0.1 to 0.9, capacity 8 => one slot = 0.1 in x.
const lane: Region = {
  id: 'lane',
  kind: 'parking',
  streetLabel: 'Test St',
  capacity: 8,
  points: [[0.1, 0.8], [0.1, 0.6], [0.9, 0.6], [0.9, 0.8]],
};
const roadway: Region = { id: 'road', kind: 'roadway', points: [[0.05, 0.6], [0.95, 0.6], [0.95, 0.3], [0.05, 0.3]] };

const car = (x0: number, x1: number, score = 0.95, label = 'car', y1 = 0.76): DetectedObject => ({
  label,
  score,
  box: { xmin: x0, ymin: y1 - 0.12, xmax: x1, ymax: y1 },
});

// A row of parked cars with one 0.15-wide (1.5 slot) opening between x = 0.40 and 0.55.
const rowWithGap = [car(0.1, 0.19), car(0.2, 0.29), car(0.3, 0.39), car(0.55, 0.64), car(0.65, 0.74), car(0.75, 0.84), car(0.85, 0.9)];

describe('analyzeCurbGaps', () => {
  it('finds a likely space between two parked cars', () => {
    const r = analyzeCurbGaps(rowWithGap, [lane, roadway]);
    expect(r.parkedVehicles).toBe(7);
    expect(r.status).toBe('likely_available');
    expect(r.candidates).toHaveLength(1);
    const gap = r.candidates[0]!;
    expect(gap.spaces).toBe(1);
    expect(gap.boundedBothSides).toBe(true);
    expect(gap.slots).toBeGreaterThan(1.2);
    expect(gap.slots).toBeLessThan(1.8);
    expect(gap.confidence).toBeGreaterThanOrEqual(0.6);
    // Gap polygon lies inside the image, over the opening.
    const xs = gap.polygon.map((p) => p[0]);
    expect(Math.min(...xs)).toBeGreaterThan(0.38);
    expect(Math.max(...xs)).toBeLessThan(0.57);
  });

  it('reports a full curb as none', () => {
    const full = [...rowWithGap, car(0.42, 0.53)];
    const r = analyzeCurbGaps(full, [lane]);
    expect(r.status).toBe('none');
    expect(r.candidates).toHaveLength(0);
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('never offers a space inside a RESTRICTED zone (e.g. hydrant)', () => {
    const hydrant: Region = { id: 'hydrant', kind: 'restricted', points: [[0.4, 0.82], [0.56, 0.82], [0.56, 0.58], [0.4, 0.58]] };
    const r = analyzeCurbGaps(rowWithGap, [lane, hydrant]);
    expect(r.candidates).toHaveLength(0);
    expect(r.status).toBe('none');
  });

  it('shrinks a gap partly covered by a restricted zone below one car', () => {
    const driveway: Region = { id: 'driveway', kind: 'restricted', points: [[0.44, 0.82], [0.5, 0.82], [0.5, 0.58], [0.44, 0.58]] };
    const r = analyzeCurbGaps(rowWithGap, [lane, driveway]);
    expect(r.candidates.every((c) => c.slots < 1)).toBe(true);
  });

  it('ignores vehicles inside IGNORE regions', () => {
    const ignore: Region = { id: 'ign', kind: 'ignore', points: [[0.0, 0.9], [0.2, 0.9], [0.2, 0.5], [0.0, 0.5]] };
    const r = analyzeCurbGaps(rowWithGap, [lane, ignore]);
    expect(r.objects.find((o) => o.box.xmin === 0.1)?.role).toBe('ignored');
  });

  it('treats cars driving in the roadway as traffic, not parked', () => {
    const moving = car(0.42, 0.53, 0.95, 'car', 0.5);
    const r = analyzeCurbGaps([...rowWithGap, moving], [lane, roadway]);
    expect(r.objects.find((o) => o === moving || o.box.ymax === 0.5)?.role).toBe('roadway');
    expect(r.parkedVehicles).toBe(7);
  });

  it('lowers confidence when a vehicle in the roadway hides the curb', () => {
    // Far-side curb: the travel lane is between the camera and the parking lane.
    const farLane: Region = { ...lane, points: [[0.1, 0.4], [0.1, 0.6], [0.9, 0.6], [0.9, 0.4]] };
    const nearRoad: Region = { id: 'road', kind: 'roadway', points: [[0.05, 0.6], [0.95, 0.6], [0.95, 0.95], [0.05, 0.95]] };
    const row = rowWithGap.map((c) => ({ ...c, box: { ...c.box, ymin: 0.42, ymax: 0.54 } }));
    const bus: DetectedObject = { label: 'bus', score: 0.9, box: { xmin: 0.36, ymin: 0.35, xmax: 0.6, ymax: 0.85 } };
    const clear = analyzeCurbGaps(row, [farLane, nearRoad]).candidates[0]!;
    const hidden = analyzeCurbGaps([...row, bus], [farLane, nearRoad]);
    expect(hidden.objects.find((o) => o.label === 'bus')?.role).toBe('roadway');
    expect(hidden.candidates[0]!.confidence).toBeLessThan(clear.confidence);
    expect(hidden.candidates[0]!.reasons.join(' ')).toMatch(/hiding the curb/);
  });

  it('asks for calibration when no parking lane exists', () => {
    const r = analyzeCurbGaps(rowWithGap, [roadway]);
    expect(r).toMatchObject({ status: 'unknown', reason: 'needs_calibration', candidates: [] });
  });

  it('does not claim an empty street when no cars are detected (likely detector failure)', () => {
    const r = analyzeCurbGaps([], [lane]);
    expect(r.status).toBe('unknown');
    expect(r.reason).toBe('no_vehicles_detected');
  });

  it('skips invalid lane quads with a note', () => {
    const bad: Region = { ...lane, id: 'bad', points: [[0, 0], [1, 1], [1, 0], [0, 1]] };
    const r = analyzeCurbGaps(rowWithGap, [bad]);
    expect(r.reason).toBe('needs_calibration');
    expect(r.notes.join(' ')).toMatch(/not a valid 4-point quad/);
  });
});

describe('applyTemporalConsistency', () => {
  it('boosts gaps that were also open in the previous check', () => {
    const [gap] = analyzeCurbGaps(rowWithGap, [lane]).candidates;
    const [boosted] = applyTemporalConsistency([gap!], [{ regionId: 'lane', start: gap!.start + 0.01, end: gap!.end }], 0.6);
    expect(boosted!.confidence).toBeCloseTo(Math.min(0.95, gap!.confidence + 0.1), 3);
    expect(boosted!.reasons).toContain('Also open in the previous check');
    const [same] = applyTemporalConsistency([gap!], [{ regionId: 'other', start: gap!.start, end: gap!.end }], 0.6);
    expect(same).toEqual(gap);
  });
});

describe('real frames (Audubon Ave @ W 181 St, 2026-10-07 00:26 EDT)', () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/audubon-181-night.json', 'utf8'));

  it.each([0, 1, 2, 3, 4])('frame %i: counts the parked row and only reports low-confidence far gaps', (n) => {
    const frame = fixture.frames[n];
    const vehicles = cleanVehicles(parseObjectDetections(frame.detr, 352, 240), 0.5);
    const r = analyzeCurbGaps(vehicles, fixture.calibration.regions);
    expect(r.parkedVehicles).toBeGreaterThanOrEqual(7);
    expect(r.status).not.toBe('likely_available');
    for (const c of r.candidates) expect(c.confidence).toBeLessThan(0.6);
  });
});
