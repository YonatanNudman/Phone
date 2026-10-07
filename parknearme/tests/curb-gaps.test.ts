import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeCurbGaps, laneDiagnostics, type LaneStates } from '../shared/curb-gaps';
import type { DetectedObject, Region } from '../shared/types';
import { cleanVehicles, parseObjectDetections } from '../worker/analysis/vehicles';
import { acrossStreet, downTheCurb } from './helpers/scene';

const T0 = Date.parse('2026-10-07T12:00:00Z');

/** Run the analyzer over several frames, 20 s apart, carrying the lane state. */
function runFrames(frames: DetectedObject[][], regions: Region[], extra: Partial<Parameters<typeof analyzeCurbGaps>[2]> = {}) {
  let state: LaneStates | undefined = extra?.state;
  let last = analyzeCurbGaps([], regions, { nowMs: T0 });
  frames.forEach((objects, k) => {
    last = analyzeCurbGaps(objects, regions, { ...extra, nowMs: T0 + k * 20_000, state });
    state = last.state;
  });
  return last;
}

describe('curb-gap analysis on a synthetic street', () => {
  // Truth: 6-space lane (36.6 m); cars at 0.5, 6.0, 18.6, 24.4, 30.4 m => a 7.9 m opening at 10.7–18.6 m.
  const gapCars = (s: ReturnType<typeof acrossStreet>) => [0.5, 6.0, 18.6, 24.4, 30.4].map((m) => s.car(m));
  const fullCars = (s: ReturnType<typeof acrossStreet>) => [0.5, 6.6, 12.7, 18.8, 24.9, 31.0].map((m) => s.car(m));

  it('finds the opening where it really is, and grows more confident as it persists', () => {
    const s = acrossStreet();
    const one = runFrames([gapCars(s)], [s.lane]);
    const five = runFrames(Array(5).fill(gapCars(s)), [s.lane]);
    expect(five.status).toBe('possible');
    const gap = five.candidates[0]!;
    expect(gap.start * s.lengthM).toBeGreaterThan(9.5);
    expect(gap.start * s.lengthM).toBeLessThan(12);
    expect(gap.end * s.lengthM).toBeGreaterThan(17.5);
    expect(gap.end * s.lengthM).toBeLessThan(20);
    expect(gap.lengthM).toBeGreaterThan(6.5);
    expect(gap.lengthM).toBeLessThan(9.5);
    expect(gap.spaces).toBe(1);
    expect(gap.boundedBothSides).toBe(true);
    expect(gap.confidence).toBeGreaterThan(one.candidates[0]?.confidence ?? 0);
  });

  it('calls a long opening (two spaces) possible after one look and likely once it persists', () => {
    const s = acrossStreet();
    const cars = [0.5, 6.0, 24.4, 30.4].map((m) => s.car(m)); // 13.8 m open
    expect(runFrames([cars], [s.lane]).status).toBe('possible');
    const r = runFrames(Array(5).fill(cars), [s.lane]);
    expect(r.status).toBe('likely_available');
    expect(r.candidates[0]!.spaces).toBe(2);
  });

  it('reports a full curb as none', () => {
    const s = acrossStreet();
    const r = runFrames(Array(3).fill(fullCars(s)), [s.lane]);
    expect(r.status).toBe('none');
    expect(r.candidates).toHaveLength(0);
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('never offers a space inside a RESTRICTED zone (hydrant, driveway, bus stop)', () => {
    const s = acrossStreet();
    const r = runFrames(Array(5).fill(gapCars(s)), [s.lane, s.zone('hydrant', 'restricted', 10, 19.5)]);
    expect(r.candidates).toHaveLength(0);
  });

  it('needs less room next to a physical end than between two cars', () => {
    const s = acrossStreet();
    const r = runFrames(Array(5).fill(gapCars(s)), [s.lane, s.zone('driveway', 'restricted', 10, 12.5)]);
    for (const c of r.candidates) expect(c.needM).toBe(5.6);
  });

  it('does not treat curb hidden behind a bus in the travel lane as free', () => {
    const s = acrossStreet();
    const bus: DetectedObject = { label: 'bus', score: 0.9, box: s.cuboidBox(8, 21, 3.2, 5.8, 3.2) };
    const r = runFrames(Array(5).fill([...gapCars(s), bus]), [s.lane]);
    expect(r.objects.find((o) => o.label === 'bus')?.role).toBe('roadway');
    expect(r.candidates.filter((c) => c.start * s.lengthM < 18 && c.end * s.lengthM > 11)).toHaveLength(0);
  });

  it('looking down the curb, a single frame is not enough (cars hide the curb behind them)', () => {
    const s = downTheCurb();
    expect(runFrames([gapCars(s)], [s.lane]).status).toBe('none');
    const later = runFrames(Array(6).fill(gapCars(s)), [s.lane]);
    expect(later.candidates.length).toBeGreaterThan(0);
  });

  it('marks vehicles in IGNORE regions as ignored', () => {
    const s = acrossStreet();
    const r = analyzeCurbGaps(gapCars(s), [s.lane, s.zone('ign', 'ignore', 0, 5.5)], { nowMs: T0 });
    expect(r.objects[0]!.role).toBe('ignored');
    expect(r.objects[1]!.role).toBe('parked');
  });

  it('splits one box that covers two bumper-to-bumper cars (side-ish view)', () => {
    const s = acrossStreet();
    const merged: DetectedObject = { label: 'car', score: 0.9, box: s.cuboidBox(18.6, 18.6 + 4.7 + 0.8 + 4.7, 0.3, 2.1, 1.5) };
    const r = analyzeCurbGaps([s.car(0.5), merged], [s.lane], { nowMs: T0 });
    const occupied = r.lanes[0]!.occupied.map(([a, b]) => [a * s.lengthM, b * s.lengthM]);
    const covering = occupied.find(([a]) => a! > 15 && a! < 22)!;
    expect(covering[1]! - covering[0]!).toBeGreaterThan(8);
  });

  it('says "unknown" instead of "empty street" when no cars are detected (night, glare)', () => {
    const s = acrossStreet();
    const r = runFrames([[], []], [s.lane]);
    expect(r).toMatchObject({ status: 'unknown', reason: 'no_vehicles_detected', candidates: [] });
  });

  it('forgets old evidence: a gap seen hours ago is not reported during a blind spell', () => {
    const s = acrossStreet();
    const seen = runFrames(Array(5).fill([0.5, 6.0, 24.4, 30.4].map((m) => s.car(m))), [s.lane]);
    expect(seen.candidates.length).toBeGreaterThan(0);
    const later = analyzeCurbGaps([], [s.lane], { nowMs: T0 + 3 * 3600_000, state: seen.state });
    expect(later.candidates).toHaveLength(0);
  });

  it('discards saved state when the lane is redrawn', () => {
    const s = acrossStreet();
    const seen = runFrames(Array(5).fill([0.5, 6.0, 24.4, 30.4].map((m) => s.car(m))), [s.lane]);
    const moved: Region = { ...s.lane, points: s.lane.points.map(([x, y]) => [x + 0.01, y] as [number, number]) };
    const r = analyzeCurbGaps(fullCars(s), [moved], { nowMs: T0 + 20_000, state: seen.state });
    expect(r.candidates).toHaveLength(0);
  });

  it('asks for calibration when no parking lane exists, and skips invalid quads', () => {
    const s = acrossStreet();
    expect(analyzeCurbGaps(gapCars(s), [], { nowMs: T0 })).toMatchObject({ status: 'unknown', reason: 'needs_calibration' });
    const bad: Region = { ...s.lane, id: 'bad', points: [[0, 0], [1, 1], [1, 0], [0, 1]] };
    const r = analyzeCurbGaps(gapCars(s), [bad], { nowMs: T0 });
    expect(r.reason).toBe('needs_calibration');
    expect(r.notes.join(' ')).toMatch(/not a valid 4-point quad/);
  });

  it('reports lane geometry diagnostics for the calibration screen', () => {
    const d = laneDiagnostics(downTheCurb().lane)!;
    expect(d.lengthM).toBeCloseTo(36.6, 5);
    expect(d.pxPerMetreStart).toBeGreaterThan(d.pxPerMetreEnd); // nearer is bigger
    expect(d.calibrationSigmaM).toBeLessThan(2);
  });
});

describe('real frames (Audubon Ave @ W 181 St, 2026-10-07 00:26 EDT)', () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/audubon-181-night.json', 'utf8'));

  it('sees a packed curb at night: many parked cars, no openings', () => {
    let state: LaneStates | undefined;
    for (const [k, frame] of (fixture.frames as { detr: unknown[] }[]).entries()) {
      const vehicles = cleanVehicles(parseObjectDetections(frame.detr, 352, 240), 0.35);
      const r = analyzeCurbGaps(vehicles, fixture.calibration.regions, { nowMs: T0 + k * 4000, state });
      state = r.state;
      expect(r.parkedVehicles).toBeGreaterThanOrEqual(7);
      expect(r.status).toBe('none');
    }
  });
});
