import { ReactNode } from 'react';
import { MapPin, Map as MapIcon, Crosshair, Zap, Cpu } from 'lucide-react';
import { supabase } from './supabase';
import {
  FALLBACK_LOCATIONS,
  MAP_REGION_BOUNDS,
} from './MapRegions';
import type { MapRegion } from './MapRegions';

export type { MapRegion } from './MapRegions';
export type GameModeId = 'classic' | 'headToHead' | 'creatorRoom' | 'chaos' | 'vsAI';
export type GamePhase = 'loading' | 'playing' | 'waiting_for_others' | 'reveal' | 'finished';

export type LatLng = {
  lat: number;
  lng: number;
};

export type StreetViewTarget = LatLng & {
  heading: number;
  pitch: number;
  fov: number;
  panoId?: string;
};

export type RoundResult = {
  round: number;
  player: 1 | 2;
  guess: LatLng | null;
  target: LatLng;
  distanceKm: number;
  score: number;
  timeLeft: number;
};

export type ModeConfig = {
  id: GameModeId;
  label: string;
  rounds: number;
  seconds: number;
  description: string;
  multiplayer: boolean;
  enabled: boolean;
  icon: ReactNode;
  bgImg: string;
  sort_order: number;
};

export const DEFAULT_CUSTOM_ROUNDS = 8;
export const DEFAULT_CUSTOM_SECONDS = 75;

export const MODE_CONFIGS: Record<GameModeId, ModeConfig> = {
  classic: {
    id: 'classic',
    label: 'Classic',
    rounds: 5,
    seconds: 60,
    description: '5 rounds, 60 seconds each. The core singleplayer experience.',
    multiplayer: false,
    enabled: true,
    icon: <MapPin />,
    bgImg: 'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?q=80&w=600&auto=format&fit=crop',
    sort_order: 1,
  },
  headToHead: {
    id: 'headToHead',
    label: 'Head-to-head',
    rounds: 10,
    seconds: 30,
    description: '1v1 battle over 10 fast rounds (30s). Find a random opponent.',
    multiplayer: true,
    enabled: true,
    icon: <MapIcon />,
    bgImg: 'https://images.unsplash.com/photo-1524661135-423995f22d0b?q=80&w=600&auto=format&fit=crop',
    sort_order: 3,
  },
  creatorRoom: {
    id: 'creatorRoom',
    label: 'Creator Room',
    rounds: DEFAULT_CUSTOM_ROUNDS,
    seconds: DEFAULT_CUSTOM_SECONDS,
    description: 'Flexible rules for private matches with friends.',
    multiplayer: true,
    enabled: true,
    icon: <Crosshair />,
    bgImg: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=600&auto=format&fit=crop',
    sort_order: 4,
  },
  chaos: {
    id: 'chaos',
    label: 'Chaos Mode',
    rounds: 0,
    seconds: 0,
    description: 'Same geography core, but with random effects & power-ups. Coming soon.',
    multiplayer: true,
    enabled: false,
    icon: <Zap />,
    bgImg: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=600&auto=format&fit=crop',
    sort_order: 5,
  },
  vsAI: {
    id: 'vsAI',
    label: 'VS AI',
    rounds: 5,
    seconds: 30,
    description: 'Test your skills against an AI opponent. Choose from 5 bot levels!',
    multiplayer: false,
    enabled: true,
    icon: <Cpu />,
    bgImg: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?q=80&w=600&auto=format&fit=crop',
    sort_order: 2,
  },
};

let _modesLoaded = false;
let _modesLoadPromise: Promise<void> | null = null;

export function isGameModesLoaded() {
  return _modesLoaded;
}

