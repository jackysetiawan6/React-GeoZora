import { Clock, MapPin } from "lucide-react";
import GuessMiniMap from "../GuessMiniMap";
import {
	formatDistance,
	type LatLng,
	type RoundResult,
	type StreetViewTarget,
	type GameModeId,
} from "../../lib/MatchGame";
import type { MapRegion } from "../../lib/MapRegions";

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
	standings?: Array<{
		uid: string;
		label: string;
		totalScore: number;
		roundScore: number;
		rank: number;
		delta: number;
		hasGuessed?: boolean;
	}>;
	opponentResults?: Array<{
		guess: LatLng;
		target: LatLng;
		userId?: string;
		playerIndex: number;
		round?: number;
	}>;
	onNext?: () => void;
	mode?: GameModeId;
	totalRounds?: number;
};

function getQualitativeFeedback(
	distanceKm: number,
	score: number,
): { text: string; colorClass: string } {
	if (distanceKm < 0.25 || score >= 4950) {
		return {
			text: "Bullseye!",
			colorClass: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
		};
	} else if (distanceKm < 5 || score >= 4800) {
		return {
			text: "Excellent!",
			colorClass: "text-green-400 bg-green-500/10 border-green-500/20",
		};
	} else if (distanceKm < 50 || score >= 4500) {
		return {
			text: "Close!",
			colorClass: "text-teal-400 bg-teal-500/10 border-teal-500/20",
		};
	} else if (distanceKm < 250 || score >= 3500) {
		return {
			text: "Good Guess!",
			colorClass: "text-blue-400 bg-blue-500/10 border-blue-500/20",
		};
	} else if (distanceKm < 1000 || score >= 2000) {
		return {
			text: "Not bad!",
			colorClass: "text-amber-400 bg-amber-500/10 border-amber-500/20",
		};
	} else {
		return {
			text: "Way off!",
			colorClass: "text-rose-400 bg-rose-500/10 border-rose-500/20",
		};
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
	standings,
	opponentResults,
	onNext,
	mode,
	totalRounds,
}: MatchRevealOverlayProps) {
	const feedback = getQualitativeFeedback(
		currentResult.distanceKm,
		currentResult.score,
	);

	const isFinalRound = totalRounds ? currentRoundIndex >= totalRounds : false;
	const showNextButton = onNext && !isFinalRound && (mode === "classic" || mode === "vsAI");

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
											{isFinalRound ? "Finishing match..." : "Auto-advancing..."}
										</span>
									</div>

									<h2 className="text-[var(--color-app-text)] text-xl md:text-2xl font-black tracking-tight leading-tight max-w-full">
										{locationName || "Unknown Location"}
									</h2>
								</div>
							</div>

							<div className="flex items-center gap-3 shrink-0 w-full md:w-auto">
								{/* Qualitative Feedback */}
								<div
									className={`hidden sm:flex items-center justify-center rounded-2xl px-5 py-3 border ${feedback.colorClass} font-black text-sm uppercase tracking-wider`}>
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

								{showNextButton && (
									<button
										onClick={onNext}
										className="flex-grow md:flex-none rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500/20 px-6 py-4.5 font-black text-sm tracking-wide shadow-lg shadow-emerald-950/20 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-1.5">
										Next Round →
									</button>
								)}
							</div>
						</div>
					</div>
				</div>

				{standings && standings.length > 1 && (
					<div className="absolute top-6 right-6 z-[110] pointer-events-none w-[min(320px,calc(100vw-3rem))]">
						<div className="pointer-events-auto rounded-[1.5rem] border border-white/10 bg-[#0F1724]/92 backdrop-blur-3xl shadow-[0_18px_50px_rgba(0,0,0,0.45)] overflow-hidden animate-in fade-in slide-in-from-right-4 duration-500">
							<div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
								<div>
									<div className="text-[9px] font-black uppercase tracking-[0.28em] text-[var(--color-app-text-muted)]">
										Standings
									</div>
									<div className="text-[11px] text-[var(--color-app-text-muted)] mt-0.5">
										Rank changes after this round
									</div>
								</div>
								<div className="rounded-full border border-[var(--color-app-blue)]/20 bg-[var(--color-app-blue)]/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--color-app-blue)]">
									Update
								</div>
							</div>

							<div className="p-3 space-y-2">
								{standings.map((entry, index) => (
									<div
										key={entry.uid}
										className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-white/5 px-3 py-2.5 animate-in slide-in-from-right-3 duration-300"
										style={{ animationDelay: `${index * 70}ms` }}>
										<div className="flex items-center gap-3 min-w-0">
											<div
												className={
													index === 0 ?
														"flex h-8 w-8 items-center justify-center rounded-full bg-yellow-500/15 text-yellow-300 text-xs font-black"
													:	"flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-[var(--color-app-text-muted)] text-xs font-black"
												}>
												{entry.rank}
											</div>
											<div className="min-w-0">
												<div className="truncate text-sm font-bold text-[var(--color-app-text)]">
													{entry.label}
												</div>
												<div className="text-[10px] text-[var(--color-app-text-muted)]">
													{entry.hasGuessed || entry.roundScore > 0 ?
														`+${entry.roundScore.toLocaleString()} this round`
													:	"No guess this round"}
												</div>
											</div>
										</div>

										<div className="flex items-center gap-2 shrink-0">
											<div
												className={
													entry.delta > 0 ?
														"rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-black text-emerald-300"
													: entry.delta < 0 ?
														"rounded-full border border-rose-400/20 bg-rose-500/10 px-2 py-1 text-[10px] font-black text-rose-300"
													:	"rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-black text-[var(--color-app-text-muted)]"

												}>
												{entry.delta > 0 ?
													`+${entry.delta}`
												: entry.delta < 0 ?
													`${entry.delta}`
												:	"0"}
											</div>
											<div className="text-sm font-black text-[var(--color-app-text)]">
												{entry.totalScore.toLocaleString()}
											</div>
										</div>
									</div>
								))}
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
