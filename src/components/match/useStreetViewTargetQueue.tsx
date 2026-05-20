import { useCallback, useMemo, useRef } from 'react';
import {
  fetchRandomStreetViewTarget,
  getRoundCount,
  type GameModeId,
  type StreetViewTarget,
} from '../../lib/MatchGame';
import type { MapRegion } from '../../lib/MapRegions';

type UseStreetViewTargetQueueArgs = {
  apiKey: string;
  selectedMaps: MapRegion[];
  customRounds: number;
  isRoomMatch: boolean;
  roomTargets: StreetViewTarget[];
};

export function useStreetViewTargetQueue({
  apiKey,
  selectedMaps,
  customRounds,
  isRoomMatch,
  roomTargets,
}: UseStreetViewTargetQueueArgs) {
  const targetQueueRef = useRef<StreetViewTarget[]>([]);
  const usedPanoIdsRef = useRef<string[]>([]);
  const generationPromiseRef = useRef<Promise<void> | null>(null);

  const resetQueue = useCallback(() => {
    targetQueueRef.current = [];
    usedPanoIdsRef.current = [];
    generationPromiseRef.current = null;
  }, []);

  const rememberPano = useCallback((target: StreetViewTarget) => {
    if (!target.panoId) return;

    if (!usedPanoIdsRef.current.includes(target.panoId)) {
      usedPanoIdsRef.current = [...usedPanoIdsRef.current, target.panoId];
    }
  }, []);

  const fillQueueTo = useCallback(
    async (desiredCount: number, mode: GameModeId, totalRounds?: number) => {
      const maxRounds = totalRounds ?? getRoundCount(mode, customRounds);
      const targetCount = Math.min(Math.max(0, desiredCount), maxRounds);

      if (targetQueueRef.current.length >= targetCount) return;

      if (generationPromiseRef.current) {
        await generationPromiseRef.current;
        if (targetQueueRef.current.length >= targetCount) return;
      }

      generationPromiseRef.current = (async () => {
        if (isRoomMatch) {
          const neededRoomTargets = roomTargets.slice(0, targetCount);
          targetQueueRef.current = neededRoomTargets;
          neededRoomTargets.forEach(rememberPano);
          return;
        }

        while (targetQueueRef.current.length < targetCount) {
          if (!apiKey) throw new Error('Missing Google Maps API key.');
          if (selectedMaps.length === 0) throw new Error('No selected maps.');

          const nextTarget = await fetchRandomStreetViewTarget(
            apiKey,
            selectedMaps,
            usedPanoIdsRef.current
          );

          rememberPano(nextTarget);
          targetQueueRef.current = [...targetQueueRef.current, nextTarget];
        }
      })();

      try {
        await generationPromiseRef.current;
      } finally {
        generationPromiseRef.current = null;
      }
    },
    [apiKey, customRounds, isRoomMatch, rememberPano, roomTargets, selectedMaps]
  );

  const seedInitialTargets = useCallback(
    async (mode: GameModeId, totalRounds: number, minimum = 3) => {
      const seedCount = Math.min(minimum, totalRounds);
      await fillQueueTo(seedCount, mode, totalRounds);
      return targetQueueRef.current.slice(0, seedCount);
    },
    [fillQueueTo]
  );

  const ensureTargetsAhead = useCallback(
    async (currentRound: number, mode: GameModeId, totalRounds: number, ahead = 3) => {
      const desiredCount = Math.min(totalRounds, currentRound + ahead);
      await fillQueueTo(desiredCount, mode, totalRounds);
    },
    [fillQueueTo]
  );

  const getTargetForRound = useCallback(
    async (roundNumber: number, mode: GameModeId, totalRounds: number) => {
      if (roundNumber < 1 || roundNumber > totalRounds) return null;

      if (!targetQueueRef.current[roundNumber - 1]) {
        await fillQueueTo(roundNumber, mode, totalRounds);
      }

      return targetQueueRef.current[roundNumber - 1] ?? null;
    },
    [fillQueueTo]
  );

  return useMemo(
    () => ({
      targetQueueRef,
      resetQueue,
      seedInitialTargets,
      ensureTargetsAhead,
      getTargetForRound,
    }),
    [resetQueue, seedInitialTargets, ensureTargetsAhead, getTargetForRound]
  );
}