export async function loadGameModes(): Promise<void> {
  if (_modesLoaded) return;
  if (_modesLoadPromise) return _modesLoadPromise;

  _modesLoadPromise = (async () => {
    try {
      // 1. Try reading from localStorage first
      const cachedModes = localStorage.getItem("geozora_game_modes");
      let data = null;
      if (cachedModes) {
        try {
          data = JSON.parse(cachedModes);
        } catch (e) {
          console.error("Failed to parse cached game modes", e);
        }
      }

      // 2. If no cache, fetch from database and write to cache
      if (!data) {
        const { data: dbData, error } = await supabase
          .from('game_modes')
          .select('*')
          .order('sort_order', { ascending: true });

        if (error) {
          throw new Error(error.message || 'Database query failed');
        }
        data = dbData;
        if (data && data.length > 0) {
          localStorage.setItem("geozora_game_modes", JSON.stringify(data));
        }
      }

      if (data && data.length > 0) {
        const nextConfigs = {} as Record<GameModeId, ModeConfig>;
        
        for (const row of data) {
          const id = row.id as GameModeId;
          if (MODE_CONFIGS[id]) {
            nextConfigs[id] = {
              ...MODE_CONFIGS[id],
              label: row.label,
              rounds: row.rounds,
              seconds: row.seconds,
              description: row.description,
              multiplayer: row.multiplayer,
              enabled: id === 'vsAI' ? true : row.enabled,
              bgImg: row.bg_img || MODE_CONFIGS[id].bgImg,
                sort_order: row.sort_order ?? MODE_CONFIGS[id].sort_order,
            };
          }
        }
        
        for (const key of Object.keys(MODE_CONFIGS)) {
          const id = key as GameModeId;
          if (!nextConfigs[id]) {
            nextConfigs[id] = MODE_CONFIGS[id];
          }
        }

        Object.assign(MODE_CONFIGS, nextConfigs);
      }
      _modesLoaded = true;
    } catch (err) {
      console.error('Failed to load game modes:', err);
      throw err;
    } finally {
      if (!_modesLoaded) {
        _modesLoadPromise = null;
      }
    }
  })();

  return _modesLoadPromise;
}

export function getRoundCount(mode: GameModeId, customRounds: number) {
  if (mode === 'creatorRoom') return customRounds;
  return MODE_CONFIGS[mode].rounds;
}

export function getRoundSeconds(mode: GameModeId, customSeconds: number) {
  if (mode === 'creatorRoom') return customSeconds;
  return MODE_CONFIGS[mode].seconds;
}

export function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function pickRandom<T>(items: T[]): T {
  if (!items || items.length === 0) {
    throw new Error("pickRandom: Array must not be empty or null");
  }
  return items[randomInt(0, items.length - 1)];
}

function normalizeSelectedMaps(
  selectedMaps: MapRegion | MapRegion[] = 'world'
): MapRegion[] {
  const maps = Array.isArray(selectedMaps) ? selectedMaps : [selectedMaps];

  const uniqueMaps = Array.from(new Set(maps)).filter(Boolean) as MapRegion[];

  return uniqueMaps.length > 0 ? uniqueMaps : ['world'];
}

function getRandomLatLngForMap(map: MapRegion): LatLng {
  if (map === 'world') {
    return {
      lat: randomFloat(-85, 85),
      lng: randomFloat(-180, 180),
    };
  }

  const bounds = MAP_REGION_BOUNDS[map];

  if (!bounds) {
    return {
      lat: randomFloat(-85, 85),
      lng: randomFloat(-180, 180),
    };
  }

  return {
    lat: randomFloat(bounds.minLat, bounds.maxLat),
    lng: randomFloat(bounds.minLng, bounds.maxLng),
  };
}

function getFallbackLocation(selectedMaps: MapRegion[]): LatLng {
  const availableFallbacks = selectedMaps.flatMap((map) => {
    return FALLBACK_LOCATIONS[map] ?? [];
  });

  if (availableFallbacks.length > 0) {
    return pickRandom(availableFallbacks);
  }

  // Last resort hardcoded fallback (Times Square)
  const worldFallbacks = FALLBACK_LOCATIONS.world;
  if (!worldFallbacks || worldFallbacks.length === 0) {
    return { lat: 40.7580, lng: -73.9855 };
  }

  return pickRandom(worldFallbacks);
}

// ─── Session-based location history for avoiding repeats ───────────────

/**
 * Per-match session state to track used locations and enable
 * context-aware randomization based on game mode.
 */
type LocationSessionState = {
  usedLocations: Set<string>; // stringified "{lat},{lng}"
  mode: GameModeId;
  selectedMaps: MapRegion[];
};

let _sessionState: LocationSessionState | null = null;

/**
 * Initialize a new location session (call at match start)
 */
export function initializeLocationSession(
  mode: GameModeId,
  selectedMaps: MapRegion[]
): void {
  _sessionState = {
    usedLocations: new Set(),
    mode,
    selectedMaps,
  };
}

/**
 * Clear session state (call at match end)
 */
export function clearLocationSession(): void {
  _sessionState = null;
}

/**
 * Get stringified key for a location (to track usage)
 */
function locationKey(location: LatLng): string {
  return `${location.lat.toFixed(4)},${location.lng.toFixed(4)}`;
}

/**
 * Context-aware fallback location selector.
 *
 * Behavior per game mode:
 * - classic/solo: Simple random pick (no repeat tracking)
 * - headToHead: Avoid locations used in current session
 * - creatorRoom: Avoid locations used in current session
 *
 * Falls back to simple random if all locations exhausted.
 */
