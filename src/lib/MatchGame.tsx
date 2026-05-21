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
  },
  vsAI: {
    id: 'vsAI',
    label: 'VS AI',
    rounds: 5,
    seconds: 30,
    description: 'Test your skills against an AI opponent. Coming soon.',
    multiplayer: false,
    enabled: false,
    icon: <Cpu />,
    bgImg: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?q=80&w=600&auto=format&fit=crop',
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
    const { data, error } = await supabase
      .from('game_modes')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('Failed to load game modes:', error);
      return;
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
            enabled: row.enabled,
            bgImg: row.bg_img || MODE_CONFIGS[id].bgImg,
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
  })();

  _modesLoadPromise.catch(() => {
    _modesLoadPromise = null;
  });

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
  mode: GameModeId = 'classic'
): LatLng {
  const availableFallbacks = selectedMaps.flatMap((map) => {
    return FALLBACK_LOCATIONS[map] ?? [];
  });

  if (availableFallbacks.length === 0) {
    // Fallback to world pool
    const worldFallbacks = FALLBACK_LOCATIONS.world;
    if (!worldFallbacks || worldFallbacks.length === 0) {
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
  roundSeconds: number
) {
  const distanceScore = 5000 * Math.exp(-distanceKm / 1500);
  const timeBonus = 0.6 + 0.4 * (timeLeft / Math.max(1, roundSeconds));

  return Math.max(0, Math.round(distanceScore * timeBonus));
}

async function isValidStreetViewLocation(
  lat: number,
  lng: number,
  apiKey: string
) {
  const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${apiKey}&source=outdoor`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();

  if (data?.status === 'OK' && data?.pano_id && data?.location) {
    return {
      panoId: data.pano_id as string,
      lat: data.location.lat as number,
      lng: data.location.lng as number,
    };
  }

  return null;
}

export async function fetchRandomStreetViewTarget(
  apiKey: string,
  selectedMaps: MapRegion | MapRegion[] = 'world',
  excludePanoIds: string[] = [],
  mode: GameModeId = 'classic'
): Promise<StreetViewTarget> {
  if (!apiKey) {
    throw new Error('Missing Google Maps API key.');
  }

  const normalizedMaps = normalizeSelectedMaps(selectedMaps);

  for (let attempt = 0; attempt < 30; attempt++) {
    const selectedMap = pickRandom(normalizedMaps);
    const location = getRandomLatLngForMap(selectedMap);

    try {
      const svData = await isValidStreetViewLocation(
        location.lat,
        location.lng,
        apiKey
      );

      if (svData && !excludePanoIds.includes(svData.panoId)) {
        return {
          lat: svData.lat,
          lng: svData.lng,
          panoId: svData.panoId,
          heading: randomInt(0, 359),
          pitch: randomInt(-5, 5),
          fov: 90,
        };
      }
    } catch {
      // Ignore failed attempts and retry with another random point.
    }
  }

  // Use mode-aware fallback selector
  const fallback = selectRandomFallbackForMode(normalizedMaps, mode);

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