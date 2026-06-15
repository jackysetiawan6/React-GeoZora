import { useEffect, useRef, useState } from 'react';
import { Loader2, X, Swords, ArrowLeft, Info } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { cn } from '../lib/utils';
import { useNetworkStatus } from '../lib/useNetworkStatus';
import {
  startMatchmaking,
  generateTargets,
  createRoom,
  fetchRoom,
  updateRoom,
  leaveQueue,
  type MatchRoom,
} from '../lib/Matchmaking';
import { fetchPlayerStats, type PlayerStats } from '../lib/PlayerStats';
import { logSystemError } from '../lib/supabase';
import { getRoundCount, getRoundSeconds } from '../lib/MatchGame';
import type { MapRegion } from '../lib/MapRegions';

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_PLATFORM_KEY ?? '';

type LobbyStatus = 'searching' | 'found' | 'preparing' | 'error' | 'timeout';

interface MatchmakingLobbyProps {
  selectedMaps: MapRegion[];
  onMatchReady: (room: MatchRoom, opponentId: string, opponentElo: number, isHost: boolean) => void;
  onCancel: () => void;
}

export default function MatchmakingLobby({
  selectedMaps,
  onMatchReady,
  onCancel,
}: MatchmakingLobbyProps) {
  const { user } = useAuth();
  const { isOnline } = useNetworkStatus();
  const [status, setStatus] = useState<LobbyStatus>('searching');
  const [eloRange, setEloRange] = useState(150);
  const [elapsed, setElapsed] = useState(0);
  const [myStats, setMyStats] = useState<PlayerStats | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [connectionNote, setConnectionNote] = useState('');
  const [retrySequence, setRetrySequence] = useState(0);

  const cleanupRef = useRef<(() => void) | null>(null);
  const elapsedRef = useRef<number | null>(null);
  const opponentPollerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const sessionKeyRef = useRef('');

  const clearOpponentPoller = () => {
    if (opponentPollerRef.current) {
      clearInterval(opponentPollerRef.current);
      opponentPollerRef.current = null;
    }
  };

  useEffect(() => {
    if (!user?.uid) return;
    void fetchPlayerStats(user.uid).then((s) => setMyStats(s));
  }, [user?.uid]);

  useEffect(() => {
    if (status !== 'searching') return;
    elapsedRef.current = window.setInterval(() => setElapsed((p) => p + 1), 1000);
    return () => {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    };
  }, [status]);

  useEffect(() => {
    if (!user?.uid) return;

    const sessionKey = `${user.uid}:${selectedMaps.join('|')}`;
    if (sessionKeyRef.current !== sessionKey) {
      sessionKeyRef.current = sessionKey;
      retryAttemptRef.current = 0;
      setRetrySequence(0);
      setConnectionNote('');
      setErrorMsg('');
    }

    setStatus('searching');
    setElapsed(0);

    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    const cancel = startMatchmaking(user.uid, {
      onSearching: (range) => {
        setEloRange(range);
        if (retryAttemptRef.current === 0) {
          setConnectionNote('');
        }
      },
      onMatched: async (roomId, opponentId, opponentElo, isHost) => {
        retryAttemptRef.current = 0;
        setConnectionNote('');
        setErrorMsg('');
        setStatus('found');

        if (isHost) {
          setStatus('preparing');
          try {
            const totalRounds  = getRoundCount('headToHead', 10);
            const roundSeconds = getRoundSeconds('headToHead', 30);
            const initialTargetCount = Math.min(2, totalRounds);
            const initialTargets = await generateTargets(API_KEY, selectedMaps, initialTargetCount, "headToHead");
            const room         = await createRoom(roomId, user.uid, opponentId, initialTargets, totalRounds, roundSeconds, false, false, false, selectedMaps, 'active', 'headToHead', true);
            if (!room) {
              setStatus('error');
              setErrorMsg('Failed to create room.');
              void leaveQueue(user.uid);
              return;
            }
            onMatchReady(room, opponentId, opponentElo, true);

            if (initialTargetCount < totalRounds) {
              void (async () => {
                try {
                  const remainingTargets = await generateTargets(
                    API_KEY,
                    selectedMaps,
                    totalRounds - initialTargetCount,
                    "headToHead",
                  );
                  await updateRoom(roomId, {
                    targets: [...initialTargets, ...remainingTargets],
                  });
                } catch (backgroundError) {
                  console.error('Failed to continue generating H2H targets:', backgroundError);
                  void logSystemError('Matchmaking background target generation failure', {
                    roomId,
                    opponentId,
                    error: backgroundError instanceof Error ? backgroundError.message : String(backgroundError),
                  });
                }
              })();
            }
          } catch (e) {
            setStatus('error');
            setErrorMsg('Failed to generate match targets.');
            void leaveQueue(user.uid);
            void logSystemError('Matchmaking target/room generation failure', {
              roomId,
              opponentId,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        } else {
          setStatus('preparing');
          clearOpponentPoller();
          let attempts = 0;
          opponentPollerRef.current = window.setInterval(async () => {
            attempts++;
            const room = await fetchRoom(roomId);
              if (room && room.targets.length >= 2) {
              clearOpponentPoller();
              onMatchReady(room, opponentId, opponentElo, false);
              } else if (room && room.status === 'completed') {
                clearOpponentPoller();
                setStatus('error');
                setErrorMsg('Opponent failed to set up the match.');
            } else if (attempts >= 45) {
              clearOpponentPoller();
              setStatus('error');
              setErrorMsg('Opponent failed to set up the match.');
            }
          }, 1000);
        }
      },
        onError: (msg) => {
          clearOpponentPoller();
          if (!isOnline) {
            setStatus('error');
            setConnectionNote('Connection is offline. Reconnect to resume matchmaking.');
            setErrorMsg(msg);
            return;
          }

          if (retryAttemptRef.current < 2) {
            const nextAttempt = retryAttemptRef.current + 1;
            const delayMs = 1500 * nextAttempt;
            retryAttemptRef.current = nextAttempt;
            setStatus('searching');
            setErrorMsg('');
            setConnectionNote(
              `Connection hiccup detected. Retrying matchmaking (${nextAttempt}/3) in ${Math.ceil(delayMs / 1000)}s...`,
            );
            retryTimerRef.current = window.setTimeout(() => {
              retryTimerRef.current = null;
              setElapsed(0);
              setStatus('searching');
              setRetrySequence(prev => prev + 1);
            }, delayMs);
            return;
          }

          setStatus('error');
          setConnectionNote('');
          setErrorMsg(msg);
        },
        onTimeout: () => {
          clearOpponentPoller();
          setConnectionNote('');
          setStatus('timeout');
        },
    });

    cleanupRef.current = cancel;
        return () => {
          clearOpponentPoller();
          if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
          }
          cancel();
        };
  }, [user?.uid, selectedMaps, onMatchReady, isOnline, retrySequence]);

  const handleCancel = () => {
        clearOpponentPoller();
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    cleanupRef.current?.();
    if (user?.uid) void leaveQueue(user.uid);
    onCancel();
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--color-app-overlay)] backdrop-blur-sm">
      {(status === 'searching' || status === 'found' || status === 'preparing') && (
        <button
          onClick={handleCancel}
          className="absolute top-6 left-6 p-3 rounded-full border border-[var(--color-app-border)] bg-[var(--color-app-panel)]/80 text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] hover:bg-[var(--color-app-hover)] transition-all shadow-md z-[60] flex items-center justify-center cursor-pointer"
          title="Exit Matchmaking"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
      )}
      <div className="max-w-md w-full mx-4 rounded-3xl border border-[var(--color-app-border)] bg-[var(--color-app-panel)]/95 backdrop-blur-2xl p-8 shadow-2xl text-center text-[var(--color-app-text)]">

        {/* Searching */}
        {(status === 'searching' || status === 'found' || status === 'preparing') && (
          <>
            <div className="flex justify-center mb-5">
              <div className="relative">
                <div className="w-20 h-20 rounded-full border-2 border-[var(--color-app-blue)]/30 flex items-center justify-center">
                  <Swords className="w-9 h-9 text-[var(--color-app-blue)]" />
                </div>
                <div className="absolute inset-0 rounded-full border-2 border-t-[var(--color-app-blue)] border-r-transparent border-b-transparent border-l-transparent animate-spin" />
              </div>
            </div>

            <div className="text-[var(--color-app-text)] text-xl font-bold tracking-tight mb-1">
              {status === 'searching' && 'Finding Opponent...'}
              {status === 'found'     && 'Opponent Found!'}
              {status === 'preparing' && 'Preparing Match...'}
            </div>

            <p className="text-[var(--color-app-text-muted)] text-sm mb-5">
              {status === 'searching' && (connectionNote || `ELO range: ±${eloRange} · ${formatTime(elapsed)} elapsed`)}
              {status === 'found'     && 'Connecting to match room...'}
              {status === 'preparing' && 'Generating panoramas, hold tight...'}
            </p>

            {myStats && (
              <div className="flex justify-center gap-4 mb-6">
                <div className="rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg)]/40 px-4 py-2 text-center">
                  <div className="text-[var(--color-app-text-muted)] text-[10px] uppercase tracking-widest">Your ELO</div>
                  <div className="text-[var(--color-app-text)] font-bold text-lg">{myStats.elo}</div>
                </div>
                <div className="rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg)]/40 px-4 py-2 text-center">
                  <div className="text-[var(--color-app-text-muted)] text-[10px] uppercase tracking-widest">Games</div>
                  <div className="text-[var(--color-app-text)] font-bold text-lg">{myStats.games_played}</div>
                </div>
              </div>
            )}

            <div className="mb-6 text-left bg-[var(--color-app-bg)]/60 border border-[var(--color-app-border-light)] rounded-2xl p-4 text-xs">
              <div className="font-bold text-[var(--color-app-text)] mb-2 flex items-center gap-1.5">
                <Info className="w-4 h-4 text-[var(--color-app-blue)]" />
                Head-to-Head Rules & Scoring
              </div>
              <ul className="list-disc pl-4 space-y-1.5 text-[var(--color-app-text-muted)] font-medium">
                <li>Distance points: 5000 × e^(-distance / 1500) (up to 5,000 pts/rd).</li>
                <li><strong>Time Multiplier is FORCED:</strong> Guessing faster gives a bonus! Your score is scaled from 1.0x (instant guess) down to 0.6x (last-second guess).</li>
                <li>Highest total score after 10 rounds wins and gains ELO!</li>
              </ul>
            </div>

            {(status === 'searching' || status === 'found' || status === 'preparing') && (
              <button
                onClick={handleCancel}
                className="rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg)]/40 hover:bg-[var(--color-app-hover)] px-6 py-2.5 text-sm font-bold text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors flex items-center justify-center gap-2 mx-auto"
              >
                <X className="w-4 h-4" /> Cancel
              </button>
            )}
          </>
        )}

        {/* Timeout */}
        {status === 'timeout' && (
          <>
            <div className="text-[var(--color-app-text)] text-xl font-bold mb-2">Queue Timeout</div>
            <p className="text-[var(--color-app-text-muted)] text-sm mb-6">
              Looks like no one else is currently searching for a Head-to-Head match! You can try joining the queue again, or play Classic Mode in the meantime.
            </p>
            <button
              onClick={handleCancel}
              className="rounded-xl bg-[var(--color-app-text)] text-[var(--color-app-bg)] px-6 py-2.5 font-bold hover:opacity-90 transition-colors"
            >
              Back to Setup
            </button>
          </>
        )}

        {/* Error */}
        {status === 'error' && (
          <>
            <div className="text-red-300 text-xl font-bold mb-2">Matchmaking Error</div>
            <p className="text-[var(--color-app-text-muted)] text-sm mb-6">{errorMsg || 'Something went wrong.'}</p>
            <button
              onClick={handleCancel}
              className="rounded-xl bg-[var(--color-app-text)] text-[var(--color-app-bg)] px-6 py-2.5 font-bold hover:opacity-90 transition-colors"
            >
              Back to Setup
            </button>
          </>
        )}
      </div>
    </div>
  );
}