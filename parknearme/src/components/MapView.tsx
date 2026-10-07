// Leaflet map (no react-leaflet): the map is created once and layers are
// rebuilt imperatively when data changes. Callbacks go through refs so
// markers don't need rebuilding when handlers change identity.

import L from 'leaflet';
import { useEffect, useRef } from 'react';
import type { CameraSummary, ParkingCandidate } from '../../shared/types';
import type { LatLon } from '../../shared/geo';
import { cameraLabel } from '../lib/format';
import { cameraIcon, cameraTitle, homeIcon, parkingIcon } from './mapIcons';
import './map.css';

export interface MapInsets {
  top: number;
  bottom: number;
}

interface Props {
  home: LatLon;
  radiusMi: number | null;
  cameras: CameraSummary[];
  watchedIds: ReadonlySet<string>;
  candidates: ParkingCandidate[];
  selectedCameraId: string | null;
  selectedCandidate: number | null;
  onCameraTap: (id: string) => void;
  onCandidateTap: (index: number) => void;
  /** Pixels covered by floating UI, so "center" means the visible part of the map. */
  insets: MapInsets;
  /** Increment to recenter on home. */
  recenterToken: number;
}

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const HOME_ZOOM = 16;
const MI_TO_M = 1609.344;
/** How far an "approximate" parking marker is pushed away from its camera. */
const APPROX_OFFSET_M = 25;

/** Move `p` by `meters` toward `bearingDeg` (small-distance approximation). */
function offsetLatLng(p: LatLon, meters: number, bearingDeg: number): L.LatLng {
  const b = (bearingDeg * Math.PI) / 180;
  const dLat = (meters * Math.cos(b)) / 111_320;
  const dLon = (meters * Math.sin(b)) / (111_320 * Math.cos((p.lat * Math.PI) / 180));
  return L.latLng(p.lat + dLat, p.lon + dLon);
}

/** Center `target` within the part of the map not covered by `insets`. */
function centerIn(map: L.Map, target: L.LatLngExpression, insets: MapInsets, zoom?: number, animate = true) {
  const z = zoom ?? map.getZoom();
  const shift = (insets.bottom - insets.top) / 2;
  const center = map.unproject(map.project(target, z).add([0, shift]), z);
  map.setView(center, z, { animate });
}

/** Where a candidate's marker goes; approximate ones are fanned out around the camera. */
export function candidateMarkerPosition(c: ParkingCandidate, indexAtCamera: number): L.LatLng {
  return c.approximateLocation ? offsetLatLng(c, APPROX_OFFSET_M, 40 + indexAtCamera * 55) : L.latLng(c.lat, c.lon);
}

