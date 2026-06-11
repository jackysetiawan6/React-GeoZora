import Globe, { GlobeMethods } from 'react-globe.gl';
import { useEffect, useRef, useState, useCallback } from 'react';
import { cn } from '../lib/utils';

// ─── Types ───────────────────────────────────────────────────

type GlobeMarker = {
  id: number;
  lat: number;
  lng: number;
  createdAt: number;
};

// ─── Ping Locations ──────────────────────────────────────────
//
// Spread across all continents for visual variety as the
// globe rotates. These are purely decorative — they don't
// need to match the playable maps in the DB.

const PING_LOCATIONS: { lat: number; lng: number }[] = [
  { lat: 48.8566, lng: 2.3522 },     // Paris
  { lat: 35.6762, lng: 139.6503 },    // Tokyo
  { lat: -33.8688, lng: 151.2093 },   // Sydney
  { lat: 40.7128, lng: -74.006 },     // New York
  { lat: -22.9068, lng: -43.1729 },   // Rio de Janeiro
  { lat: 51.5074, lng: -0.1278 },     // London
  { lat: 37.7749, lng: -122.4194 },   // San Francisco
  { lat: 55.7558, lng: 37.6173 },     // Moscow
  { lat: 1.3521, lng: 103.8198 },     // Singapore
  { lat: -6.2088, lng: 106.8456 },    // Jakarta
  { lat: 28.6139, lng: 77.209 },      // New Delhi
  { lat: 30.0444, lng: 31.2357 },     // Cairo
  { lat: -1.2921, lng: 36.8219 },     // Nairobi
  { lat: 41.0082, lng: 28.9784 },     // Istanbul
  { lat: 64.1466, lng: -21.9426 },    // Reykjavik
  { lat: 59.9139, lng: 10.7522 },     // Oslo
  { lat: -34.6037, lng: -58.3816 },   // Buenos Aires
  { lat: 19.4326, lng: -99.1332 },    // Mexico City
  { lat: 13.7563, lng: 100.5018 },    // Bangkok
  { lat: 25.2048, lng: 55.2708 },     // Dubai
  { lat: 39.9042, lng: 116.4074 },    // Beijing
  { lat: -8.65, lng: 115.2167 },      // Bali
  { lat: 52.52, lng: 13.405 },        // Berlin
  { lat: 43.6532, lng: -79.3832 },    // Toronto
  { lat: -36.8509, lng: 174.7645 },   // Auckland
];

// ─── Constants ───────────────────────────────────────────────

/** How long each marker stays visible (ms) */
const MARKER_LIFETIME_MS = 3500;

/** Interval between new marker spawns (ms) */
const SPAWN_INTERVAL_MS = 2000;

/** Max markers visible simultaneously */
const MAX_VISIBLE_MARKERS = 3;

// Stable accessors — defined at module scope so react-globe.gl
// doesn't see new function references on every React render.
const ringColorAccessor = () => (t: number) =>
  `rgba(59, 130, 246, ${Math.max(0, 1 - t)})`;

const pointColorAccessor = () => '#3B82F6';

let markerIdCounter = 0;

// ─── Component ───────────────────────────────────────────────

export default function GlobeView() {
  const globeEl = useRef<GlobeMethods | undefined>(undefined);
  const [globeSize, setGlobeSize] = useState(800);
  const [markers, setMarkers] = useState<GlobeMarker[]>([]);
  const lastPickedIndexRef = useRef(-1);

  // ── Globe controls ──

  useEffect(() => {
    if (globeEl.current) {
      const controls = globeEl.current.controls();
      controls.autoRotate = true;
      controls.autoRotateSpeed = 1.2;
      controls.enableZoom = false;
    }
  }, []);

  // ── Responsive sizing ──

  useEffect(() => {
    const handleResize = () => {
      const size = Math.max(
        window.innerWidth * 0.65,
        window.innerHeight * 0.95
      );
      setGlobeSize(size);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ── Random location picker (avoids consecutive repeat) ──

  const pickRandomLocation = useCallback(() => {
    let idx: number;
    do {
      idx = Math.floor(Math.random() * PING_LOCATIONS.length);
    } while (idx === lastPickedIndexRef.current && PING_LOCATIONS.length > 1);

    lastPickedIndexRef.current = idx;
    return PING_LOCATIONS[idx];
  }, []);

  // ── Marker spawn / expire lifecycle ──

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();

      setMarkers((prev) => {
        // Remove expired markers
        const alive = prev.filter(
          (m) => now - m.createdAt < MARKER_LIFETIME_MS
        );

        // Spawn a new one if under the cap
        if (alive.length < MAX_VISIBLE_MARKERS) {
          const loc = pickRandomLocation();
          alive.push({
            id: markerIdCounter++,
            lat: loc.lat,
            lng: loc.lng,
            createdAt: now,
          });
        }

        return alive;
      });
    }, SPAWN_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [pickRandomLocation]);

  return (
    <div
      className={cn(
        'absolute inset-0 flex items-center justify-center pointer-events-none overflow-visible w-full h-full opacity-90'
      )}
    >
      <Globe
        ref={globeEl}
        width={globeSize}
        height={globeSize}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        backgroundColor="rgba(0,0,0,0)"
        // ── Expanding ring pulse ──
        ringsData={markers}
        ringLat="lat"
        ringLng="lng"
        ringColor={ringColorAccessor}
        ringMaxRadius={3}
        ringPropagationSpeed={2}
        ringRepeatPeriod={1200}
        // ── Center dot ──
        pointsData={markers}
        pointLat="lat"
        pointLng="lng"
        pointColor={pointColorAccessor}
        pointAltitude={0.01}
        pointRadius={0.35}
      />
    </div>
  );
}