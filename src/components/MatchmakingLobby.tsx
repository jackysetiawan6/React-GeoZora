import { useEffect, useRef, useState } from 'react';
import { Loader2, X, Swords } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { cn } from '../lib/utils';
import {
  startMatchmaking,
  generateTargets,
  createRoom,
  fetchRoom,
  leaveQueue,
  type MatchRoom,
} from '../lib/Matchmaking';
import { fetchPlayerStats, type PlayerStats } from '../lib/PlayerStats';
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
  const [status, setStatus] = useState<LobbyStatus>('searching');
  const [eloRange, setEloRange] = useState(150);
  const [elapsed, setElapsed] = useState(0);
  const [myStats, setMyStats] = useState<PlayerStats | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const cleanupRef = useRef<(() => void) | null>(null);
  const elapsedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    void fetchPlayerStats(user.uid).then((s) => setMyStats(s));
  }, [user?.uid]);

  useEffect(() => {
    if (status !== 'searching') return;
    elapsedRef.current = window.setInterval(() => setElapsed((p) => p + 1), 1000);
    return () => { if (elapsedRef.current) clearInterval(elapsedRef.current); };
  }, [status]);

  useEffect(() => {
    if (!user?.uid) return;

    setStatus('searching');
    setElapsed(0);

    const cancel = startMatchmaking(user.uid, {
      onSearching: (range) => {
        setEloRange(range);
      },
      onMatched: async (roomId, opponentId, opponentElo, isHost) => {
        setStatus('found');

        if (isHost) {
          setStatus('preparing');
          try {
            const totalRounds  = getRoundCount('headToHead', 10);
            const roundSeconds = getRoundSeconds('headToHead', 30);
            const targets      = await generateTargets(API_KEY, selectedMaps, totalRounds);
            const room         = await createRoom(roomId, user.uid, opponentId, targets, totalRounds, roundSeconds);
            if (!room) { setStatus('error'); setErrorMsg('Failed to create room.'); return; }
            onMatchReady(room, opponentId, opponentElo, true);
          } catch {
            setStatus('error');
            setErrorMsg('Failed to generate match targets.');
          }
        } else {
          setStatus('preparing');
          let attempts = 0;
          const poller = window.setInterval(async () => {
            attempts++;
            const room = await fetchRoom(roomId);
            if (room && room.targets.length > 0) {
              clearInterval(poller);
              onMatchReady(room, opponentId, opponentElo, false);
            } else if (attempts >= 30) {
              clearInterval(poller);
              setStatus('error');
              setErrorMsg('Opponent failed to set up the match.');
            }
          }, 1000);
        }
      },
      onError: (msg) => { setStatus('error'); setErrorMsg(msg); },
      onTimeout: () => setStatus('timeout'),
    });

    cleanupRef.current = cancel;
    return () => cancel();
  }, [user?.uid, selectedMaps, onMatchReady]);

  const handleCancel = () => {
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
              {status === 'searching' && `ELO range: ±${eloRange} · ${formatTime(elapsed)} elapsed`}
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

            {status === 'searching' && (
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