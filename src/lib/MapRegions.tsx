// ============================================================
// MapRegions.ts — Database-backed map region configuration
// ============================================================
//
// INTEGRATION:
// Call loadMapRegions() once at app startup (e.g. in App.tsx or
// a provider) BEFORE rendering any map-related UI.
//
//   import { loadMapRegions } from './lib/MapRegions';
//
//   useEffect(() => { loadMapRegions().catch(console.error); }, []);
//
// After the promise resolves, MAPS / MAP_REGION_BOUNDS /
// FALLBACK_LOCATIONS are populated and all utility functions
// work exactly as before.
// ============================================================

import { supabase } from './supabase';

// ─── Types ───────────────────────────────────────────────────

export type MapCategory =
  | 'popular'
  | 'asia'
  | 'europe'
  | 'americas'
  | 'oceania';

export type MapLatLng = {
  lat: number;
  lng: number;
};

export type MapBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

export type MapRegion = string;

export type GoogleMapBounds = {
  north: number;
  south: number;
  west: number;
  east: number;
};

export type MapRegionViewConfig = {
  region: MapRegion;
  bounds: GoogleMapBounds;
  center: MapLatLng;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  highlight: boolean;
};

export type MapEntry = {
  name: string;
  flag: string;
  categories: MapCategory[];
  flagImage?: string;
  background?: string;
};

// ─── DB Row Types (internal) ─────────────────────────────────

type MapRegionRow = {
  id: string;
  name: string;
  flag: string;
  flag_image: string | null;
  background: string | null;
  categories: string[];
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
  camera_zoom: number | null;
  camera_min_zoom: number | null;
  camera_max_zoom: number | null;
  sort_order: number;
  is_enabled: boolean;
};

type FallbackLocationRow = {
  region_id: string;
  lat: number;
  lng: number;
  is_enabled: boolean | null;
};

// ─── Constants (stay client-side) ────────────────────────────

export const MAX_SELECTED_MAPS = 3;

export const MAP_CATEGORY_OPTIONS: {
  id: 'all' | MapCategory;
  label: string;
}[] = [
  { id: 'all', label: 'All' },
  { id: 'popular', label: 'Popular' },
  { id: 'asia', label: 'Asia' },
  { id: 'europe', label: 'Europe' },
  { id: 'americas', label: 'Americas' },
  { id: 'oceania', label: 'Oceania' },
];

export const WORLD_MAP_BOUNDS: GoogleMapBounds = {
  north: 85,
  south: -85,
  west: -180,
  east: 180,
};

export const WORLD_MAP_CENTER: MapLatLng = {
  lat: 20,
  lng: 0,
};

// ─── Module-Level Mutable Cache ──────────────────────────────
//
// These are populated by loadMapRegions(). Before the loader
// resolves they are empty — ensure the call happens before
// any component reads them (see integration note at the top).

export const MAPS: Record<string, MapEntry> = {};

export const MAP_REGION_BOUNDS: Record<string, MapBounds> = {};

export const FALLBACK_LOCATIONS: Record<string, MapLatLng[]> = {};

/** Internal — not exported. Used by getMapRegionViewConfig. */
const CAMERA_OVERRIDES: Record<
  string,
  { zoom?: number; minZoom?: number; maxZoom?: number }
> = {};

let _loaded = false;
let _loadPromise: Promise<void> | null = null;

// ─── Loader ──────────────────────────────────────────────────

export function isMapDataLoaded(): boolean {
  return _loaded;
}

/**
 * Fetches map regions and fallback locations from Supabase and
 * populates all module-level caches.
 *
 * Safe to call multiple times — subsequent calls return the
 * same resolved promise.
 */
