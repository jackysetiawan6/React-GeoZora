import GuessMiniMap from '../GuessMiniMap';
import { formatDistance, type RoundResult } from '../../lib/MatchGame';
import type { MapRegion } from '../../lib/MapRegions';

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
}: MatchFinishedOverlayProps) {
  const isWinner = winnerId === userId;
  const isTie = isRoomMatch && !winnerId;

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
          round: roundNumber,
          playerIndex
        } : null;
        playerIndex++;
        return result;
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
  });
  return (
    <div className="absolute inset-0 z-[200] flex bg-[var(--color-app-bg)] animate-in fade-in duration-500 overflow-hidden">
      <div className="w-[380px] h-full bg-[var(--color-app-panel)] border-r border-[var(--color-app-border)] flex flex-col shadow-2xl z-10">
        <div className="p-8 pb-4">
          <div className="text-[var(--color-app-blue)] font-black tracking-[0.2em] text-[10px] uppercase mb-1">
            {isRoomMatch ? (isTie ? 'Tie Game' : isWinner ? 'Victory' : 'Defeat') : 'Match Complete'}
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
          <button
            onClick={onRestart}
            className="w-full bg-[var(--color-app-blue)] hover:bg-blue-500 text-white font-bold py-4 rounded-2xl transition shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2"
          >
            Play Again
          </button>

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
      </div>
    </div>
  );
}