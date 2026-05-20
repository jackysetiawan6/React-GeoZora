import { Clock } from 'lucide-react';
import { cn } from '../../lib/utils';
import { MODE_CONFIGS, type GameModeId } from '../../lib/MatchGame';

const COMPASS_LABELS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

const COMPASS_TICK_STEP = 7.5;
const COMPASS_TICKS = Array.from(
  { length: Math.round(360 / COMPASS_TICK_STEP) },
  (_, i) => i * COMPASS_TICK_STEP
);

function normalizeDegrees(v: number): number {
  return ((v % 360) + 360) % 360;
}

function getSignedAngleDiff(target: number, current: number): number {
  return ((target - current + 540) % 360) - 180;
}

function getCompassLabel(heading: number): string {
  return COMPASS_LABELS[Math.round(normalizeDegrees(heading) / 22.5) % 16];
}

function getCompassTickLabel(degrees: number): string {
  return COMPASS_LABELS[Math.round(normalizeDegrees(degrees) / 22.5) % 16];
}

type MatchHudProps = {
  selectedMode: GameModeId;
  currentRoundIndex: number;
  roundCount: number;
  remainingSec: number;
  isRoomMatch: boolean;
  totalScore: number;
  opponentScore: number;
  phase: string;
  streetViewLoading: boolean;
  heading: number;
  showHint: boolean;
  onQuit?: () => void;
  onReport?: () => void;
};