export async function loadMapRegions(): Promise<void> {
  if (_loaded) return;
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    const [regionsRes, locationsRes] = await Promise.all([
      supabase
        .from('map_regions')
        .select('*')
        .eq('is_enabled', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('map_fallback_locations')
        .select('region_id, lat, lng, is_enabled')
        .order('sort_order', { ascending: true }),
    ]);

    if (regionsRes.error) throw regionsRes.error;
    if (locationsRes.error) throw locationsRes.error;

    const regions = regionsRes.data as MapRegionRow[];
    const locations = locationsRes.data as FallbackLocationRow[];

    // ── Clear previous cache (supports hot-reload / re-fetch) ──

    for (const k of Object.keys(MAPS)) delete MAPS[k];
    for (const k of Object.keys(MAP_REGION_BOUNDS)) delete MAP_REGION_BOUNDS[k];
    for (const k of Object.keys(FALLBACK_LOCATIONS)) delete FALLBACK_LOCATIONS[k];
    for (const k of Object.keys(CAMERA_OVERRIDES)) delete CAMERA_OVERRIDES[k];

    // ── Populate from DB rows ──

    for (const row of regions) {
      // Map catalog entry
      MAPS[row.id] = {
        name: row.name,
        flag: row.flag,
        categories: row.categories as MapCategory[],
        ...(row.flag_image ? { flagImage: row.flag_image } : {}),
        ...(row.background ? { background: row.background } : {}),
      };

      // Region bounds (world uses the hardcoded WORLD_MAP_BOUNDS constant
      // in getMapRegionViewConfig, so we skip it here to match the
      // original behaviour)
      if (row.id !== 'world') {
        MAP_REGION_BOUNDS[row.id] = {
          minLat: row.min_lat,
          maxLat: row.max_lat,
          minLng: row.min_lng,
          maxLng: row.max_lng,
        };
      }

      // Camera overrides (only when at least one value is set)
      if (
        row.camera_zoom != null ||
        row.camera_min_zoom != null ||
        row.camera_max_zoom != null
      ) {
        CAMERA_OVERRIDES[row.id] = {
          ...(row.camera_zoom != null ? { zoom: row.camera_zoom } : {}),
          ...(row.camera_min_zoom != null
            ? { minZoom: row.camera_min_zoom }
            : {}),
          ...(row.camera_max_zoom != null
            ? { maxZoom: row.camera_max_zoom }
            : {}),
        };
      }
    }

    // Fallback locations (grouped by region)
    FALLBACK_LOCATIONS['world'] = [];
    for (const loc of locations) {
      if (loc.is_enabled === false) continue;

      if (!FALLBACK_LOCATIONS[loc.region_id]) {
        FALLBACK_LOCATIONS[loc.region_id] = [];
      }

      const point = {
        lat: loc.lat,
        lng: loc.lng,
      };

      FALLBACK_LOCATIONS[loc.region_id].push(point);
      
      // Also add everything to world pool for maximum variety (only if not already added)
      if (loc.region_id !== 'world') {
        FALLBACK_LOCATIONS['world'].push(point);
      }
    }

    _loaded = true;
  })();

  // Allow retry on failure
  _loadPromise.catch(() => {
    _loadPromise = null;
  });

  return _loadPromise;
}

// ─── Utility Functions ───────────────────────────────────────

function convertMapBoundsToGoogleBounds(bounds: MapBounds): GoogleMapBounds {
  return {
    north: bounds.maxLat,
    south: bounds.minLat,
    west: bounds.minLng,
    east: bounds.maxLng,
  };
}

function getBoundsCenter(bounds: GoogleMapBounds): MapLatLng {
  return {
    lat: (bounds.north + bounds.south) / 2,
    lng: (bounds.east + bounds.west) / 2,
  };
}

export function getMapRegionViewConfig(
  region: MapRegion
): MapRegionViewConfig {
  if (region === 'world') {
    const override = CAMERA_OVERRIDES['world'];

    return {
      region: 'world',
      bounds: WORLD_MAP_BOUNDS,
      center: WORLD_MAP_CENTER,
      zoom: override?.zoom ?? 2,
      minZoom: override?.minZoom ?? 2,
      maxZoom: override?.maxZoom ?? 12,
      highlight: false,
    };
  }

  const regionBounds = MAP_REGION_BOUNDS[region];

  if (!regionBounds) {
    // Unknown region — fall back to world view
    return {
      region: 'world',
      bounds: WORLD_MAP_BOUNDS,
      center: WORLD_MAP_CENTER,
      zoom: 2,
      minZoom: 2,
      maxZoom: 12,
      highlight: false,
    };
  }

  const bounds = convertMapBoundsToGoogleBounds(regionBounds);
  const override = CAMERA_OVERRIDES[region];

  return {
    region,
    bounds,
    center: getBoundsCenter(bounds),
    zoom: override?.zoom ?? 5,
    minZoom: override?.minZoom ?? 4,
    maxZoom: override?.maxZoom ?? 13,
    highlight: true,
  };
}

export function getMapViewConfigForSelectedRegions(
  selectedRegions: MapRegion[]
): MapRegionViewConfig {
  const validSelectedRegions = selectedRegions.filter(Boolean);

  const shouldUseSingleCountryBounds =
    validSelectedRegions.length === 1 &&
    validSelectedRegions[0] !== 'world';

  if (shouldUseSingleCountryBounds) {
    return getMapRegionViewConfig(validSelectedRegions[0]);
  }

  return getMapRegionViewConfig('world');
}