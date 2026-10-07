// Notifications: subscribe this device to Web Push and turn server alerts on/off.

import { Bell, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppSettings, PushConfigResponse } from '../../../shared/types';
import { SectionTitle } from './SectionTitle';
import { Toggle } from '../../components/Toggle';
import type { Resource } from '../../hooks/useResource';
import { pushSubscribe, pushTest, pushUnsubscribe, toApiError } from '../../lib/api';
import { currentSubscription, pushBlock, pushSupport, subscribePush, unsubscribePush } from '../../lib/push';
import { toast } from '../../lib/toast';

interface Props {
  settings: AppSettings | undefined;
  /** GET /api/push/config (needed for the VAPID key; retried from here if it failed). */
  pushConfig: Resource<PushConfigResponse>;
  isAdmin: boolean;
  /** Saves a settings patch (optimistic, with rollback). Resolves false on failure. */
  update: (patch: Partial<Pick<AppSettings, 'notificationsEnabled'>>) => Promise<boolean>;
}

export function NotificationsSection({ settings, pushConfig, isAdmin, update }: Props) {
  const support = pushSupport();
  const [deviceSubscribed, setDeviceSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let alive = true;
    void currentSubscription().then((s) => {
      if (alive) setDeviceSubscribed(Boolean(s));
    });
    return () => {
      alive = false;
    };
  }, []);

  const enabled = settings?.notificationsEnabled ?? false;
  const config = pushConfig.data;
  // Why the toggle can't be used (including "push config didn't load").
  const block = pushBlock(config, pushConfig.error !== null, support);
  const blocked = block?.message ?? null;

  const subscribeDevice = async () => {
    if (!config) throw new Error("Notification settings didn't load. Try again.");
    if (!config.publicKey) throw new Error('Server notifications not configured');
    const sub = await subscribePush(config.publicKey);
    await pushSubscribe(sub);
    setDeviceSubscribed(true);
  };

  const onToggle = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) {
        await subscribeDevice();
        if (await update({ notificationsEnabled: true })) toast('Parking alerts are on');
      } else {
        const endpoint = await unsubscribePush();
        setDeviceSubscribed(false);
        if (endpoint) await pushUnsubscribe(endpoint).catch(() => undefined);
        if (await update({ notificationsEnabled: false })) toast('Parking alerts are off', 'info');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : toApiError(err).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const addThisDevice = async () => {
    setBusy(true);
    try {
      await subscribeDevice();
      toast('This device will get alerts');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not subscribe', 'error');
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await pushTest();
      if (res.sent > 0) toast(`Test sent to ${res.sent} ${res.sent === 1 ? 'device' : 'devices'}`);
      else
        toast(
          res.failed ? `Couldn't deliver to ${res.failed} ${res.failed === 1 ? 'device' : 'devices'}` : 'No devices are subscribed yet',
          'error',
        );
    } catch (err) {
      toast(toApiError(err).message, 'error');
    } finally {
      setTesting(false);
    }
  };

  let detail: string;
  if (blocked) detail = blocked;
  else if (!enabled) detail = 'Alert me when a likely spot shows up';
  else if (deviceSubscribed === false) detail = "On, but this device isn't subscribed";
  else detail = 'On · alerts for spots above your confidence';

  return (
    <section className="section" aria-labelledby="sec-notify">
      <SectionTitle id="sec-notify" locked={!isAdmin}>
        Notifications
      </SectionTitle>
      <div className="group">
        <div className="row has-icon">
          <span className="row-icon tone-red" aria-hidden="true">
            <Bell size={17} />
          </span>
          <span className="row-label">
            Parking alerts
            <small className={block && block.kind !== 'loading' ? 'is-warning' : undefined}>{detail}</small>
          </span>
          <Toggle
            checked={enabled}
            onChange={(v) => void onToggle(v)}
            label="Parking alerts"
            disabled={!isAdmin || !settings || (blocked !== null && !enabled)}
            busy={busy}
          />
        </div>
        {block?.kind === 'retry' && (
          <button type="button" className="row" onClick={pushConfig.reload} disabled={pushConfig.loading}>
            <span className="row-label row-action">{pushConfig.loading ? 'Loading…' : 'Try again'}</span>
          </button>
        )}
        {enabled && !blocked && deviceSubscribed === false && (
          <button type="button" className="row" onClick={addThisDevice} disabled={!isAdmin || busy}>
            <span className="row-label row-action">Add this device</span>
          </button>
        )}
        {enabled && (
          <button type="button" className="row" onClick={sendTest} disabled={!isAdmin || testing}>
            <span className="row-label row-action">
              <Send size={16} aria-hidden="true" /> {testing ? 'Sending…' : 'Send test notification'}
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