export function MapView(props: Props) {
  const { home, radiusMi, cameras, watchedIds, candidates, selectedCameraId, selectedCandidate, insets, recenterToken } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layers = useRef<{ home: L.LayerGroup; cameras: L.LayerGroup; parking: L.LayerGroup } | null>(null);
  const handlers = useRef({ onCameraTap: props.onCameraTap, onCandidateTap: props.onCandidateTap });
  const insetsRef = useRef(insets);
  const initialHome = useRef(home);
  const homeRef = useRef(home);
  const camerasRef = useRef(cameras);
  /** Set once the user pans the map, so we stop auto-centering on home. */
  const userMoved = useRef(false);

  useEffect(() => {
    handlers.current = { onCameraTap: props.onCameraTap, onCandidateTap: props.onCandidateTap };
    insetsRef.current = insets;
    homeRef.current = home;
    camerasRef.current = cameras;
  });

  // Create the map once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const h = initialHome.current;
    const map = L.map(el, {
      zoomControl: false,
      center: [h.lat, h.lon],
      zoom: HOME_ZOOM,
      maxZoom: 19,
      minZoom: 11,
      zoomSnap: 0.25,
      tapTolerance: 20,
    });
    map.attributionControl.setPrefix(false);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: '© OpenStreetMap', crossOrigin: true }).addTo(map);
    layers.current = {
      home: L.layerGroup().addTo(map),
      cameras: L.layerGroup().addTo(map),
      parking: L.layerGroup().addTo(map),
    };
    map.on('dragstart', () => {
      userMoved.current = true;
    });
    mapRef.current = map;
    centerIn(map, [h.lat, h.lon], insetsRef.current, HOME_ZOOM, false);
    return () => {
      map.remove();
      mapRef.current = null;
      layers.current = null;
    };
  }, []);

  // Home marker + search radius.
  useEffect(() => {
    const g = layers.current?.home;
    if (!g) return;
    g.clearLayers();
    if (radiusMi) {
      L.circle([home.lat, home.lon], { radius: radiusMi * MI_TO_M, className: 'mk-radius', interactive: false }).addTo(g);
    }
    L.marker([home.lat, home.lon], { icon: homeIcon(), zIndexOffset: 2000, keyboard: false, interactive: false, title: 'Home' }).addTo(g);
  }, [home.lat, home.lon, radiusMi]);

  // Camera markers.
  useEffect(() => {
    const g = layers.current?.cameras;
    if (!g) return;
    g.clearLayers();
    for (const cam of cameras) {
      const watched = watchedIds.has(cam.id);
      const freshness = cam.frame.freshness;
      const status = watched && cam.latest ? cam.latest.status : null;
      const marker = L.marker([cam.lat, cam.lon], {
        icon: cameraIcon({ freshness, watched, selected: cam.id === selectedCameraId, status }),
        title: cameraTitle(cameraLabel(cam), freshness, status),
        zIndexOffset: cam.id === selectedCameraId ? 1500 : watched ? 200 : 0,
        riseOnHover: true,
      });
      marker.on('click', () => handlers.current.onCameraTap(cam.id));
      marker.addTo(g);
    }
  }, [cameras, watchedIds, selectedCameraId]);

  // Parking markers (+ dashed tether to the camera when the position is approximate).
  useEffect(() => {
    const g = layers.current?.parking;
    if (!g) return;
    g.clearLayers();
    const perCamera = new Map<string, number>();
    candidates.forEach((c, i) => {
      const k = perCamera.get(c.cameraId) ?? 0;
      perCamera.set(c.cameraId, k + 1);
      const pos = candidateMarkerPosition(c, k);
      if (c.approximateLocation) {
        L.polyline([[c.lat, c.lon], pos], { className: 'mk-tether', interactive: false, weight: 2, dashArray: '3 5' }).addTo(g);
      }
      const marker = L.marker(pos, {
        icon: parkingIcon({ status: c.status, spaces: c.spaces, selected: i === selectedCandidate }),
        title: `Parking: ${c.streetLabel}, ${c.spaces} possible ${c.spaces === 1 ? 'space' : 'spaces'}`,
        zIndexOffset: i === selectedCandidate ? 1800 : 1000 - i,
        riseOnHover: true,
      });
      marker.on('click', () => handlers.current.onCandidateTap(i));
      marker.addTo(g);
    });
  }, [candidates, selectedCandidate]);

  // Recenter on request (and when home moves after a re-geocode).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    userMoved.current = false;
    centerIn(map, [home.lat, home.lon], insetsRef.current, Math.max(map.getZoom(), 15.5));
  }, [recenterToken, home.lat, home.lon]);

  // Until the user pans, keep home centered in the visible area as the sheet moves.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || userMoved.current) return;
    const h = homeRef.current;
    centerIn(map, [h.lat, h.lon], { top: insets.top, bottom: insets.bottom });
  }, [insets.top, insets.bottom]);

  // Bring the selected camera into view above the (half-height) sheet.
  const camerasReady = cameras.length > 0;
  useEffect(() => {
    const map = mapRef.current;
    const cam = camerasRef.current.find((c) => c.id === selectedCameraId);
    if (!map || !cam) return;
    userMoved.current = true;
    const bottom = Math.min(insetsRef.current.bottom, window.innerHeight * 0.55);
    centerIn(map, [cam.lat, cam.lon], { top: insetsRef.current.top, bottom });
  }, [selectedCameraId, camerasReady]);

  return <div ref={containerRef} className="map" role="application" aria-label="Map of parking and cameras near home" />;
}
