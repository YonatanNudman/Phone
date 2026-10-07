// Shared setup for API tests: a fresh D1 shim, a fake TMC + geocoder behind a
// stubbed global fetch, a fake Workers AI binding that returns recorded DETR
// boxes, and an execution context whose waitUntil promises can be awaited.
// Nothing touches the network.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import type { Region } from '../../shared/types';
import { DETR_MODEL } from '../../worker/analysis/detectors';
import type { Env } from '../../worker/env';
import { createApp } from '../../worker/index';
import { createTestDb, type TestDb } from './d1';

export const ADMIN_TOKEN = 'x'.repeat(32);
export const HOME = { lat: 40.851304, lon: -73.930153 };

/** Real cameras near 403 Audubon Ave (from feasibility/discovery.json). */
export const CAM = {
  audubon: '1ccb8d7c-43d4-450e-b40c-79527766db75',
  amsterdam: '4d39d6d1-a009-480f-9851-2571a5df1174',
  stNicholas: '3ad126cc-3f99-4626-a229-b9ba4d3f4b63',
  centralParkWest: '8a6bc417-4877-4ebe-8052-88c1b261baf1',
} as const;

const entry = (id: string, name: string, latitude: number, longitude: number, isOnline = 'true') => ({
  id,
  name,
  latitude,
  longitude,
  area: 'Manhattan',
  isOnline,
  imageUrl: `https://webcams.nyctmc.org/api/cameras/${id}/image`,
});

/** Same shape as the real catalog; St Nicholas is offline, Central Park West is ~5 mi away. */
export const CATALOG = [
  entry(CAM.centralParkWest, 'Central Park West @ 86 St', 40.785302, -73.969353),
  entry(CAM.stNicholas, 'St Nicholas Ave @ 181 St', 40.849314, -73.933739, 'false'),
  entry(CAM.audubon, 'Audobon Ave @ W 181 ST', 40.848738, -73.932353),
  entry(CAM.amsterdam, 'Amsterdam Ave @ 181 St', 40.84833, -73.930868),
];

interface Fixture {
  calibration: { referenceWidth: number; referenceHeight: number; regions: Region[] };
  frames: { n: number; detr: unknown[] }[];
}

/** Real DETR output + seed calibration for the Audubon camera (tests/fixtures). */
export const AUDUBON = JSON.parse(readFileSync('tests/fixtures/audubon-181-night.json', 'utf8')) as Fixture;
/** A real 352x240 frame from the Audubon camera. */
export const FRAME = new Uint8Array(readFileSync('tests/fixtures/audubon-181-frame0.jpg'));
export const FRAME_HASH = createHash('sha256').update(FRAME).digest('hex');

export type FrameMode = 'ok' | 'http_500' | 'html' | 'tiny' | 'timeout';

export interface Harness {
  db: TestDb;
  env: Env;
  ai: { run: ReturnType<typeof vi.fn> };
  fetch: ReturnType<typeof vi.fn>;
  /** Per-camera upstream behavior for /image (default "ok"). */
  frameMode: Map<string, FrameMode>;
  catalogMode: { ok: boolean };
  /** URLs the fake network did not recognize (should stay empty). */
  unexpected: string[];
  /** Calls the app; `admin` adds the bearer token, `json` sends a JSON body. */
  call(path: string, init?: RequestInit & { admin?: boolean; json?: unknown }): Promise<Response>;
  /** Wait for everything passed to ctx.waitUntil so far. */
  settle(): Promise<void>;
  ctx: { waitUntil(p: Promise<unknown>): void; passThroughOnException(): void; props: Record<string, never> };
}

function frameResponse(mode: FrameMode): Response {
  switch (mode) {
    case 'ok':
      return new Response(FRAME.slice(), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' } });
    case 'http_500':
      return new Response('upstream broke', { status: 500 });
    case 'html':
      return new Response('<html>' + ' '.repeat(4000) + '</html>', { headers: { 'Content-Type': 'text/html' } });
    case 'tiny':
      return new Response(FRAME.slice(0, 500), { headers: { 'Content-Type': 'image/jpeg' } });
    case 'timeout':
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  }
}

export function createHarness(overrides: Partial<Env> = {}): Harness {
  const db = createTestDb();
  const frameMode = new Map<string, FrameMode>();
  const catalogMode = { ok: true };
  const unexpected: string[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === 'geosearch.planninglabs.nyc') {
      return Response.json({ features: [{ geometry: { type: 'Point', coordinates: [HOME.lon, HOME.lat] } }] });
    }
    if (url.hostname === 'webcams.nyctmc.org') {
      if (url.pathname === '/api/cameras/') return catalogMode.ok ? Response.json(CATALOG) : new Response('down', { status: 503 });
      const image = /^\/api\/cameras\/([^/]+)\/image$/.exec(url.pathname);
      if (image) return frameResponse(frameMode.get(image[1]!) ?? 'ok');
    }
    unexpected.push(url.href);
    throw new TypeError(`fetch failed: unexpected URL ${url.href}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  const ai = {
    run: vi.fn(async (model: string) => {
      if (model === DETR_MODEL) return AUDUBON.frames[0]!.detr;
      throw new Error(`unexpected model ${model}`);
    }),
  };
  const env: Env = { DB: db.d1, ADMIN_TOKEN, AI: ai as unknown as Ai, ...overrides };

  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException: () => {}, props: {} };
  const app = createApp();

  return {
    db,
    env,
    ai,
    fetch: fetchMock,
    frameMode,
    catalogMode,
    unexpected,
    ctx,
    async call(path, init = {}) {
      const { admin, json, ...rest } = init;
      const headers = new Headers(rest.headers);
      if (admin) headers.set('Authorization', `Bearer ${ADMIN_TOKEN}`);
      let body = rest.body;
      if (json !== undefined) {
        headers.set('Content-Type', 'application/json');
        body = JSON.stringify(json);
      }
      return app.request(path, { ...rest, headers, body }, env, ctx);
    },
    async settle() {
      await Promise.allSettled(pending.splice(0));
    },
  };
}

/** Admin calls that put a camera into the "watched + calibrated" state. */
export async function watchAndCalibrate(h: Harness, cameraId: string = CAM.audubon): Promise<void> {
  const cal = await h.call(`/api/cameras/${cameraId}/calibration`, { method: 'POST', admin: true, json: AUDUBON.calibration });
  if (cal.status !== 200) throw new Error(`calibration failed: ${cal.status} ${await cal.text()}`);
  const pref = await h.call(`/api/cameras/${cameraId}/usefulness`, { method: 'POST', admin: true, json: { usefulness: 'yes' } });
  if (pref.status !== 200) throw new Error(`usefulness failed: ${pref.status} ${await pref.text()}`);
}

/** Pretend every stored detection of a camera happened `seconds` earlier. */
export function ageDetections(h: Harness, cameraId: string, seconds: number): void {
  const rows = h.db.sqlite.prepare('SELECT id, analyzed_at FROM detections WHERE camera_id = ?').all(cameraId) as { id: number; analyzed_at: string }[];
  const update = h.db.sqlite.prepare('UPDATE detections SET analyzed_at = ? WHERE id = ?');
  for (const r of rows) update.run(new Date(Date.parse(r.analyzed_at) - seconds * 1000).toISOString(), r.id);
}
