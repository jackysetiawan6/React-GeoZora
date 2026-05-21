import { useEffect, useState } from 'react';
import {
  ChevronRight,
  Clock,
  History,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { cn } from '../lib/utils';
import {
  formatDistance,
  formatScore,
  GameModeId,
  GamePhase,
  RoundResult,
  StreetViewTarget,
} from '../lib/MatchGame';
import type { MapRegion } from '../lib/MapRegions';
import GuessMiniMap from './GuessMiniMap';

export default function MatchSidebar({
  mode,
  currentRoundIndex: _currentRoundIndex,
  roundCount: _roundCount,
  roundSeconds: _roundSeconds,
  remainingSec: _remainingSec,
  totalScore: _totalScore,
  playerTotals,
  allScores = {},
  roundScores = {},
  history,
  phase,
  target,
  guess,
  onGuess,
  onSubmit,
  onNext,
  onRestart,
  onSelectMode: _onSelectMode,
  onStartCreatorRoom,
  customRounds,
  setCustomRounds,
  customSeconds,
  setCustomSeconds,
  showTips: _showTips,
  setShowTips: _setShowTips,
  winnerText: _winnerText,
  activePlayerLabel: _activePlayerLabel,
  sidebarOpen: _sidebarOpen,
  isMapLoaded,
  selectedMaps = ['world'],
  distanceMetric = 'km',
  mapPreference = 'roadmap',
  userAvatar = null,
  streetViewLoading = false,
  isSubmitting = false,
}: {
  mode: GameModeId;
  currentRoundIndex: number;
  roundCount: number;
  roundSeconds: number;
  remainingSec: number;
  totalScore: number;
  playerTotals: { 1: number; 2: number };
  allScores?: Record<string, number>;
  roundScores?: Record<string, number>;
  history: RoundResult[];
  phase: GamePhase;
  target: StreetViewTarget | null;
  guess: { lat: number; lng: number } | null;
  onGuess: (g: { lat: number; lng: number }) => void;
  onSubmit: () => void;
  onNext: () => void;
  onRestart: () => void;
  onSelectMode: (mode: GameModeId) => void;
  onStartCreatorRoom: () => void;
  customRounds: number;
  setCustomRounds: (value: number) => void;
  customSeconds: number;
  setCustomSeconds: (value: number) => void;
  showTips: boolean;
  setShowTips: (value: boolean) => void;
  winnerText: string;
  activePlayerLabel: string;
  sidebarOpen: boolean;
  isMapLoaded: boolean;
  selectedMaps?: MapRegion[];
  distanceMetric?: string;
  mapPreference?: string;
  userAvatar?: string | null;
  streetViewLoading?: boolean;
  isSubmitting?: boolean;
}) {
  const { user } = useAuth();
  const isCreator = mode === 'creatorRoom';
  const isClassic = mode === 'classic';
  const isChaos = mode === 'chaos';
  const hasHistory = history.length > 0;

  const [showHistory, setShowHistory] = useState(false);
  const isReveal = phase === 'reveal';
  const isRoomMatch = mode === 'headToHead' || mode === 'creatorRoom';
  const shouldForceShowHistory = isReveal && isRoomMatch;

  // Auto-close history when round changes or starts
  useEffect(() => {
    if (!shouldForceShowHistory) {
      setShowHistory(false);
    }
  }, [_currentRoundIndex, phase, shouldForceShowHistory]);
  const [mapExpanded, setMapExpanded] = useState(false);

  const mapSizeClass = mapExpanded
    ? 'w-[750px] h-[440px]'
    : 'w-[375px] h-[220px]';

  const actionWidthClass = mapExpanded ? 'w-[750px]' : 'w-[375px]';

  const primaryButton =
    phase === 'loading'
      ? {
          label: 'Loading...',
          onClick: () => {},
          disabled: true,
          style: 'blue'
        }
      : phase === 'playing'
      ? {
          label: isSubmitting ? 'Submitting...' : 'Submit Guess',
          onClick: onSubmit,
          disabled: !guess || isSubmitting,
          style: 'blue'
        }
      : phase === 'waiting_for_others' || phase === 'reveal'
      ? {
          label: 'Guessed',
          onClick: () => {},
          disabled: true,
          style: 'blue'
        }
      : phase === 'finished' && hasHistory
      ? {
          label: 'Play Again',
          onClick: onRestart,
          disabled: false,
          style: 'white'
        }
      : isCreator
      ? {
          label: 'Start Creator Room',
          onClick: onStartCreatorRoom,
          disabled: false,
          style: 'white'
        }
      : {
          label: 'Loading...',
          onClick: () => {},
          disabled: true,
          style: 'blue'
        };

  return (
    <>
      {/* History and Settings Floating Panel - Bottom Left */}
      <div className="absolute bottom-6 left-6 z-30 pointer-events-none flex flex-col items-start justify-end gap-3">
        {(hasHistory || isCreator) && (
          <div
            className={cn(
              'pointer-events-auto w-80 rounded-2xl border border-white/10 bg-[#111622]/95 backdrop-blur-xl shadow-2xl transition-all duration-300 overflow-hidden flex flex-col',
              showHistory || shouldForceShowHistory
                ? 'max-h-[60vh] opacity-100'
                : 'max-h-0 opacity-0 border-transparent shadow-none'
            )}
          >
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <div className="text-white font-semibold flex items-center gap-2">
                <History className="w-4 h-4 text-blue-400" />
                Match Details
              </div>

              {!shouldForceShowHistory && (
                <button
                  onClick={() => setShowHistory(false)}
                  className="text-white/50 hover:text-white transition"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            <div className="p-4 overflow-y-auto custom-scrollbar flex flex-col gap-5">
              {isCreator && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-white font-semibold mb-3 flex items-center gap-2">
                    <Settings className="w-4 h-4 text-white/50" />
                    Room Settings
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-xs uppercase tracking-[0.2em] text-white/40">
                        Rounds
                      </span>

                      <input
                        type="number"
                        min={2}
                        max={20}
                        value={customRounds}
                        onChange={(e) =>
                          setCustomRounds(Number(e.target.value))
                        }
                        className="mt-2 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-white outline-none focus:border-blue-400/50 transition"
                      />
                    </label>

                    <label className="block">
                      <span className="text-xs uppercase tracking-[0.2em] text-white/40">
                        Seconds
                      </span>

                      <input
                        type="number"
                        min={10}
                        max={180}
                        value={customSeconds}
                        onChange={(e) =>
                          setCustomSeconds(Number(e.target.value))
                        }
                        className="mt-2 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-white outline-none focus:border-blue-400/50 transition"
                      />
                    </label>
                  </div>

                  <div className="mt-3 text-[11px] text-white/40 flex items-center gap-1.5 leading-snug">
                    <Users className="w-3.5 h-3.5 shrink-0" />
                    Start match from bottom-right button to apply changes.
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-3 text-sm">
                  <div className="text-white/60 font-medium">
                    Round History
                  </div>

                  <div className="text-white/40 text-xs">
                    {history.length} played
                  </div>
                </div>

                <div className="space-y-2">
                  {history.length === 0 && (
                    <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-sm text-white/45">
                      No guesses yet.
                    </div>
                  )}

                  {history.map((entry, index) => (
                    <div
                      key={index}
                      className="rounded-xl border border-white/5 bg-white/5 px-3 py-3 flex items-center justify-between gap-3 text-sm"
                    >
                      <div>
                        <div className="text-white font-medium">
                          {isClassic ? `Round ${entry.round}` : `Rd ${entry.round} · P${entry.player}`}
                        </div>

                        <div className="text-xs text-white/45 mt-0.5">
                          {entry.guess
                            ? formatDistance(entry.distanceKm, distanceMetric)
                            : 'No guess'}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-white font-bold text-blue-400">
                          +{formatScore(entry.score)}
                        </div>

                        <div className="text-[10px] text-white/40 mt-0.5">
                          {entry.timeLeft}s left
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {mode === 'headToHead' || mode === 'creatorRoom' ? (
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-white/60 font-medium text-sm mb-3 flex items-center justify-between">
                    <span>Room Leaderboard</span>
                    <Users className="w-3.5 h-3.5 opacity-50" />
                  </div>

                  <div className="space-y-2">
                    {Object.entries(allScores).length > 0 ? (
                      Object.entries(allScores)
                        .sort(([, a], [, b]) => b - a)
                        .map(([uid, score], i) => (
                          <div key={uid} className="flex items-center justify-between bg-black/20 rounded-lg px-3 py-2 border border-white/5">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold",
                                i === 0 ? "bg-yellow-500 text-black" : "bg-white/10 text-white/50"
                              )}>
                                {i + 1}
                              </span>
                              <span className="text-xs text-white/80 font-medium whitespace-nowrap overflow-hidden text-ellipsis max-w-[120px]">
                                {uid === user?.uid ? 'You' : `Player #${uid.substring(0, 4)}`}
                              </span>
                              {roundScores[uid] !== undefined && phase === 'reveal' && (
                                <span className={cn(
                                  "text-[10px] font-bold ml-1",
                                  roundScores[uid] > 0 ? "text-green-400" : "text-white/40"
                                )}>
                                  +{formatScore(roundScores[uid])}
                                </span>
                              )}
                            </div>
                            <span className="text-sm font-bold text-white">
                              {formatScore(score)}
                            </span>
                          </div>
                        ))
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl bg-black/20 border border-white/5 px-3 py-3 text-center">
                          <div className="text-white/40 text-[10px] uppercase">You</div>
                          <div className="text-white font-bold mt-1">
                            {formatScore(playerTotals[1])}
                          </div>
                        </div>

                        <div className="rounded-xl bg-black/20 border border-white/5 px-3 py-3 text-center">
                          <div className="text-white/40 text-[10px] uppercase">Opponent</div>
                          <div className="text-white font-bold mt-1">
                            {formatScore(playerTotals[2])}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {(hasHistory || isCreator) && !shouldForceShowHistory && (
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={cn(
              'pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-[#131B2A]/85 backdrop-blur-md px-4 py-3 shadow-2xl transition hover:bg-white/10 text-sm font-semibold',
              showHistory ? 'text-white' : 'text-white/70'
            )}
          >
            <History className="w-4 h-4" />
            {showHistory ? 'Close Details' : 'Match Details'}
          </button>
        )}
      </div>

      {/* Floating Minimap and Actions - Bottom Right */}
      <div
        onMouseEnter={() => setMapExpanded(true)}
        onMouseLeave={() => setMapExpanded(false)}
        className={cn(
          "absolute bottom-6 right-6 z-30 pointer-events-none flex flex-col items-end gap-3 transition-opacity duration-500",
          phase === 'reveal' ? 'opacity-0 scale-95 pointer-events-none' : 'opacity-100 scale-100'
        )}
      >
        <div
          className={cn(
            'pointer-events-auto rounded-2xl overflow-hidden shadow-2xl transition-all duration-300 ease-in-out max-w-[calc(100vw-3rem)]',
            mapSizeClass
          )}
        >
          <div className="relative w-full h-full rounded-2xl overflow-hidden bg-slate-200">
            <GuessMiniMap
              guess={guess}
              target={target}
              phase={phase}
              onPick={onGuess}
              isMapLoaded={isMapLoaded}
              selectedRegions={selectedMaps}
              mapType={mapPreference}
              userAvatar={userAvatar}
              disabled={streetViewLoading || isSubmitting}
              submitting={isSubmitting}
            />

            {phase === 'reveal' && target && (
              <div className="absolute top-2 right-2 pointer-events-none">
                <div className="rounded-md border border-white/40 bg-green-600/90 px-2 py-1 text-[10px] font-bold text-white shadow-md backdrop-blur-sm">
                  TARGET REVEALED
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Action Button */}
        <div
          className={cn(
            'pointer-events-auto transition-all duration-300 ease-in-out max-w-[calc(100vw-3rem)]',
            actionWidthClass
          )}
        >
          <button
            onClick={primaryButton.onClick}
            disabled={primaryButton.disabled || isChaos}
            className={cn(
              'w-full rounded-2xl px-5 py-3.5 font-bold tracking-wide transition-all shadow-xl flex justify-center items-center gap-2',
              isChaos
                ? 'bg-white/5 text-white/45 cursor-not-allowed border border-white/10'
                : primaryButton.style === 'blue'
                ? 'bg-blue-600 text-white hover:bg-blue-500 hover:shadow-[0_0_20px_rgba(37,99,235,0.4)] disabled:opacity-50 disabled:cursor-not-allowed border border-blue-500'
                : 'bg-white text-black hover:bg-white/90 border border-white disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {isChaos ? 'Coming Soon' : primaryButton.label}

            {!isChaos && primaryButton.style === 'white' && (
              <ChevronRight className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
    </>
  );
}