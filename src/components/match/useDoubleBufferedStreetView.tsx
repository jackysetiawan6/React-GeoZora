import { useCallback, useMemo, useRef, useState } from 'react';
import { loadGoogleMaps } from '../../lib/googleMapsLoader';
import type { StreetViewTarget } from '../../lib/MatchGame';

type PanoSlot = 'A' | 'B';

type StreetViewRules = {
  noMoving?: boolean;
  noPanning?: boolean;
  noZooming?: boolean;
};

type ReadySlot = {
  round: number;
  target: StreetViewTarget;
  ready: boolean;
  loading: boolean;
} | null;

type UseDoubleBufferedStreetViewArgs = {
  apiKey: string;
  rules: StreetViewRules;
  onHeadingChange: (heading: number) => void;
  onGoogleLoaded: () => void;
  onPan?: () => void;
  onZoom?: () => void;
};

function normalizeDegrees(v: number): number {
  return ((v % 360) + 360) % 360;
}

export function useDoubleBufferedStreetView({
  apiKey,
  rules,
  onHeadingChange,
  onGoogleLoaded,
  onPan,
  onZoom,
}: UseDoubleBufferedStreetViewArgs) {
  const containerARef = useRef<HTMLDivElement | null>(null);
  const containerBRef = useRef<HTMLDivElement | null>(null);

  const isProgrammaticPovRef = useRef(false);

  const panoRefs = useRef<Record<PanoSlot, any | null>>({
    A: null,
    B: null,
  });

  const listenerRefs = useRef<Record<PanoSlot, any[]>>({
    A: [],
    B: [],
  });

  const readyRefs = useRef<Record<PanoSlot, ReadySlot>>({
    A: null,
    B: null,
  });

  const activeSlotRef = useRef<PanoSlot>('A');
  const loadTokenRefs = useRef<Record<PanoSlot, number>>({
    A: 0,
    B: 0,
  });
  // Track per-slot fallback timers so they can be cancelled on unmount/reset
  const fallbackTimerRefs = useRef<Record<PanoSlot, number | null>>({
    A: null,
    B: null,
  });

  const [activeSlot, setActiveSlot] = useState<PanoSlot>('A');
  const [streetViewLoading, setStreetViewLoading] = useState(true);

  const getContainer = useCallback((slot: PanoSlot) => {
    return slot === 'A' ? containerARef.current : containerBRef.current;
  }, []);

  const cleanupSlotListeners = useCallback((slot: PanoSlot) => {
    listenerRefs.current[slot].forEach((listener) => listener?.remove?.());
    listenerRefs.current[slot] = [];
    // Cancel any pending fallback timer for this slot
    if (fallbackTimerRefs.current[slot] !== null) {
      clearTimeout(fallbackTimerRefs.current[slot]!);
      fallbackTimerRefs.current[slot] = null;
    }
  }, []);

  const getInactiveSlot = useCallback((): PanoSlot => {
    return activeSlotRef.current === 'A' ? 'B' : 'A';
  }, []);

  const setActiveSlotSafely = useCallback((slot: PanoSlot) => {
    activeSlotRef.current = slot;
    setActiveSlot(slot);
  }, []);

  const hasReadyRound = useCallback((round: number) => {
    const a = readyRefs.current.A;
    const b = readyRefs.current.B;

    return Boolean((a?.round === round && a.ready) || (b?.round === round && b.ready));
  }, []);

  const hasLoadingRound = useCallback((round: number) => {
    const a = readyRefs.current.A;
    const b = readyRefs.current.B;

    return Boolean(
      (a?.round === round && a.loading) || (b?.round === round && b.loading)
    );
  }, []);

  const getReadySlotForRound = useCallback((round: number): PanoSlot | null => {
    const a = readyRefs.current.A;
    const b = readyRefs.current.B;

    if (a?.round === round && a.ready) return 'A';
    if (b?.round === round && b.ready) return 'B';

    return null;
  }, []);

  const loadIntoSlot = useCallback(
    async (slot: PanoSlot, round: number, target: StreetViewTarget) => {
      if (!apiKey) throw new Error('Missing Google Maps API key.');

      const container = getContainer(slot);
      if (!container) throw new Error(`Missing Street View container ${slot}.`);

      const loadToken = ++loadTokenRefs.current[slot];

      cleanupSlotListeners(slot);

      readyRefs.current[slot] = {
        round,
        target,
        ready: false,
        loading: true,
      };

      await loadGoogleMaps(apiKey);
      onGoogleLoaded();

      const maps = window.google?.maps;

      if (!maps?.StreetViewPanorama) {
        throw new Error('Google Maps Street View API is unavailable.');
      }

      const noMoving = !!rules.noMoving;
      const noPanning = !!rules.noPanning;
      const noZooming = !!rules.noZooming;

      const initialPov = {
        heading: target.heading || 0,
        pitch: target.pitch || 0,
      };

      const options = {
        visible: true,
        disableDefaultUI: true,
        addressControl: false,
        linksControl: false,
        panControl: false,
        zoomControl: false,
        fullscreenControl: false,
        motionTrackingControl: false,
        imageDateControl: false,
        showRoadLabels: false,
        clickToGo: !noMoving,
        scrollwheel: !noZooming,
        disableDoubleClickZoom: noZooming,
        draggable: !noPanning,
        keyboardShortcuts: !(noMoving || noPanning || noZooming),
        zoom: 1,
      };

      if (!panoRefs.current[slot]) {
        panoRefs.current[slot] = new maps.StreetViewPanorama(container, options);
      } else {
        panoRefs.current[slot].setOptions(options);
        panoRefs.current[slot].setZoom(1);
      }

      const panorama = panoRefs.current[slot];

      let resolved = false;
      let isResettingPov = false;

      const isSlotActive = () => activeSlotRef.current === slot;

      const syncHeading = () => {
        const pov = panorama.getPov?.();

        if (pov && typeof pov.heading === 'number' && isSlotActive()) {
          onHeadingChange(normalizeDegrees(pov.heading));
        }
      };

      const enforceNoPanning = () => {
        if (!noPanning || isResettingPov) return;

        const pov = panorama.getPov?.();
        if (!pov) return;

        const headingChanged =
          Math.abs(normalizeDegrees(pov.heading) - normalizeDegrees(initialPov.heading)) >
          0.1;

        const pitchChanged = Math.abs((pov.pitch || 0) - (initialPov.pitch || 0)) > 0.1;

        if (!headingChanged && !pitchChanged) return;

        isResettingPov = true;
        isProgrammaticPovRef.current = true;
        panorama.setPov(initialPov);

        if (isSlotActive()) {
          onHeadingChange(normalizeDegrees(initialPov.heading));
        }

        window.setTimeout(() => {
          isResettingPov = false;
        }, 0);
      };

      const markReady = () => {
        if (resolved) return;
        if (loadTokenRefs.current[slot] !== loadToken) return;

        resolved = true;

        readyRefs.current[slot] = {
          round,
          target,
          ready: true,
          loading: false,
        };

        if (fallbackTimerRefs.current[slot] !== null) {
          window.clearTimeout(fallbackTimerRefs.current[slot]!);
          fallbackTimerRefs.current[slot] = null;
        }

        if (noPanning) enforceNoPanning();
        else syncHeading();
      };

      const waitUntilReady = new Promise<void>((resolve) => {
        const statusListener = panorama.addListener('status_changed', () => {
          if (loadTokenRefs.current[slot] !== loadToken) return;

          if (panorama.getStatus?.() === maps.StreetViewStatus.OK) {
            if (noPanning) enforceNoPanning();
            else syncHeading();
          }
        });

        const tilesListener = panorama.addListener('tilesloaded', () => {
          if (loadTokenRefs.current[slot] !== loadToken) return;

          const currentPano = panorama.getPano?.();
          const matchesTarget = target.panoId 
            ? currentPano === target.panoId
            : true;

          if (!matchesTarget) return;

          markReady();
          resolve();
        });

        const povListener = panorama.addListener('pov_changed', () => {
          if (loadTokenRefs.current[slot] !== loadToken) return;

          if (isProgrammaticPovRef.current) {
            isProgrammaticPovRef.current = false;
            if (noPanning) enforceNoPanning();
            else syncHeading();
            return;
          }

          if (noPanning) enforceNoPanning();
          else {
            syncHeading();
            if (isSlotActive() && onPan) {
              onPan();
            }
          }
        });

        const zoomListener = panorama.addListener('zoom_changed', () => {
          if (loadTokenRefs.current[slot] !== loadToken) return;

          if (isSlotActive() && !noZooming && onZoom) {
            onZoom();
          }
        });

        listenerRefs.current[slot] = [statusListener, tilesListener, povListener, zoomListener];

        // Resilience logic: Handle potential Google Street View loading failures (e.g. 503 Service Unavailable on tiles)
        // or slow connections. If tiles fail or the panorama gets stuck, we attempt to re-apply the position.
        fallbackTimerRefs.current[slot] = window.setTimeout(() => {
          fallbackTimerRefs.current[slot] = null;
          if (loadTokenRefs.current[slot] !== loadToken) return;

          // Instead of assuming it's ready, check if it actually matched
          const currentPano = panorama.getPano?.();
          const matchesTarget = target.panoId 
            ? currentPano === target.panoId
            : true;
            
          if (matchesTarget) {
            markReady();
            resolve();
          } else {
            // Force re-apply position if it somehow failed to take due to transient network/API issues
            if (target.panoId) {
              panorama.setPano(target.panoId);
            } else {
              panorama.setPosition({ lat: target.lat, lng: target.lng });
            }
          }
        }, 8000);
      });

      if (target.panoId) {
        panorama.setPano(target.panoId);
      } else {
        panorama.setPosition({
          lat: target.lat,
          lng: target.lng,
        });
      }

      isProgrammaticPovRef.current = true;
      panorama.setPov(initialPov);
      panorama.setVisible(true);
      maps.event.trigger(panorama, 'resize');

      if (isSlotActive()) {
        onHeadingChange(normalizeDegrees(initialPov.heading));
      }

      await waitUntilReady;
    },
    [
      apiKey,
      cleanupSlotListeners,
      getContainer,
      onGoogleLoaded,
      onHeadingChange,
      rules.noMoving,
      rules.noPanning,
      rules.noZooming,
    ]
  );

  const resetBuffers = useCallback(() => {
    cleanupSlotListeners('A');
    cleanupSlotListeners('B');

    loadTokenRefs.current = {
      A: loadTokenRefs.current.A + 1,
      B: loadTokenRefs.current.B + 1,
    };

    readyRefs.current = {
      A: null,
      B: null,
    };
    
    const panoA = panoRefs.current.A;
    const panoB = panoRefs.current.B;

    try {
      panoA?.setVisible?.(false);
    } catch {
      // Ignore Google Maps internal cleanup errors.
    }

    try {
      panoB?.setVisible?.(false);
    } catch {
      // Ignore Google Maps internal cleanup errors.
    }

    activeSlotRef.current = 'A';
    setActiveSlot('A');
    setStreetViewLoading(true);
  }, [cleanupSlotListeners]);

  const initFirstRound = useCallback(
    async ({
      round,
      target,
      nextTarget,
    }: {
      round: number;
      target: StreetViewTarget;
      nextTarget?: StreetViewTarget | null;
    }) => {
      resetBuffers();
      setStreetViewLoading(true);

      activeSlotRef.current = 'A';
      setActiveSlot('A');

      await loadIntoSlot('A', round, target);

      setStreetViewLoading(false);

      if (nextTarget) {
        void loadIntoSlot('B', round + 1, nextTarget).catch(() => {});
      }
    },
    [loadIntoSlot, resetBuffers]
  );

  const preloadRound = useCallback(
    async (round: number, target: StreetViewTarget | null) => {
      if (!target) return;
      if (hasReadyRound(round) || hasLoadingRound(round)) return;

      const inactiveSlot = getInactiveSlot();
      await loadIntoSlot(inactiveSlot, round, target);
    },
    [getInactiveSlot, hasLoadingRound, hasReadyRound, loadIntoSlot]
  );

  const showRound = useCallback(
    async (round: number, target: StreetViewTarget) => {
      const readySlot = getReadySlotForRound(round);

      if (readySlot) {
        setActiveSlotSafely(readySlot);
        setStreetViewLoading(false);

        const pov = panoRefs.current[readySlot]?.getPov?.();

        if (pov && typeof pov.heading === 'number') {
          onHeadingChange(normalizeDegrees(pov.heading));
        } else {
          onHeadingChange(normalizeDegrees(target.heading || 0));
        }

        return;
      }

      setStreetViewLoading(true);

      const inactiveSlot = getInactiveSlot();
      await loadIntoSlot(inactiveSlot, round, target);

      setActiveSlotSafely(inactiveSlot);
      setStreetViewLoading(false);
    },
    [
      getInactiveSlot,
      getReadySlotForRound,
      loadIntoSlot,
      onHeadingChange,
      setActiveSlotSafely,
    ]
  );

  return useMemo(
    () => ({
      containerARef,
      containerBRef,
      activeSlot,
      streetViewLoading,
      hasReadyRound,
      resetBuffers,
      initFirstRound,
      preloadRound,
      showRound,
    }),
    [
      activeSlot,
      streetViewLoading,
      hasReadyRound,
      resetBuffers,
      initFirstRound,
      preloadRound,
      showRound,
    ]
  );
}