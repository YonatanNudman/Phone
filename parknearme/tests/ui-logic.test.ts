import { describe, expect, it } from 'vitest';
import { editorReducer, initialEditor, regionProblem, regionsForSave } from '../src/pages/calibrate/editor';
import { mergeDetection } from '../src/hooks/useParking';
import { detectionChip, historySummary } from '../src/lib/detection';
import { base64UrlToBytes } from '../src/lib/push';
import { reasonText, formatClock } from '../src/lib/format';

describe('editor', () => {
  it('creates a parking lane after 4 clicks and ignores duplicate clicks', () => {
    let s = editorReducer(initialEditor([]), { type: 'tool', tool: 'parking' });
    for (const p of [[0.1, 0.9], [0.1, 0.9], [0.3, 0.9], [0.4, 0.5], [0.35, 0.5]] as [number, number][]) s = editorReducer(s, { type: 'addPoint', point: p, newId: 'lane-1' });
    expect(s.regions).toHaveLength(1);
    expect(s.regions[0]!.points).toHaveLength(4);
    expect(s.selectedId).toBe('lane-1');
    expect(s.tool).toBe('select');
    expect(s.dirty).toBe(true);
    expect(regionProblem(s.regions[0]!)).toBeNull();
  });
  it('flags a self-intersecting lane', () => {
    let s = editorReducer(initialEditor([]), { type: 'tool', tool: 'parking' });
    for (const p of [[0.1, 0.9], [0.4, 0.5], [0.3, 0.9], [0.35, 0.5]] as [number, number][]) s = editorReducer(s, { type: 'addPoint', point: p, newId: 'x' });
    expect(regionProblem(s.regions[0]!)).toMatch(/cross/);
  });
  it('finishes polygons only with 3+ points', () => {
    let s = editorReducer(initialEditor([]), { type: 'tool', tool: 'restricted' });
    s = editorReducer(s, { type: 'addPoint', point: [0.1, 0.1], newId: 'r' });
    s = editorReducer(s, { type: 'addPoint', point: [0.2, 0.1], newId: 'r' });
    expect(editorReducer(s, { type: 'finish', newId: 'r' }).regions).toHaveLength(0);
    s = editorReducer(s, { type: 'addPoint', point: [0.2, 0.2], newId: 'r' });
    s = editorReducer(s, { type: 'finish', newId: 'r' });
    expect(s.regions[0]!.kind).toBe('restricted');
    const saved = regionsForSave(s.regions);
    expect(saved[0]).not.toHaveProperty('capacity');
    expect(saved[0]).not.toHaveProperty('streetLabel');
  });
  it('regionsForSave drops empty street labels and keeps capacity', () => {
    const out = regionsForSave([{ id: 'a', kind: 'parking', points: [[0, 0], [0, 1], [1, 1], [1, 0]], streetLabel: '  ', capacity: 7 }]);
    expect(out[0]).toEqual({ id: 'a', kind: 'parking', points: [[0, 0], [0, 1], [1, 1], [1, 0]], capacity: 7 });
  });
});

describe('mergeDetection', () => {
  const now = new Date().toISOString();
  const cam = (id: string) => ({ id, name: id, area: null, lat: 40.85, lon: -73.93, catalogOnline: true, distanceMi: 0.2, preference: { usefulness: 'yes', notes: null, streetLabel: null, updatedAt: null }, calibrated: true, frame: { lastHash: null, lastFetchedAt: now, lastChangedAt: now, consecutiveFailures: 0, lastError: null, freshness: 'live' }, latest: null, latestAgeSeconds: null }) as never;
  const base = { generatedAt: now, home: { address: '', lat: 40.85, lon: -73.93, source: '', geocodedAt: now }, radiusMi: 0.5, minConfidence: 0.6, summary: { state: 'unknown', spots: 0, headline: '', updatedAt: null }, candidates: [], watched: [cam('a'), cam('b')], nearby: [cam('a'), cam('b')] } as never;
  const det = (cameraId: string, spaces: number, extra = {}) => ({ id: 1, cameraId, timestamp: now, frameFetchedAt: now, frameHash: null, freshness: 'live', detector: 'x', vehiclesDetected: 3, parkedVehicles: 3, candidateSpaces: spaces, confidence: 0.8, status: spaces ? 'likely_available' : 'none', reason: null, objects: [], notes: [], error: null, candidates: spaces ? [{ cameraId, regionId: 'r', streetLabel: 'X', spaces, confidence: 0.8, status: 'likely_available', gapStart: 0, gapEnd: 0.2, polygon: [], lat: 1, lon: 2, approximateLocation: true, reasons: [] }] : [], ...extra }) as never;
  it('adds candidates and updates the headline', () => {
    const r = mergeDetection(base, det('a', 2));
    expect(r.candidates).toHaveLength(1);
    expect(r.summary.state).toBe('available');
    expect(r.watched[0]!.latest).not.toBeNull();
  });
  it('replaces candidates for the same camera and ignores stale frames', () => {
    let r = mergeDetection(base, det('a', 2));
    r = mergeDetection(r, det('a', 0));
    expect(r.candidates).toHaveLength(0);
    expect(r.summary.state).toBe('none');
    r = mergeDetection(r, det('b', 1, { freshness: 'stale' }));
    expect(r.candidates).toHaveLength(0);
  });
});

describe('helpers', () => {
  it('chips and history text', () => {
    expect(detectionChip(null, Date.now()).text).toBe('Not checked');
    expect(historySummary({ status: 'possible', candidateSpaces: 1, reason: null })).toBe('1 possible spot');
    expect(historySummary({ status: 'unknown', candidateSpaces: 0, reason: 'needs_calibration' })).toBe('not calibrated');
    expect(reasonText('no_vehicles_detected')).toMatch(/dark or glare/);
    expect(formatClock('2026-10-07T04:42:00Z')).toBe('12:42 AM');
  });
  it('decodes VAPID keys', () => {
    const k = base64UrlToBytes('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U');
    expect(k.length).toBe(65);
    expect(k[0]).toBe(4);
  });
});
