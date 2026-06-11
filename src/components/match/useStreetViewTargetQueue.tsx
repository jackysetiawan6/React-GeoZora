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

  const roomTargetsRef = useRef(roomTargets);
  roomTargetsRef.current = roomTargets;
  const isRoomMatchRef = useRef(isRoomMatch);
  isRoomMatchRef.current = isRoomMatch;

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
    async (desiredCount: number, mode: GameModeId, totalRounds?: number, targetsOverride?: StreetViewTarget[]) => {
      const maxRounds = totalRounds ?? getRoundCount(mode, customRounds);
      const targetCount = Math.min(Math.max(0, desiredCount), maxRounds);
      const sourceTargets = targetsOverride || roomTargetsRef.current;

      // Check if room targets have changed from targetQueueRef.current
      let targetsChanged = false;
      if (isRoomMatchRef.current) {
        if (targetQueueRef.current.length !== sourceTargets.length) {
          targetsChanged = true;
        } else {
          for (let i = 0; i < sourceTargets.length; i++) {
            if (
              targetQueueRef.current[i]?.lat !== sourceTargets[i]?.lat ||
              targetQueueRef.current[i]?.lng !== sourceTargets[i]?.lng ||
              targetQueueRef.current[i]?.panoId !== sourceTargets[i]?.panoId
            ) {
              targetsChanged = true;
              break;
            }
          }
        }
      }

      if (!targetsChanged && targetQueueRef.current.length >= targetCount) return;

      if (generationPromiseRef.current) {
        await generationPromiseRef.current;
        if (!targetsChanged && targetQueueRef.current.length >= targetCount) return;
      }

      generationPromiseRef.current = (async () => {
        if (isRoomMatchRef.current) {
          const neededRoomTargets = sourceTargets.slice(0, targetCount);
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
            usedPanoIdsRef.current,
            mode,
            targetQueueRef.current
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
    [apiKey, customRounds, rememberPano, selectedMaps]
  );

  const seedInitialTargets = useCallback(
    async (mode: GameModeId, totalRounds: number, minimum = 3, targetsOverride?: StreetViewTarget[]) => {
      const seedCount = Math.min(minimum, totalRounds);
      await fillQueueTo(seedCount, mode, totalRounds, targetsOverride);
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
    async (roundNumber: number, mode: GameModeId, totalRounds: number, targetsOverride?: StreetViewTarget[]) => {
      if (roundNumber < 1 || roundNumber > totalRounds) return null;

      if (!targetQueueRef.current[roundNumber - 1]) {
        await fillQueueTo(roundNumber, mode, totalRounds, targetsOverride);
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