export function selectRandomFallbackForMode(
  selectedMaps: MapRegion[],
  mode: GameModeId = 'classic',
  excludeCoords: LatLng[] = []
): LatLng {
  let availableFallbacks = selectedMaps.flatMap((map) => {
    return FALLBACK_LOCATIONS[map] ?? [];
  });

  if (excludeCoords && excludeCoords.length > 0) {
    availableFallbacks = availableFallbacks.filter(
      (loc) => !excludeCoords.some(c => Math.abs(c.lat - loc.lat) < 0.0001 && Math.abs(c.lng - loc.lng) < 0.0001)
    );
  }

  if (availableFallbacks.length === 0) {
    // Fallback to world pool
    let worldFallbacks = FALLBACK_LOCATIONS.world || [];
    if (excludeCoords && excludeCoords.length > 0) {
      worldFallbacks = worldFallbacks.filter(
        (loc) => !excludeCoords.some(c => Math.abs(c.lat - loc.lat) < 0.0001 && Math.abs(c.lng - loc.lng) < 0.0001)
      );
    }
    if (worldFallbacks.length === 0) {
      return { lat: 40.7580, lng: -73.9855 };
    }
    return pickRandom(worldFallbacks);
  }

  // For solo modes, just pick randomly (no session tracking)
  if (mode === 'classic') {
    return pickRandom(availableFallbacks);
  }

  // For multiplayer modes (headToHead, creatorRoom), avoid recent picks
  if (_sessionState && (mode === 'headToHead' || mode === 'creatorRoom')) {
    // Filter out already-used locations
    const unused = availableFallbacks.filter(
      (loc) => !_sessionState!.usedLocations.has(locationKey(loc))
    );

    // If all used, reset and pick from full pool (cycle through again)
    const pool = unused.length > 0 ? unused : availableFallbacks;
    const selected = pickRandom(pool);

    // Mark as used
    _sessionState.usedLocations.add(locationKey(selected));

    return selected;
  }

  // Fallback: simple random
  return pickRandom(availableFallbacks);
}

export function haversineKm(a: LatLng, b: LatLng) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);

  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function calculateScore(
  distanceKm: number,
  timeLeft: number,
  roundSeconds: number,
  enableTimeMultiplier: boolean = false
) {
  const distanceScore = 5000 * Math.exp(-distanceKm / 1500);
  const timeBonus = enableTimeMultiplier ? 0.6 + 0.4 * (timeLeft / Math.max(1, roundSeconds)) : 1.0;

  return Math.max(0, Math.round(distanceScore * timeBonus));
}

const REGION_COUNTRY_CODES: Record<string, string> = {
  argentina: 'AR',
  australia: 'AU',
  brazil: 'BR',
  canada: 'CA',
  chile: 'CL',
  france: 'FR',
  germany: 'DE',
  india: 'IN',
  indonesia: 'ID',
  italy: 'IT',
  japan: 'JP',
  malaysia: 'MY',
  mexico: 'MX',
  netherlands: 'NL',
  newZealand: 'NZ',
  norway: 'NO',
  philippines: 'PH',
  singapore: 'SG',
  southKorea: 'KR',
  spain: 'ES',
  sweden: 'SE',
  thailand: 'TH',
  unitedKingdom: 'GB',
  usa: 'US',
  vietnam: 'VN',
};

