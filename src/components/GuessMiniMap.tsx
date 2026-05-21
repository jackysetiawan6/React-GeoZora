import { useEffect, useMemo, useRef } from 'react';
import { cn } from '../lib/utils';
import type { MapRegion } from '../lib/MapRegions';
import { getMapViewConfigForSelectedRegions } from '../lib/MapRegions';
import type { RoundResult } from '../lib/MatchGame';

declare global {
  interface Window {
    google?: any;
  }
}

type LatLng = {
  lat: number;
  lng: number;
};

type CameraState = {
  lat: number;
  lng: number;
  zoom: number;
};

type Props = {
  guess: LatLng | null;
  target: LatLng | null;
  phase: 'loading' | 'playing' | 'reveal' | 'finished' | 'waiting_for_others';
  onPick: (pos: LatLng) => void;
  isMapLoaded: boolean;
  selectedRegions?: MapRegion[];
  mapType?: string;
  userAvatar?: string | null;
  allResults?: RoundResult[];
  disabled?: boolean;
  submitting?: boolean;
  opponentResults?: Array<{
    guess: LatLng;
    target: LatLng;
    userId?: string;
    round?: number;
    playerIndex: number;
  }>;
};

function drawOpponentResult(
  mapInstance: any,
  result: { guess: LatLng; target: LatLng; playerIndex: number; round?: number },
  bounds: any | null,
  markersArray: any[],
  linesArray: any[],
  viewBounds: any
) {
  if (!result.guess) return false;
  
  const safeGuess = clampLatLng(result.guess, viewBounds);
  const safeTarget = clampLatLng(result.target, viewBounds);
  const pColor = PLAYER_COLORS[result.playerIndex % PLAYER_COLORS.length];

  const avatarContainer = document.createElement('div');
  avatarContainer.className =
    'relative w-8 h-8 rounded-full border-2 border-white shadow-md overflow-hidden flex items-center justify-center';
  avatarContainer.style.backgroundColor = pColor;
  
  const span = document.createElement('span');
  span.className = 'text-white text-[8px] font-bold';
  span.innerText = `P${result.playerIndex + 2}`;
  avatarContainer.appendChild(span);

  const tail = document.createElement('div');
  tail.className =
    'absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rotate-45';
  tail.style.backgroundColor = pColor;
  avatarContainer.appendChild(tail);

  const mGuess =
    new window.google.maps.marker.AdvancedMarkerElement({
      map: mapInstance,
      position: safeGuess,
      content: avatarContainer,
      title: result.round !== undefined 
        ? `Player ${result.playerIndex + 2} Round ${result.round} Guess`
        : `Player ${result.playerIndex + 2}`,
    });
  markersArray.push(mGuess);
  if (bounds) bounds.extend(safeGuess);

  const line = new window.google.maps.Polyline({
    map: mapInstance,
    path: [safeGuess, safeTarget],
    strokeColor: pColor,
    strokeOpacity: 0.8,
    strokeWeight: 2,
    geodesic: false,
    icons: [
      {
        icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 2 },
        offset: '0',
        repeat: '15px',
      },
    ],
  });
  linesArray.push(line);
  return true;
}

function clampLatLng(
  pos: LatLng,
  bounds: {
    north: number;
    south: number;
    west: number;
    east: number;
  }
) {
  return {
    lat: Math.max(bounds.south, Math.min(bounds.north, pos.lat)),
    lng: Math.max(bounds.west, Math.min(bounds.east, pos.lng)),
  };
}

function computeOverviewCamera(
  p1: LatLng,
  p2: LatLng,
  container: HTMLElement,
  padding: number,
  maxZoom: number = 13
): CameraState {
  const centerLat = (p1.lat + p2.lat) / 2;
  const centerLng = (p1.lng + p2.lng) / 2;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w <= 0 || h <= 0) {
    return { lat: centerLat, lng: centerLng, zoom: 2 };
  }
  const TILE = 256;
  const ew = Math.max(w - 2 * padding, 1);
  const eh = Math.max(h - 2 * padding, 1);
  const lngSpan = Math.abs(p1.lng - p2.lng) || 0.001;
  const lngZoom = Math.log2((ew * 360) / (TILE * lngSpan));
  const mercY = (lat: number) => {
    const siny = Math.sin((lat * Math.PI) / 180);
    return Math.log((1 + siny) / (1 - siny));
  };
  const latMercSpan = Math.abs(mercY(p1.lat) - mercY(p2.lat)) || 0.001;
  const latZoom = Math.log2((eh * 4 * Math.PI) / (TILE * latMercSpan));
  const zoom = Math.max(1, Math.min(Math.floor(Math.min(latZoom, lngZoom)), maxZoom));
  return { lat: centerLat, lng: centerLng, zoom };
}

