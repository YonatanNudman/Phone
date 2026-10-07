// GET /api/parking/current: the main screen in one call.

import { Hono } from 'hono';
import { isDetectionCurrent } from '../../shared/freshness';
import { summarize } from '../../shared/status';
import type { ParkingCurrentResponse } from '../../shared/types';
import type { AppEnv } from '../http';
import { cameraSummaries, ensureCatalogFresh } from '../services/cameras';
import { readSettingsState, touchAppLastSeen } from '../services/settings';

export const parkingRoutes = new Hono<AppEnv>();

parkingRoutes.get('/current', async (c) => {
  await ensureCatalogFresh(c.env);
  const state = await readSettingsState(c.env);
  const { settings } = state;
  const now = new Date();

  const nearby = await cameraSummaries(c.env, { radiusMi: settings.radiusMi });
  const watched = nearby.filter((cam) => cam.preference.usefulness === 'yes');
  const current = watched.filter((cam) => isDetectionCurrent(cam.latest, settings.maxDetectionAgeSeconds, now));
  const candidates = current.flatMap((cam) => cam.latest?.candidates ?? []).sort((a, b) => b.confidence - a.confidence);
  const updatedAt = watched.reduce<string | null>((newest, cam) => {
    const t = cam.latest?.timestamp ?? null;
    return t && (!newest || t > newest) ? t : newest;
  }, null);

  await touchAppLastSeen(c.env, state, now);
  const body: ParkingCurrentResponse = {
    generatedAt: now.toISOString(),
    home: settings.home,
    radiusMi: settings.radiusMi,
    minConfidence: settings.minConfidence,
    summary: { ...summarize(candidates, current.length), updatedAt },
    candidates,
    watched,
    nearby,
  };
  return c.json(body);
});
