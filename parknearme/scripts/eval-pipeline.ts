// Offline evaluation: run the production gap analysis over real frames.
//
// Inputs (produced by the camera-discovery GitHub Action):
//   feasibility/discovery.json   - cameras + frame list
//   feasibility/detections.json  - DETR boxes per frame (same model as Workers AI)
//   seed/calibrations.json       - lane polygons drawn on those frames
// Output: a per-frame table on stdout and feasibility/eval.json.
//
// Run: npm run eval

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeCurbGaps, applyTemporalConsistency } from '../shared/curb-gaps';
import type { Region } from '../shared/types';
import { cleanVehicles, parseObjectDetections } from '../worker/analysis/vehicles';

// Run from the project root (npm run eval).
const root = process.cwd();
const read = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));

interface FrameDetections {
  n: number;
  file: string;
  detr: unknown[];
}

const detections = read('feasibility/detections.json') as Record<string, { name: string; distanceMi: number; frames: FrameDetections[] }>;
const seed = read('seed/calibrations.json') as { cameras: Record<string, { regions: Region[]; referenceWidth: number; referenceHeight: number }> };

const out: unknown[] = [];
for (const [cameraId, cal] of Object.entries(seed.cameras)) {
  const cam = detections[cameraId];
  if (!cam) {
    console.log(`No recorded detections for ${cameraId}`);
    continue;
  }
  console.log(`\n${cam.name} (${cam.distanceMi} mi) [${cameraId}]`);
  let previous: { regionId: string; start: number; end: number }[] = [];
  for (const frame of cam.frames) {
    const objects = cleanVehicles(parseObjectDetections(frame.detr, cal.referenceWidth, cal.referenceHeight), 0.5);
    const result = analyzeCurbGaps(objects, cal.regions, { imageWidth: cal.referenceWidth, imageHeight: cal.referenceHeight });
    const gaps = applyTemporalConsistency(result.candidates, previous, 0.6);
    previous = gaps.map((g) => ({ regionId: g.regionId, start: g.start, end: g.end }));
    const lanes = result.lanes
      .map((l) => `${l.regionId}: ${l.parkedVehicles} parked, occupied ${l.occupied.map(([a, b]) => `${a.toFixed(2)}-${b.toFixed(2)}`).join(',')}`)
      .join(' | ');
    console.log(
      `  frame ${frame.n}: ${result.vehicles} vehicles, status=${result.status} conf=${result.confidence}` +
        (result.reason ? ` reason=${result.reason}` : '') +
        `\n    ${lanes}` +
        gaps.map((g) => `\n    gap ${g.start.toFixed(2)}-${g.end.toFixed(2)} slots=${g.slots} spaces=${g.spaces} conf=${g.confidence} ${g.status} :: ${g.reasons.join('; ')}`).join(''),
    );
    out.push({ cameraId, frame: frame.n, file: frame.file, status: result.status, vehicles: result.vehicles, parked: result.parkedVehicles, gaps, roles: result.objects.map((o) => o.role) });
  }
}
writeFileSync(join(root, 'feasibility/eval.json'), JSON.stringify(out, null, 1));
