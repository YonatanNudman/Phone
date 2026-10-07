// Web Push subscription flow.
//
// iOS only exposes PushManager to Home Screen apps (iOS 16.4+), so in Safari
// tabs we explain how to install instead of showing a dead toggle.
// `subscribe` must start from a user gesture: Notification.requestPermission
// is the first await so Safari still sees the tap.

import { isAppleMobile, isStandalone } from './platform';

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: 'ios_install' | 'unsupported' | 'denied'; message: string };

export function pushSupport(): PushSupport {
  const hasApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!hasApis) {
    if (isAppleMobile() && !isStandalone()) {
      return { ok: false, reason: 'ios_install', message: 'Add to Home Screen first (Share → Add to Home Screen).' };
    }
    return { ok: false, reason: 'unsupported', message: "This browser doesn't support notifications." };
  }
  if (Notification.permission === 'denied') {
    return { ok: false, reason: 'denied', message: 'Notifications are blocked. Allow them in system settings.' };
  }
  return { ok: true };
}

/** base64url (VAPID public key) -> bytes. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  // `ready` never settles if registration failed, so bound the wait.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Service worker is not active yet. Reload and try again.')), 10_000)),
  ]);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try {
    const reg = await registration();
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** Ask permission and subscribe this device. Throws an Error with a readable message on failure. */
export async function subscribePush(publicKey: string): Promise<PushSubscriptionJSON> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed.');
  const reg = await registration();
  const existing = await reg.pushManager.getSubscription();
  const key = base64UrlToBytes(publicKey);
  // A subscription made with an old VAPID key would silently never deliver.
  if (existing && !sameKey(existing.options.applicationServerKey, key)) await existing.unsubscribe();
  const sub =
    existing && sameKey(existing.options.applicationServerKey, key)
      ? existing
      : await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return sub.toJSON();
}

/** Unsubscribe this device. Returns the endpoint that was removed, if any. */
export async function unsubscribePush(): Promise<string | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => false);
  return endpoint;
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}
