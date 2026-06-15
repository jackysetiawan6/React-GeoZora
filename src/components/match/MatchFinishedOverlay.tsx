import React, { useEffect, useState } from 'react';
import GuessMiniMap from '../GuessMiniMap';
import { supabase } from '../../lib/supabase';
import { formatDistance, type RoundResult } from '../../lib/MatchGame';
import type { MapRegion } from '../../lib/MapRegions';
import type { MatchRoom } from '../../lib/Matchmaking';
import ChatPanel from './ChatPanel';
import VirtualChatPanel from './VirtualChatPanel';

type MatchFinishedOverlayProps = {
  displayName?: string | null;
  totalScore: number;
  history: RoundResult[];
  distanceMetric: string;
  isGoogleLoaded: boolean;
  selectedMaps: MapRegion[];
  mapType: string;
  userAvatar?: string | null;
  onRestart: () => void;
  onBackToDashboard?: () => void;
  isRoomMatch?: boolean;
  winnerId?: string | null;
  userId?: string | null;
  matchEndedReason?: string | null;
  roundSubmissions?: Record<number, Record<string, { guess: { lat: number; lng: number } | null }>>;
  standings?: Array<{
    uid: string;
    label: string;
    totalScore: number;
    roundScore: number;
    rank: number;
    delta?: number;
    isOffline?: boolean;
  }>;
  isHost?: boolean;
  isCreatorRoom?: boolean;
  room?: MatchRoom | null;
  isVsAI?: boolean;
  virtualMessages?: any[];
  onSendVirtualMessage?: (content: string) => void;
};