export default function MatchHud({
  selectedMode,
  currentRoundIndex,
  roundCount,
  remainingSec,
  isRoomMatch,
  totalScore,
  opponentScore,
  phase,
  streetViewLoading,
  heading,
  showHint,
  onQuit,
  onReport,
}: MatchHudProps) {
  const compassDirection = getCompassLabel(heading);

  return (
    <>
      <div className="absolute top-5 left-5 right-5 z-20 pointer-events-none flex items-start justify-between gap-4">
        <div className="flex gap-4">
          <div className="pointer-events-auto rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-panel)]/80 backdrop-blur-xl shadow-[0_18px_45px_rgba(0,0,0,0.35)] px-4 py-3 min-w-[210px]">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-blue-400 shadow-[0_0_14px_rgba(96,165,250,0.9)]" />
              <div className="text-[var(--color-app-text)] text-sm font-bold tracking-tight">
                {MODE_CONFIGS[selectedMode].label}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[var(--color-app-text-muted)] text-[10px] uppercase tracking-[0.22em]">
                  Round
                </div>
                <div className="text-[var(--color-app-text)] text-lg font-black leading-none mt-1">
                  {currentRoundIndex || 1}
                  <span className="text-[var(--color-app-text-muted)] text-sm font-semibold">
                    {' '}
                    / {roundCount || '—'}
                  </span>
                </div>
              </div>

              {isRoomMatch ? (
                <div className="flex items-center gap-2">
                  <div className="rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1.5 text-[11px] font-bold text-blue-200">
                    You: {totalScore.toLocaleString()}
                  </div>
                  <div className="rounded-full border border-red-400/20 bg-red-400/10 px-3 py-1.5 text-[11px] font-bold text-red-200">
                    Opp: {opponentScore.toLocaleString()}
                  </div>
                </div>
              ) : (
                <div className="rounded-full border border-[var(--color-app-border)] bg-[var(--color-app-bg)]/30 px-3 py-1.5 text-[11px] font-bold text-[var(--color-app-text-muted)]">
                  Solo Run
                </div>
              )}
            </div>
          </div>
          {onQuit && (
            <button
              onClick={onQuit}
              className="pointer-events-auto h-fit rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-panel)]/80 px-4 py-2 text-xs font-bold uppercase tracking-wider text-[var(--color-app-text-muted)] shadow-lg backdrop-blur-xl transition-colors hover:bg-[var(--color-app-hover)] hover:text-[var(--color-app-text)]"
            >
              Quit
            </button>
          )}
          {onReport && (
            <button
              onClick={onReport}
              className="pointer-events-auto h-fit rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-panel)]/80 px-4 py-2 text-xs font-bold uppercase tracking-wider text-amber-500/70 shadow-lg backdrop-blur-xl transition-colors hover:bg-amber-500/10 hover:text-amber-500"
            >
              Report Issue
            </button>
          )}
        </div>

        <div
          className={cn(
            'pointer-events-auto rounded-2xl border backdrop-blur-xl px-5 py-3 flex items-center gap-3 shadow-[0_18px_45px_rgba(0,0,0,0.35)] transition-colors',
            remainingSec <= 10
              ? 'border-red-400/40 bg-red-500/15'
              : 'border-[var(--color-app-border)] bg-[var(--color-app-panel)]/80'
          )}
        >
          <div
            className={cn(
              'h-10 w-10 rounded-xl flex items-center justify-center border',
              remainingSec <= 10
                ? 'border-red-300/30 bg-red-400/15'
                : 'border-[var(--color-app-border)] bg-[var(--color-app-bg)]/30'
            )}
          >
            <Clock
              className={cn(
                'w-5 h-5',
                remainingSec <= 10 ? 'text-red-300' : 'text-[var(--color-app-blue)]'
              )}
            />
          </div>

          <div>
            <div className="text-[var(--color-app-text-muted)] text-[10px] uppercase tracking-[0.22em]">
              Time Left
            </div>
            <div
              className={cn(
                'text-2xl font-black tracking-wider leading-none mt-1',
                remainingSec <= 10 ? 'text-red-200' : 'text-[var(--color-app-text)]'
              )}
            >
              {Math.max(0, remainingSec).toString().padStart(2, '0')}s
            </div>
          </div>
        </div>
      </div>

      {phase === 'playing' && !streetViewLoading && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-30 pointer-events-none lg:top-5">
          <div className="relative h-12 w-[360px] overflow-hidden rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-panel)]/80 backdrop-blur-xl shadow-[0_18px_45px_rgba(0,0,0,0.35)]">
            <div className="absolute left-1/2 top-0 z-30 h-full w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-white/90 to-transparent" />

            <div className="absolute left-1/2 top-1 z-30 -translate-x-1/2">
              <div className="h-0 w-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-blue-300 drop-shadow-[0_0_8px_rgba(147,197,253,0.9)]" />
            </div>

            <div className="absolute inset-0">
              {COMPASS_TICKS.map((tickDegrees) => {
                const diff = getSignedAngleDiff(tickDegrees, heading);
                const left = 180 + diff * 4;

                if (left < -40 || left > 400) return null;

                const normalizedTick = normalizeDegrees(tickDegrees);
                const tickIndex = Math.round(normalizedTick / COMPASS_TICK_STEP);
                const isCardinal = tickIndex % 12 === 0;
                const isIntercardinal = tickIndex % 6 === 0;
                const isLabel = tickIndex % 3 === 0;

                return (
                  <div
                    key={tickDegrees}
                    className="absolute top-0 flex h-full -translate-x-1/2 items-center justify-center"
                    style={{ left: `${left}px` }}
                  >
                    <div
                      className={cn(
                        'rounded-full',
                        isCardinal
                          ? 'h-7 w-[2px] bg-white/90'
                          : isIntercardinal
                            ? 'h-5 w-[2px] bg-white/55'
                            : 'h-3 w-[2px] bg-white/25'
                      )}
                    />

                    {isLabel && (
                      <div
                        className={cn(
                          'absolute bottom-1 text-[10px] font-black tracking-[0.22em]',
                          isCardinal ? 'text-white' : 'text-white/65'
                        )}
                      >
                        {getCompassTickLabel(tickDegrees)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-16 bg-gradient-to-r from-[var(--color-app-panel)] to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-16 bg-gradient-to-l from-[var(--color-app-panel)] to-transparent" />

            <div className="absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--color-app-blue)]/25 bg-[var(--color-app-blue)]/20 px-3 py-1 text-[11px] font-black tracking-[0.26em] text-[var(--color-app-text)] shadow-lg">
              {compassDirection}
            </div>
          </div>
        </div>
      )}

      {showHint && phase === 'playing' && !streetViewLoading && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="rounded-full border border-[var(--color-app-border)] bg-[var(--color-app-panel)]/90 backdrop-blur-xl px-5 py-3 text-sm text-[var(--color-app-text)] shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            Use the map to place your pin, then submit before the timer runs out.
          </div>
        </div>
      )}
    </>
  );
}