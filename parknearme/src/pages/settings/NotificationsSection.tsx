// Notifications: subscribe this device to Web Push and turn server alerts on/off.

import { Bell, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppSettings, PushConfigResponse } from '../../../shared/types';
import { SectionTitle } from './SectionTitle';
import { Toggle } from '../../components/Toggle';
import { pushSubscribe, pushTest, pushUnsubscribe, toApiError } from '../../lib/api';
import { currentSubscription, pushSupport, subscribePush, unsubscribePush } from '../../lib/push';
import { toast } from '../../lib/toast';

interface Props {
  settings: AppSettings | undefined;
  pushConfig: PushConfigResponse | undefined;
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
  const serverReady = pushConfig?.enabled === true && Boolean(pushConfig.publicKey);

  // Why the toggle can't be used, in priority order.
  let blocked: string | null = null;
  if (pushConfig && !serverReady) blocked = 'Server notifications not configured';
  else if (!support.ok) blocked = support.message;

  const subscribeDevice = async () => {
    if (!pushConfig?.publicKey) return false;
    const sub = await subscribePush(pushConfig.publicKey);
    await pushSubscribe(sub);
    setDeviceSubscribed(true);
    return true;
  };

  const onToggle = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) {
        if (!(await subscribeDevice())) return;
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
      if (await subscribeDevice()) toast('This device will get alerts');
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
            <small className={blocked ? 'is-warning' : undefined}>{detail}</small>
          </span>
          <Toggle
            checked={enabled}
            onChange={(v) => void onToggle(v)}
            label="Parking alerts"
            disabled={!isAdmin || !settings || (blocked !== null && !enabled)}
            busy={busy}
          />
        </div>
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