function smoothCamera(
  map: any,
  from: CameraState,
  to: CameraState,
  duration: number,
  shouldContinue: () => boolean,
  onComplete?: () => void
) {
  let startTime: number | null = null;
  const step = (time: number) => {
    if (!shouldContinue() || !map) return;
    if (!startTime) startTime = time;
    const progress = Math.min((time - startTime) / duration, 1);
    const ease =
      progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    map.moveCamera({
      center: {
        lat: from.lat + (to.lat - from.lat) * ease,
        lng: from.lng + (to.lng - from.lng) * ease,
      },
      zoom: from.zoom + (to.zoom - from.zoom) * ease,
    });
    if (progress < 1) {
      requestAnimationFrame(step);
    } else if (onComplete) {
      onComplete();
    }
  };
  requestAnimationFrame(step);
}

const PLAYER_COLORS = [
  '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4',
  '#ec4899', '#f97316', '#14b8a6', '#6366f1', '#eab308',
  '#a855f7', '#f43f5e', '#0ea5e9', '#d946ef', '#ffed4a', 
  '#4ade80', '#c084fc', '#fb923c', '#22d3ee', '#fb7185', 
  '#a3e635', '#2dd4bf', '#818cf8', '#f87171', '#38bdf8',
  '#c084fc', '#fbbf24', '#34d399', '#e879f9', '#4ade80'
];