export default function MatchFinishedOverlay({
  displayName,
  totalScore,
  history,
  distanceMetric,
  isGoogleLoaded,
  selectedMaps,
  mapType,
  userAvatar,
  onRestart,
  onBackToDashboard,
  isRoomMatch,
  winnerId,
  userId,
  matchEndedReason,
  roundSubmissions = {},
  standings,
  isHost,
  isCreatorRoom,
  room,
  isVsAI,
  virtualMessages,
  onSendVirtualMessage,
}: MatchFinishedOverlayProps) {
  // Load avatars for participants so pins can show profile images
  const [profileMap, setProfileMap] = useState<Record<string, { avatarUrl: string | null; displayName: string | null }>>({});

  const normalizedReason = matchEndedReason?.toLowerCase() || "";
  const isInvalidMatch =
    normalizedReason.includes("invalid match") ||
    normalizedReason.includes("no active participants") ||
    normalizedReason.includes("all players left");
  const sortedStandings = [...(standings ?? [])].sort((a, b) => a.rank - b.rank);
  const leader = sortedStandings[0] ?? null;
  const runnerUp = sortedStandings[1] ?? null;
  const hasStandingsTie = Boolean(
    leader && runnerUp && leader.totalScore === runnerUp.totalScore,
  );
  const isWinner = winnerId === userId;
  const isLeader = Boolean(isRoomMatch && !isInvalidMatch && leader && leader.uid === userId);
  const isTie = isRoomMatch && !isInvalidMatch && !winnerId && hasStandingsTie;
  const roomResultLabel = isInvalidMatch
    ? "Invalid Match"
    : isTie
      ? "Tie Game"
      : isWinner || isLeader
        ? "Victory"
        : isRoomMatch
          ? "Defeat"
          : "Match Complete";

  const opponentResults = Object.entries(roundSubmissions).flatMap(([roundStr, submissions]) => {
    const roundNumber = parseInt(roundStr, 10);
    const target = history.find(h => h.round === roundNumber)?.target;
    if (!target) return [];

    let playerIndex = 0;
    return Object.entries(submissions)
      .filter(([uid]) => uid !== userId)
      .map(([uid, data]) => {
        const result = data.guess ? {
          guess: data.guess,
          target,
          userId: uid,
          avatarUrl: profileMap[uid]?.avatarUrl || null,
          round: roundNumber,
          playerIndex
        } : null;
        playerIndex++;
        return result;
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
  });

  useEffect(() => {
    const uids = new Set<string>();
    if (standings) {
      standings.forEach(s => { if (s.uid) uids.add(s.uid); });
    }
    Object.values(roundSubmissions).forEach(subs => {
      Object.keys(subs).forEach(k => { if (k) uids.add(k); });
    });

    const ids = Array.from(uids).filter(Boolean);
    if (ids.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('id, avatar_url, display_name')
          .in('id', ids as any[]);
        if (!cancelled && data) {
          const map: Record<string, { avatarUrl: string | null; displayName: string | null }> = {};
          data.forEach((r: any) => {
            map[r.id] = {
              avatarUrl: r.avatar_url || null,
              displayName: r.display_name || null,
            };
          });
          setProfileMap(map);
        }
      } catch (err) {
        console.error('Failed to load participant avatars', err);
      }
    })();

    return () => { cancelled = true; };
  }, [roundSubmissions, standings]);

  const getStandingLabel = (entry: (typeof sortedStandings)[number]) => {
    const profile = profileMap[entry.uid];
    return profile?.displayName || entry.label || 'Player';
  };

  const getStandingClassName = (entry: (typeof sortedStandings)[number], index: number) => {
    const isCurrentUser = entry.uid === userId;
    return [
      'flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5',
      isCurrentUser ? 'border-blue-400/40 bg-blue-500/10 ring-1 ring-blue-400/20' : 'border-[var(--color-app-border-light)] bg-[var(--color-app-bg)]/35',
    ].join(' ');
  };
  return (
    <div className="absolute inset-0 z-[200] flex bg-[var(--color-app-bg)] animate-in fade-in duration-500 overflow-hidden">
      <div className="w-[380px] h-full bg-[var(--color-app-panel)] border-r border-[var(--color-app-border)] flex flex-col shadow-2xl z-10">
        <div className="p-8 pb-4">
          <div className="text-[var(--color-app-blue)] font-black tracking-[0.2em] text-[10px] uppercase mb-1">
                    {roomResultLabel}
          </div>
          <h2 className="text-[var(--color-app-text)] text-3xl font-black tracking-tight">
            {displayName || 'Explorer'}
          </h2>
          {matchEndedReason && (
            <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium">
              {matchEndedReason}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-4 space-y-6 custom-scrollbar">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-bg)]/35 p-4 text-center">
              <div className="text-[var(--color-app-text-muted)] text-[9px] font-bold uppercase tracking-widest mb-1">
                Accuracy
              </div>
              <div className="text-[var(--color-app-text)] font-black text-xl">
                {history.length > 0
                  ? Math.round(((totalScore / history.length) / 5000) * 100)
                  : 0}
                %
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-bg)]/35 p-4 text-center">
              <div className="text-[var(--color-app-text-muted)] text-[9px] font-bold uppercase tracking-widest mb-1">
                Score
              </div>
              <div className="text-[var(--color-app-text)] font-black text-xl">
                {totalScore.toLocaleString()}
              </div>
            </div>
          </div>

          {isRoomMatch && standings && standings.length > 0 && (
            <div className="space-y-3">
              <div className="text-[var(--color-app-text-muted)] text-[10px] font-bold uppercase tracking-widest">
                Final Standings
              </div>

              <div className="space-y-2">
                {standings.map((entry, index) => (
                  <div
                    key={entry.uid}
                    className={getStandingClassName(entry, index)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={
                          index === 0
                            ? "flex h-7 w-7 items-center justify-center rounded-full bg-yellow-500/15 text-yellow-300 text-[10px] font-black"
                            : "flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-[var(--color-app-text-muted)] text-[10px] font-black"
                        }
                      >
                        {entry.rank}
                      </div>
                      <div className="min-w-0 flex items-center gap-2">
                        <div className="truncate text-xs font-bold text-[var(--color-app-text)]">
                          {getStandingLabel(entry)}
                        </div>
                        {entry.isOffline && (
                          <span className="text-[9px] font-black uppercase bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded border border-red-500/30 shrink-0">
                            AFK
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs font-black text-[var(--color-app-text)]">
                      {entry.totalScore.toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="text-[var(--color-app-text-muted)] text-[10px] font-bold uppercase tracking-widest">
              Score History
            </div>

            <div className="space-y-2">
              {history.map((entry, index) => (
                <div
                  key={index}
                  className="rounded-xl border border-[var(--color-app-border-light)] bg-[var(--color-app-bg)]/35 px-4 py-3 flex items-center justify-between group hover:bg-[var(--color-app-hover)] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-md bg-blue-500/20 text-blue-400 text-[10px] flex items-center justify-center font-bold">
                      {entry.round}
                    </div>
                    <div className="text-xs text-[var(--color-app-text)]/80 font-medium">
                      {formatDistance(entry.distanceKm, distanceMetric)}
                    </div>
                  </div>

                  <div className="text-sm font-bold text-[var(--color-app-blue)]">
                    +{entry.score.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-8 pt-4 border-t border-[var(--color-app-border)] space-y-3">
          {(!isCreatorRoom || isHost) && (
            <button
              onClick={onRestart}
              className="w-full bg-[var(--color-app-blue)] hover:bg-blue-500 text-white font-bold py-4 rounded-2xl transition shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2"
            >
              Play Again
            </button>
          )}

          <button
            onClick={onBackToDashboard}
            className="w-full bg-[var(--color-app-bg)]/35 hover:bg-[var(--color-app-hover)] text-[var(--color-app-text-muted)] font-bold py-4 rounded-2xl transition border border-[var(--color-app-border-light)]"
          >
            Back to Dashboard
          </button>
        </div>
      </div>

      <div className="flex-1 relative bg-[var(--color-app-bg)]">
        <GuessMiniMap
          guess={null}
          target={null}
          phase="finished"
          onPick={() => {}}
          isMapLoaded={isGoogleLoaded}
          selectedRegions={selectedMaps}
          mapType={mapType}
          userAvatar={userAvatar}
          allResults={history}
          opponentResults={opponentResults}
        />

        <div className="absolute top-6 left-6 pointer-events-none">
          <div className="bg-[var(--color-app-panel)]/80 backdrop-blur-md rounded-xl border border-[var(--color-app-border)] px-4 py-2 shadow-xl">
            <div className="text-[var(--color-app-text-muted)] text-[9px] font-bold uppercase tracking-widest mb-0.5">
              Map View
            </div>
            <div className="text-[var(--color-app-text)] text-xs font-medium">
              Showing all round locations & guesses
            </div>
          </div>
        </div>
        {isRoomMatch && standings && standings.length > 0 && (
          <div className="absolute top-6 right-6 pointer-events-none w-[min(320px,calc(100vw-3rem))] z-20">
            <div className="pointer-events-auto rounded-[1.5rem] border border-white/10 bg-[#0F1724]/92 backdrop-blur-3xl shadow-[0_18px_50px_rgba(0,0,0,0.45)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <div>
                  <div className="text-[9px] font-black uppercase tracking-[0.28em] text-[var(--color-app-text-muted)]">Final Standings</div>
                  <div className="text-[11px] text-[var(--color-app-text-muted)] mt-0.5">Match leaderboard</div>
                </div>
              </div>

              <div className="p-3 space-y-2">
                {standings.map((entry, index) => (
                  <div key={entry.uid} className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-white/5 px-3 py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={index === 0 ? "flex h-8 w-8 items-center justify-center rounded-full bg-yellow-500/15 text-yellow-300 text-xs font-black" : "flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-[var(--color-app-text-muted)] text-xs font-black"}>
                        {entry.rank}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="truncate text-sm font-bold text-[var(--color-app-text)]">{getStandingLabel(entry)}</div>
                          {entry.isOffline && (
                            <span className="text-[9px] font-black uppercase bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded border border-red-500/30 shrink-0">
                              AFK
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-[var(--color-app-text-muted)]">{entry.totalScore.toLocaleString()} pts</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      {isCreatorRoom && room && (
        <ChatPanel
          room={room}
          isHost={isHost}
          phase="finished"
          variant="floating"
        />
      )}
      {isVsAI && virtualMessages && onSendVirtualMessage && (
        <VirtualChatPanel
          messages={virtualMessages}
          onSendMessage={onSendVirtualMessage}
          phase="finished"
          variant="floating"
        />
      )}
    </div>
  );
}