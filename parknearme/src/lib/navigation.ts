// Turn-by-turn deep links. iOS/iPadOS open Apple Maps; everything else Google Maps.

import { isAppleMobile } from './platform';

export function directionsUrl(lat: number, lon: number): string {
  const dest = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  return isAppleMobile()
    ? `https://maps.apple.com/?daddr=${dest}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
}