async function getCountryCodeForLatLng(
  lat: number,
  lng: number,
  apiKey: string
): Promise<string | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === 'OK' && data.results && data.results.length > 0) {
      for (const result of data.results) {
        for (const component of result.address_components) {
          if (component.types.includes('country')) {
            return component.short_name; // e.g. "US", "DE"
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to geocode location:', err);
  }
  return null;
}

async function isValidStreetViewLocation(
  lat: number,
  lng: number,
  apiKey: string
) {
  // Basic validation
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lat < -85 || lat > 85 || lng < -180 || lng > 180) return null;

  const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${apiKey}&source=outdoor`;

  const maxAttempts = 3;
  let delay = 300;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        // Retry on 5xx
        if (res.status >= 500 && attempt < maxAttempts - 1) {
          await new Promise(r => setTimeout(r, delay));
          delay *= 2;
          continue;
        }
        return null;
      }

      const data = await res.json();

      if (data?.status === 'OK' && data?.pano_id && data?.location) {
        return {
          panoId: data.pano_id as string,
          lat: data.location.lat as number,
          lng: data.location.lng as number,
        };
      }

      return null;
    } catch (err) {
      // network error -> retry
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      return null;
    }
  }
  return null;
}

export async function fetchRandomStreetViewTarget(
  apiKey: string,
  selectedMaps: MapRegion | MapRegion[] = 'world',
  excludePanoIds: string[] = [],
  mode: GameModeId = 'classic',
  excludeCoords: LatLng[] = []
): Promise<StreetViewTarget> {
  const normalizedMaps = normalizeSelectedMaps(selectedMaps);

  if (apiKey) {
    const batchSize = 10;
    const maxBatches = 3;
    for (let batch = 0; batch < maxBatches; batch++) {
      const candidatePromises = Array.from({ length: batchSize }).map(async () => {
        const selectedMap = pickRandom(normalizedMaps);
        const location = getRandomLatLngForMap(selectedMap);
        try {
          const svData = await isValidStreetViewLocation(
            location.lat,
            location.lng,
            apiKey
          );
          if (!svData) return null;

          // If not world, check that geocoding country matches expected country code
          if (selectedMap !== 'world') {
            const expectedCountry = REGION_COUNTRY_CODES[selectedMap];
            if (expectedCountry) {
              const actualCountry = await getCountryCodeForLatLng(
                svData.lat,
                svData.lng,
                apiKey
              );
              if (actualCountry !== expectedCountry) {
                return null; // Reject neighboring country
              }
            }
          }
          return svData;
        } catch {
          return null;
        }
      });

      const results = await Promise.all(candidatePromises);
      for (const svData of results) {
        if (svData && !excludePanoIds.includes(svData.panoId) && !excludeCoords.some(c => Math.abs(c.lat - svData.lat) < 0.0001 && Math.abs(c.lng - svData.lng) < 0.0001)) {
          return {
            lat: svData.lat,
            lng: svData.lng,
            panoId: svData.panoId,
            heading: randomInt(0, 359),
            pitch: randomInt(-5, 5),
            fov: 90,
          };
        }
      }
    }
  }

  // Use mode-aware fallback selector
  const fallback = selectRandomFallbackForMode(normalizedMaps, mode, excludeCoords);

  return {
    ...fallback,
    heading: randomInt(0, 359),
    pitch: 0,
    fov: 90,
  };
}

export function buildStreetViewEmbedUrl(
  apiKey: string,
  target: StreetViewTarget
) {
  const params = new URLSearchParams({
    key: apiKey,
    location: `${target.lat},${target.lng}`,
    heading: String(target.heading),
    pitch: String(target.pitch),
    fov: String(target.fov),
  });

  return `https://www.google.com/maps/embed/v1/streetview?${params.toString()}`;
}

export function formatDistance(distanceKm: number, metric = 'km') {
  if (metric === 'miles') {
    const miles = distanceKm * 0.621371;
    if (miles < 0.1) return `${Math.round(miles * 5280)} ft`;
    if (miles < 100) return `${miles.toFixed(1)} mi`;
    return `${Math.round(miles)} mi`;
  }
  if (metric === 'ft') {
    const ft = distanceKm * 3280.84;
    return `${Math.round(ft).toLocaleString()} ft`;
  }
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m`;
  if (distanceKm < 100) return `${distanceKm.toFixed(1)} km`;

  return `${Math.round(distanceKm)} km`;
}

export function formatScore(score: number) {
  return score.toLocaleString();
}

/**
 * Generates a random coordinate at a given distance range and bearing from the target
 */
export function calculateBotGuess(target: LatLng, minDistKm: number, maxDistKm: number): LatLng {
  const R = 6371; // Earth's radius in km
  const distKm = Math.random() * (maxDistKm - minDistKm) + minDistKm;
  const bearingRad = Math.random() * 2 * Math.PI;
  const angularDist = distKm / R;

  const lat1Rad = (target.lat * Math.PI) / 180;
  const lng1Rad = (target.lng * Math.PI) / 180;

  const lat2Rad = Math.asin(
    Math.sin(lat1Rad) * Math.cos(angularDist) +
      Math.cos(lat1Rad) * Math.sin(angularDist) * Math.cos(bearingRad)
  );

  let lng2Rad =
    lng1Rad +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDist) * Math.cos(lat1Rad),
      Math.cos(angularDist) - Math.sin(lat1Rad) * Math.sin(lat2Rad)
    );

  // Normalize longitude to -180 to 180
  let lat2 = (lat2Rad * 180) / Math.PI;
  let lng2 = (lng2Rad * 180) / Math.PI;

  lng2 = ((((lng2 + 180) % 360) + 360) % 360) - 180;

  // Bound latitude
  lat2 = Math.max(-85, Math.min(85, lat2));

  return { lat: lat2, lng: lng2 };
}