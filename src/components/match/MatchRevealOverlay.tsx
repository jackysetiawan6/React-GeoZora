import { Clock, MapPin } from 'lucide-react';
import GuessMiniMap from '../GuessMiniMap';
import {
  formatDistance,
  type LatLng,
  type RoundResult,
  type StreetViewTarget,
} from '../../lib/MatchGame';
import type { MapRegion } from '../../lib/MapRegions';

type MatchRevealOverlayProps = {
  currentRoundIndex: number;
  currentResult: RoundResult;
  guess: LatLng | null;
  target: StreetViewTarget;
  isGoogleLoaded: boolean;
  selectedMaps: MapRegion[];
  mapType: string;
  userAvatar?: string | null;
  distanceMetric: string;
  locationName: string;
  opponentResults?: Array<{ guess: LatLng; target: LatLng; userId?: string; playerIndex: number; round?: number }>;
  onNext?: () => void;
};

function getQualitativeFeedback(distanceKm: number, score: number): { text: string; colorClass: string } {
  if (distanceKm < 0.25 || score >= 4950) {
    return { text: 'Bullseye!', colorClass: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' };
  } else if (distanceKm < 5 || score >= 4800) {
    return { text: 'Excellent!', colorClass: 'text-green-400 bg-green-500/10 border-green-500/20' };
  } else if (distanceKm < 50 || score >= 4500) {
    return { text: 'Close!', colorClass: 'text-teal-400 bg-teal-500/10 border-teal-500/20' };
  } else if (distanceKm < 250 || score >= 3500) {
    return { text: 'Good Guess!', colorClass: 'text-blue-400 bg-blue-500/10 border-blue-500/20' };
  } else if (distanceKm < 1000 || score >= 2000) {
    return { text: 'Not bad!', colorClass: 'text-amber-400 bg-amber-500/10 border-amber-500/20' };
  } else {
    return { text: 'Way off!', colorClass: 'text-rose-400 bg-rose-500/10 border-rose-500/20' };
  }
}

export default function MatchRevealOverlay({
  currentRoundIndex,
  currentResult,
  guess,
  target,
  isGoogleLoaded,
  selectedMaps,
  mapType,
  userAvatar,
  distanceMetric,
  locationName,
  opponentResults,
  onNext,
}: MatchRevealOverlayProps) {
  const feedback = getQualitativeFeedback(currentResult.distanceKm, currentResult.score);

  return (
    <div className="absolute inset-0 z-[100] bg-[#070B12] animate-in fade-in duration-500">
      <div className="w-full h-full relative">
        <GuessMiniMap
          guess={guess}
          target={target}
          phase="reveal"
          onPick={() => {}}
          isMapLoaded={isGoogleLoaded}
          selectedRegions={selectedMaps}
          mapType={mapType}
          userAvatar={userAvatar}
          opponentResults={opponentResults}
        />

        <div className="absolute bottom-0 left-0 right-0 pointer-events-none p-6 md:p-8">
          <div className="pointer-events-auto w-full max-w-5xl mx-auto bg-[#0F1724]/90 backdrop-blur-3xl rounded-[2rem] border border-white/10 p-5 md:p-6 shadow-[0_-20px_60px_rgba(0,0,0,0.6)] animate-in slide-in-from-bottom-10 duration-700">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 px-2">
              <div className="flex items-center gap-5 text-left w-full">
                <div className="w-14 h-14 rounded-2xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center shrink-0 shadow-[0_0_20px_rgba(59,130,246,0.2)]">
                  <MapPin className="w-7 h-7 text-blue-400" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-[var(--color-app-text-muted)] text-[9px] font-bold uppercase tracking-widest mb-1 flex items-center gap-2">
                    Round {currentRoundIndex} Result
                    <span className="w-1 h-1 rounded-full bg-[var(--color-app-border)]" />
                    <span className="text-[var(--color-app-blue)]/60 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Auto-advancing...
                    </span>
                  </div>

                  <h2 className="text-[var(--color-app-text)] text-xl md:text-2xl font-black tracking-tight leading-tight max-w-full">
                    {locationName || 'Unknown Location'}
                  </h2>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0 w-full md:w-auto">
                {/* Qualitative Feedback */}
                <div className={`hidden sm:flex items-center justify-center rounded-2xl px-5 py-3 border ${feedback.colorClass} font-black text-sm uppercase tracking-wider`}>
                  {feedback.text}
                </div>

                <div className="flex-1 md:flex-none bg-[var(--color-app-panel)] rounded-2xl px-6 py-3 border border-[var(--color-app-border)]">
                  <div className="text-[var(--color-app-text-muted)] text-[9px] uppercase tracking-widest mb-0.5 font-bold">
                    Distance
                  </div>
                  <div className="text-[var(--color-app-text)] text-lg font-black whitespace-nowrap">
                    {formatDistance(currentResult.distanceKm, distanceMetric)}
                  </div>
                </div>

                <div className="flex-1 md:flex-none bg-[var(--color-app-blue)]/10 rounded-2xl px-6 py-3 border border-[var(--color-app-blue)]/20">
                  <div className="text-[var(--color-app-blue)]/40 text-[9px] uppercase tracking-widest mb-0.5 font-bold">
                    Earnings
                  </div>
                  <div className="text-[var(--color-app-blue)] text-lg font-black whitespace-nowrap">
                    +{currentResult.score.toLocaleString()}
                  </div>
                </div>

                {onNext && (
                  <button
                    onClick={onNext}
                    className="flex-grow md:flex-none rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500/20 px-6 py-4.5 font-black text-sm tracking-wide shadow-lg shadow-emerald-950/20 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    Next Round →
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}