export default function GuessMiniMap({
  guess,
  target,
  phase,
  onPick,
  isMapLoaded,
  selectedRegions = ['world'],
  mapType = 'roadmap',
  userAvatar = null,
  allResults = [],
  disabled = false,
  submitting = false,
  opponentResults = [],
}: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<any>(null);
  const guessMarker = useRef<any>(null);
  const targetMarker = useRef<any>(null);
  const routeLine = useRef<any>(null);
  const regionHighlight = useRef<any>(null);
  const historyMarkers = useRef<any[]>([]);
  const historyPolylines = useRef<any[]>([]);
  const otherGuessMarkers = useRef<any[]>([]);
  const otherRoutes = useRef<any[]>([]);
  const phaseRef = useRef(phase);
  const onPickRef = useRef(onPick);
  const selectedRegionsRef = useRef<MapRegion[]>(selectedRegions);
  const disabledRef = useRef(disabled);

  const viewConfig = useMemo(() => {
    return getMapViewConfigForSelectedRegions(selectedRegions);
  }, [selectedRegions]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    selectedRegionsRef.current = selectedRegions;
  }, [selectedRegions]);

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    if (mapInstance.current) {
      mapInstance.current.setOptions({ mapTypeId: mapType });
    }
  }, [mapType]);

  useEffect(() => {
    if (!isMapLoaded || !window.google?.maps || !mapRef.current) return;
    if (mapInstance.current) return;

    const initialConfig = getMapViewConfigForSelectedRegions(
      selectedRegionsRef.current
    );

    const map = new window.google.maps.Map(mapRef.current, {
      mapId: 'DEMO_MAP_ID',
      center: initialConfig.center,
      zoom: initialConfig.zoom,
      minZoom: initialConfig.minZoom,
      maxZoom: initialConfig.maxZoom,
      mapTypeId: mapType,
      restriction: {
        latLngBounds: initialConfig.bounds,
        strictBounds: true,
      },
      disableDefaultUI: true,
      clickableIcons: false,
      gestureHandling: 'greedy',
      keyboardShortcuts: false,
      isFractionalZoomEnabled: true,
      draggableCursor: 'crosshair',
      draggingCursor: 'grabbing',
      backgroundColor: '#dbeafe',
    });

    let dragStartPos = { x: 0, y: 0 };
    const mousedownListener = map.addListener('mousedown', (e: any) => {
      if (e.domEvent) {
        dragStartPos = { x: e.domEvent.clientX, y: e.domEvent.clientY };
      }
    });

    const clickListener = map.addListener('click', (e: any) => {
      if (phaseRef.current !== 'playing' || disabledRef.current) return;
      if (!e.latLng) return;
      
      if (e.domEvent) {
        const dx = e.domEvent.clientX - dragStartPos.x;
        const dy = e.domEvent.clientY - dragStartPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > 5) return; // Ignore click if drag was more than 5px
      }

      const currentConfig = getMapViewConfigForSelectedRegions(
        selectedRegionsRef.current
      );
      const pickedPosition = clampLatLng(
        {
          lat: e.latLng.lat(),
          lng: e.latLng.lng(),
        },
        currentConfig.bounds
      );
      onPickRef.current(pickedPosition);
    });

    const dragEndListener = map.addListener('dragend', () => {
      const currentConfig = getMapViewConfigForSelectedRegions(
        selectedRegionsRef.current
      );
      const center = map.getCenter();
      if (!center) return;
      const clampedCenter = clampLatLng(
        {
          lat: center.lat(),
          lng: center.lng(),
        },
        currentConfig.bounds
      );
      map.panTo(clampedCenter);
    });

    mapInstance.current = map;

    window.setTimeout(() => {
      if (!mapInstance.current || !window.google?.maps) return;
      window.google.maps.event.trigger(mapInstance.current, 'resize');
      const bounds = new window.google.maps.LatLngBounds(
        {
          lat: initialConfig.bounds.south,
          lng: initialConfig.bounds.west,
        },
        {
          lat: initialConfig.bounds.north,
          lng: initialConfig.bounds.east,
        }
      );
      if (initialConfig.highlight) {
        mapInstance.current.fitBounds(bounds, {
          top: 24,
          right: 24,
          bottom: 24,
          left: 24,
        });
      } else {
        mapInstance.current.setCenter(initialConfig.center);
        mapInstance.current.setZoom(initialConfig.zoom);
      }
    }, 0);

    return () => {
      mousedownListener?.remove?.();
      clickListener?.remove?.();
      dragEndListener?.remove?.();
      guessMarker.current?.setMap?.(null);
      targetMarker.current?.setMap?.(null);
      routeLine.current?.setMap?.(null);
      regionHighlight.current?.setMap?.(null);
      historyMarkers.current.forEach(m => m.setMap?.(null));
      historyPolylines.current.forEach(p => p.setMap?.(null));
      guessMarker.current = null;
      targetMarker.current = null;
      routeLine.current = null;
      regionHighlight.current = null;
      historyMarkers.current = [];
      historyPolylines.current = [];
      mapInstance.current = null;
    };
  }, [isMapLoaded]);

  useEffect(() => {
    if (!mapInstance.current || !window.google?.maps) return;

    mapInstance.current.setOptions({
      mapTypeId: mapType,
      minZoom: viewConfig.minZoom,
      maxZoom: viewConfig.maxZoom,
      restriction: {
        latLngBounds: viewConfig.bounds,
        strictBounds: true,
      },
    });

    regionHighlight.current?.setMap?.(null);
    regionHighlight.current = null;

    const bounds = new window.google.maps.LatLngBounds(
      {
        lat: viewConfig.bounds.south,
        lng: viewConfig.bounds.west,
      },
      {
        lat: viewConfig.bounds.north,
        lng: viewConfig.bounds.east,
      }
    );

    if (viewConfig.highlight) {
      regionHighlight.current = new window.google.maps.Rectangle({
        map: mapInstance.current,
        bounds: viewConfig.bounds,
        clickable: false,
        strokeColor: '#2563eb',
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: '#3b82f6',
        fillOpacity: 0.08,
      });
      mapInstance.current.fitBounds(bounds, {
        top: 24,
        right: 24,
        bottom: 24,
        left: 24,
      });
    } else {
      mapInstance.current.setCenter(viewConfig.center);
      mapInstance.current.setZoom(viewConfig.zoom);
    }
  }, [viewConfig]);

  useEffect(() => {
    if (!mapInstance.current || !window.google?.maps) return;
    if (!guess) {
      guessMarker.current?.setMap?.(null);
      guessMarker.current = null;
      return;
    }

    const safeGuess = clampLatLng(guess, viewConfig.bounds);

    if (!guessMarker.current) {
      const avatarContainer = document.createElement('div');
      avatarContainer.className =
        'relative w-10 h-10 rounded-full border-2 border-white shadow-lg overflow-hidden bg-blue-500 flex items-center justify-center';

      if (userAvatar) {
        const img = document.createElement('img');
        img.src = userAvatar;
        img.className = 'w-full h-full object-cover';
        img.referrerPolicy = 'no-referrer';
        avatarContainer.appendChild(img);
      } else {
        const span = document.createElement('span');
        span.className = 'text-white text-[10px] font-bold';
        span.innerText = 'YOU';
        avatarContainer.appendChild(span);
      }

      const tail = document.createElement('div');
      tail.className =
        'absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rotate-45';
      avatarContainer.appendChild(tail);

      guessMarker.current =
        new window.google.maps.marker.AdvancedMarkerElement({
          map: mapInstance.current,
          title: 'Your guess',
          content: avatarContainer,
          gmpDraggable: phase === 'playing' && !disabled && !submitting,
        });

      guessMarker.current.addListener('dragend', (e: any) => {
        if (phaseRef.current !== 'playing' || disabledRef.current) return;
        if (e.latLng) {
          const currentConfig = getMapViewConfigForSelectedRegions(
            selectedRegionsRef.current
          );
          const pickedPosition = clampLatLng(
            {
              lat: e.latLng.lat(),
              lng: e.latLng.lng(),
            },
            currentConfig.bounds
          );
          onPickRef.current(pickedPosition);

          // Trigger drop bounce animation
          const element = guessMarker.current.content;
          if (element) {
            element.classList.remove('animate-bounce');
            void element.offsetWidth;
            element.classList.add('animate-bounce');
            setTimeout(() => {
              element.classList.remove('animate-bounce');
            }, 1000);
          }
        }
      });
    } else {
      // Trigger simple pop effect
      const element = guessMarker.current.content;
      if (element) {
        element.classList.remove('animate-bounce');
        void element.offsetWidth;
        element.classList.add('animate-bounce');
        setTimeout(() => {
          element.classList.remove('animate-bounce');
        }, 1000);
      }
    }
    guessMarker.current.gmpDraggable = phase === 'playing' && !disabled && !submitting;
    guessMarker.current.position = safeGuess;
  }, [guess, viewConfig, phase, disabled, submitting, userAvatar]);

  useEffect(() => {
    if (!mapInstance.current || !window.google?.maps) return;
    if (phase !== 'reveal' || !target) {
      targetMarker.current?.setMap?.(null);
      routeLine.current?.setMap?.(null);
      otherGuessMarkers.current.forEach((m) => m.setMap?.(null));
      otherRoutes.current.forEach((l) => l.setMap?.(null));
      targetMarker.current = null;
      routeLine.current = null;
      otherGuessMarkers.current = [];
      otherRoutes.current = [];
      return;
    }

    const safeTarget = clampLatLng(target, viewConfig.bounds);

    if (!targetMarker.current) {
      const pinContainer = document.createElement('div');
      pinContainer.className = 'relative flex items-center justify-center';

      const pinBackground = document.createElement('div');
      pinBackground.className =
        'w-10 h-10 rounded-full border-4 border-white shadow-2xl bg-red-600 flex items-center justify-center animate-bounce';
      pinBackground.style.animationDuration = '1.5s';

      const innerDot = document.createElement('div');
      innerDot.className = 'w-3 h-3 bg-white rounded-full';
      pinBackground.appendChild(innerDot);

      const tail = document.createElement('div');
      tail.className =
        'absolute -bottom-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-white rotate-45';
      pinContainer.appendChild(pinBackground);
      pinContainer.appendChild(tail);

      targetMarker.current =
        new window.google.maps.marker.AdvancedMarkerElement({
          map: mapInstance.current,
          title: 'Correct location',
          content: pinContainer,
        });
    }
    targetMarker.current.position = safeTarget;

    const isActive = () =>
      phaseRef.current === 'reveal' && !!mapInstance.current;

    otherGuessMarkers.current.forEach((m) => m.setMap?.(null));
    otherRoutes.current.forEach((l) => l.setMap?.(null));
    otherGuessMarkers.current = [];
    otherRoutes.current = [];

    if (opponentResults && opponentResults.length > 0) {
      opponentResults.forEach((result) => {
        drawOpponentResult(
          mapInstance.current,
          result,
          null,
          otherGuessMarkers.current,
          otherRoutes.current,
          viewConfig.bounds
        );
      });
    }

    if (guess) {
      const safeGuess = clampLatLng(guess, viewConfig.bounds);

      if (!routeLine.current) {
        routeLine.current = new window.google.maps.Polyline({
          map: mapInstance.current,
          strokeColor: '#3b82f6',
          strokeOpacity: 0.8,
          strokeWeight: 3,
          clickable: false,
          geodesic: false,
          icons: [
            {
              icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 },
              offset: '0',
              repeat: '15px',
            },
          ],
        } as any);
      }
      routeLine.current.setPath([safeGuess, safeTarget]);

      window.setTimeout(() => {
        if (!isActive() || !mapRef.current) return;

        const currentCenter = mapInstance.current.getCenter();
        if (!currentCenter) return;

        const from: CameraState = {
          lat: currentCenter.lat(),
          lng: currentCenter.lng(),
          zoom: mapInstance.current.getZoom() || 2,
        };

        const overview = computeOverviewCamera(
          safeGuess,
          safeTarget,
          mapRef.current,
          100
        );

        const overviewDuration = Math.min(
          1200,
          Math.max(800, Math.abs(overview.zoom - from.zoom) * 120)
        );

        smoothCamera(
          mapInstance.current,
          from,
          overview,
          overviewDuration,
          isActive,
          () => {
            window.setTimeout(() => {
              if (!isActive()) return;

              const midCenter = mapInstance.current.getCenter();
              if (!midCenter) return;

              const flyFrom: CameraState = {
                lat: midCenter.lat(),
                lng: midCenter.lng(),
                zoom: mapInstance.current.getZoom() || overview.zoom,
              };

              const dest: CameraState = {
                lat: safeTarget.lat,
                lng: safeTarget.lng,
                zoom: 12,
              };

              const flyDuration = Math.min(
                2500,
                Math.max(1200, Math.abs(dest.zoom - flyFrom.zoom) * 150)
              );

              smoothCamera(
                mapInstance.current,
                flyFrom,
                dest,
                flyDuration,
                isActive
              );
            }, 500);
          }
        );
      }, 300);
    } else {
      window.setTimeout(() => {
        if (!isActive()) return;

        const currentCenter = mapInstance.current.getCenter();
        if (!currentCenter) return;

        const from: CameraState = {
          lat: currentCenter.lat(),
          lng: currentCenter.lng(),
          zoom: mapInstance.current.getZoom() || 2,
        };

        const dest: CameraState = {
          lat: safeTarget.lat,
          lng: safeTarget.lng,
          zoom: 12,
        };

        const duration = Math.min(
          2500,
          Math.max(1200, Math.abs(dest.zoom - from.zoom) * 150)
        );

        smoothCamera(mapInstance.current, from, dest, duration, isActive);
      }, 300);
    }
  }, [phase, target, guess, viewConfig]);

  useEffect(() => {
    if (!mapInstance.current || !window.google?.maps) return;
    if (phase !== 'finished') {
      historyMarkers.current.forEach((m) => m.setMap?.(null));
      historyPolylines.current.forEach((p) => p.setMap?.(null));
      historyMarkers.current = [];
      historyPolylines.current = [];
      return;
    }

    const bounds = new window.google.maps.LatLngBounds();
    let hasPins = false;

    allResults.forEach((result) => {
      if (result.guess) {
        const guessPinContainer = document.createElement('div');
        guessPinContainer.className =
          'relative w-10 h-10 rounded-full border-2 border-white shadow-lg overflow-hidden bg-blue-500 flex items-center justify-center';
        if (userAvatar) {
          const img = document.createElement('img');
          img.src = userAvatar;
          img.className = 'w-full h-full object-cover';
          img.referrerPolicy = 'no-referrer';
          guessPinContainer.appendChild(img);
        } else {
          const span = document.createElement('span');
          span.className = 'text-white text-[10px] font-bold';
          span.innerText = 'YOU';
          guessPinContainer.appendChild(span);
        }
        const tail = document.createElement('div');
        tail.className =
          'absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rotate-45';
        guessPinContainer.appendChild(tail);

        const mGuess =
          new window.google.maps.marker.AdvancedMarkerElement({
            map: mapInstance.current,
            position: result.guess,
            content: guessPinContainer,
            title: `Round ${result.round} Guess`,
          });
        historyMarkers.current.push(mGuess);
        bounds.extend(result.guess);
        hasPins = true;
      }

      const targetPinContainer = document.createElement('div');
      targetPinContainer.className =
        'relative w-7 h-7 rounded-full border-2 border-white bg-red-600 shadow-lg flex items-center justify-center';
      const innerT = document.createElement('div');
      innerT.className = 'w-2 h-2 bg-white rounded-full';
      targetPinContainer.appendChild(innerT);
      const tTail = document.createElement('div');
      tTail.className =
        'absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-white rotate-45';
      targetPinContainer.appendChild(tTail);

      const mTarget =
        new window.google.maps.marker.AdvancedMarkerElement({
          map: mapInstance.current,
          position: result.target,
          content: targetPinContainer,
          title: `Round ${result.round} Answer`,
        });
      historyMarkers.current.push(mTarget);
      bounds.extend(result.target);
      hasPins = true;

      if (result.guess) {
        const line = new window.google.maps.Polyline({
          map: mapInstance.current,
          path: [result.guess, result.target],
          strokeColor: '#3b82f6',
          strokeOpacity: 0.8,
          strokeWeight: 3,
          geodesic: false,
          icons: [
            {
              icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 2 },
              offset: '0',
              repeat: '10px',
            },
          ],
        } as any);
        historyPolylines.current.push(line);
      }
    });

    opponentResults.forEach((result) => {
      if (drawOpponentResult(
        mapInstance.current,
        result,
        bounds,
        historyMarkers.current,
        historyPolylines.current,
        viewConfig.bounds
      )) {
        hasPins = true;
      }
    });

    if (hasPins) {
      window.setTimeout(() => {
        if (!mapInstance.current) return;
        mapInstance.current.fitBounds(bounds, {
          top: 100,
          right: 100,
          bottom: 100,
          left: 100,
        });
      }, 500);
    }
  }, [phase, allResults]);

  useEffect(() => {
    if (!mapInstance.current || !window.google?.maps) return;
    if (phase === 'playing' && !guess) {
      if (viewConfig.highlight) {
        const bounds = new window.google.maps.LatLngBounds(
          { lat: viewConfig.bounds.south, lng: viewConfig.bounds.west },
          { lat: viewConfig.bounds.north, lng: viewConfig.bounds.east }
        );
        mapInstance.current.fitBounds(bounds, {
          top: 24,
          right: 24,
          bottom: 24,
          left: 24,
        });
      } else {
        mapInstance.current.setCenter(viewConfig.center);
        mapInstance.current.setZoom(viewConfig.zoom);
      }
    }
  }, [phase, guess, target, viewConfig]);

  useEffect(() => {
    if (!mapInstance.current || !window.google?.maps) return;
    window.setTimeout(() => {
      if (!mapInstance.current || !window.google?.maps) return;
      window.google.maps.event.trigger(mapInstance.current, 'resize');
    }, 0);
  }, [isMapLoaded, phase, selectedRegions]);

  return (
    <div className="w-full h-full min-h-[220px] rounded-xl overflow-hidden bg-slate-200 relative group">
      <div
        ref={mapRef}
        className={cn(
          'w-full h-full min-h-[220px] transition-all duration-300',
          disabled && 'pointer-events-none',
          disabled && 'opacity-50 grayscale'
        )}
      />
      {(disabled || submitting || phase === 'waiting_for_others') && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] transition-all duration-300">
          <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin mb-2" />
          <span className="text-white text-xs font-semibold tracking-wide px-3 py-1 bg-black/30 rounded-full border border-white/10">
            {phase === 'waiting_for_others' ? 'Waiting for other players...' : 'Submitting guess...'}
          </span>
        </div>
      )}
    </div>
  );
}