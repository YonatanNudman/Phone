// Camera frames: fetched from TMC, shared for 3 s through the Workers Cache
// API (so several viewers or an analysis right after a view cost one upstream
// request), and tracked in camera_frame_state for LIVE / STALE / OFFLINE.
// Frame state is written only when the hash changes, after a failure, or when
// the stored row is more than 10 s old, to keep D1 writes low.

import { frameFreshness, nextFrameState } from '../../shared/freshness';
import type { Camera, FrameState } from '../../shared/types';
import type { Frame } from '../analysis/detector';
import { getFrameStateRow, putFrameState, type FrameStateRow } from '../db';
import type { Env } from '../env';
import { errorMessage, type Background } from '../http';
import { fetchFrame, TmcError } from '../tmc';

const CACHE_ORIGIN = 'https://frames.parknearme.internal';
const CACHE_TTL_SECONDS = 3;
const STATE_WRITE_INTERVAL_MS = 10_000;

export type CameraFrameBytes = Frame & { bytes: Uint8Array<ArrayBuffer> };

export interface CameraFrame {
  frame: CameraFrameBytes;
  state: FrameState;
}

export function frameStateFromRow(row: FrameStateRow | null | undefined, catalogOnline: boolean, now = new Date()): FrameState {
  const base = {
    lastHash: row?.last_hash ?? null,
    lastFetchedAt: row?.last_fetched_at ?? null,
    lastChangedAt: row?.last_changed_at ?? null,
    consecutiveFailures: row?.consecutive_failures ?? 0,
    lastError: row?.last_error ?? null,
  };
  return { ...base, freshness: frameFreshness({ catalogOnline, ...base }, now) };
}

function frameCache(): Cache | null {
  return typeof caches !== 'undefined' && caches.default ? caches.default : null;
}

async function readCachedFrame(cache: Cache, key: string, cameraId: string): Promise<CameraFrameBytes | null> {
  const hit = await cache.match(key);
  if (!hit) return null;
  const width = Number(hit.headers.get('X-Frame-Width'));
  const height = Number(hit.headers.get('X-Frame-Height'));
  const hash = hit.headers.get('X-Frame-Hash');
  const fetchedAt = hit.headers.get('X-Frame-Fetched-At');
  if (!hash || !fetchedAt || !(width > 0) || !(height > 0)) return null;
  return { cameraId, bytes: new Uint8Array(await hit.arrayBuffer()), width, height, hash, fetchedAt };
}

function cacheResponse(frame: CameraFrameBytes): Response {
  return new Response(frame.bytes, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
      'X-Frame-Width': String(frame.width),
      'X-Frame-Height': String(frame.height),
      'X-Frame-Hash': frame.hash,
      'X-Frame-Fetched-At': frame.fetchedAt,
    },
  });
}

function shouldWriteState(prev: FrameStateRow | null, nextHash: string, now: number): boolean {
  if (!prev || !prev.last_fetched_at) return true;
  if (prev.last_hash !== nextHash || prev.consecutive_failures > 0) return true;
  return now - Date.parse(prev.last_fetched_at) > STATE_WRITE_INTERVAL_MS;
}

/** Current frame for a stored camera. Throws TmcError when the camera can't be fetched. */
export async function getFrameCached(env: Env, ctx: Background, camera: Pick<Camera, 'id' | 'catalogOnline'>): Promise<CameraFrame> {
  const cache = frameCache();
  const key = `${CACHE_ORIGIN}/${camera.id}`;
  const [prevRow, cached] = await Promise.all([getFrameStateRow(env.DB, camera.id), cache ? readCachedFrame(cache, key, camera.id) : null]);
  if (cached) return { frame: cached, state: frameStateFromRow(prevRow, camera.catalogOnline) };

  const prev = {
    lastHash: prevRow?.last_hash ?? null,
    lastChangedAt: prevRow?.last_changed_at ?? null,
    consecutiveFailures: prevRow?.consecutive_failures ?? 0,
  };
  let frame: CameraFrameBytes;
  try {
    frame = { cameraId: camera.id, ...(await fetchFrame(env, camera.id)) };
  } catch (e) {
    const reason = e instanceof TmcError ? `${e.code}: ${e.message}` : errorMessage(e);
    await putFrameState(env.DB, camera.id, nextFrameState(prev, null, new Date().toISOString(), reason.slice(0, 200)));
    throw e;
  }

  const next = nextFrameState(prev, frame.hash, frame.fetchedAt);
  if (shouldWriteState(prevRow, frame.hash, Date.now())) await putFrameState(env.DB, camera.id, next);
  if (cache) {
    ctx.waitUntil(cache.put(key, cacheResponse(frame)).catch((e: unknown) => console.error(`frames: cache put failed for ${camera.id}: ${errorMessage(e)}`)));
  }
  return { frame, state: { ...next, freshness: frameFreshness({ catalogOnline: camera.catalogOnline, ...next }) } };
}
