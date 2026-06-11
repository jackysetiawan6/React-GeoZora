import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../lib/AuthContext";
import { supabase } from "../lib/supabase";
import { Clock, Trophy, Zap, MapPin, Users, ChevronDown } from "lucide-react";
import { cn } from "../lib/utils";
import { Dropdown } from "./ui/Dropdown";
import { MODE_CONFIGS } from "../lib/MatchGame";

interface MatchRecord {
	id: string;
	player1_id: string;
	player2_id: string | null;
	player1_name: string;
	player2_name: string | null;
	player1_score: number;
	player2_score: number;
	winner_id: string | null;
	mode: string;
	selected_maps: string[];
	total_rounds: number;
	round_seconds: number;
	restrictions: {
		no_moving: boolean;
		no_panning: boolean;
		no_zooming: boolean;
		real_duration?: number | null;
		rank?: number | null;
	} | null;
	player1_elo_change: number | null;
	player2_elo_change: number | null;
	player1_exp_gained: number;
	player2_exp_gained: number | null;
	completed_at: string;
}

export default function MatchHistory() {
	const { user } = useAuth();
	const [matches, setMatches] = useState<MatchRecord[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [modeFilter, setModeFilter] = useState<string>("all");
	const [expandedId, setExpandedId] = useState<string | null>(null);

	useEffect(() => {
		if (!user?.uid) {
			setLoading(false);
			return;
		}

		const loadMatches = async () => {
			try {
				setLoading(true);
				const { data, error: err } = await supabase
					.from("match_history")
					.select("*")
					.or(`player1_id.eq.${user.uid},player2_id.eq.${user.uid}`)
					.order("completed_at", { ascending: false });

				if (err) throw err;
				setMatches(data || []);
			} catch (err) {
				console.error("Failed to load match history:", err);
				setError("Failed to load match history");
			} finally {
				setLoading(false);
			}
		};

		loadMatches();
	}, [user?.uid]);

	const filteredMatches = useMemo(() => {
		return matches.filter(match => {
			if (modeFilter === "all") return true;
			return match.mode === modeFilter;
		});
	}, [matches, modeFilter]);

	const stats = useMemo(() => {
		const wins = matches.filter(m => m.winner_id === user?.uid).length;
		const losses = matches.filter(
			m => m.mode === "headToHead" && m.winner_id && m.winner_id !== user?.uid,
		).length;
		const classicMatches = matches.filter(m => m.mode === "classic").length;
		const totalExp = matches.reduce(
			(sum, m) =>
				sum +
				(m.player1_id === user?.uid ?
					m.player1_exp_gained
				:	m.player2_exp_gained || 0),
			0,
		);
		const eloChange = matches.reduce((sum, m) => {
			if (m.player1_id === user?.uid) return sum + (m.player1_elo_change || 0);
			return sum + (m.player2_elo_change || 0);
		}, 0);

		return { wins, losses, classicMatches, totalExp, eloChange };
	}, [matches, user?.uid]);

	const getResult = (match: MatchRecord): "win" | "loss" | "draw" => {
		if (match.mode === "classic") return "draw";
		if (match.winner_id === user?.uid) return "win";
		if (match.winner_id === null) return "draw";
		return "loss";
	};

	const getOpponentInfo = (match: MatchRecord) => {
		if (match.player1_id === user?.uid) {
			return {
				name: match.player2_name || "Unknown",
				id: match.player2_id,
				score: match.player2_score,
			};
		}
		return {
			name: match.player1_name,
			id: match.player1_id,
			score: match.player1_score,
		};
	};

	const getPlayerScore = (match: MatchRecord) => {
		return match.player1_id === user?.uid ?
				match.player1_score
			:	match.player2_score;
	};

	const getExpGained = (match: MatchRecord) => {
		return match.player1_id === user?.uid ?
				match.player1_exp_gained
			:	match.player2_exp_gained || 0;
	};

	const getEloChange = (match: MatchRecord) => {
		return match.player1_id === user?.uid ?
				match.player1_elo_change
			:	match.player2_elo_change;
	};

	const getClassicRank = (score: number) => {
		if (score >= 22000) {
			return {
				label: "Grandmaster",
				className:
					"bg-purple-500/10 text-purple-400 border-purple-500/20 shadow-[0_0_12px_rgba(168,85,247,0.2)]",
			};
		}
		if (score >= 18000) {
			return {
				label: "Master",
				className:
					"bg-indigo-500/10 text-indigo-400 border-indigo-500/20 shadow-[0_0_10px_rgba(99,102,241,0.15)]",
			};
		}
		if (score >= 14000) {
			return {
				label: "Expert",
				className:
					"bg-blue-500/10 text-blue-400 border-blue-500/20 shadow-[0_0_8px_rgba(59,130,246,0.12)]",
			};
		}
		if (score >= 10000) {
			return {
				label: "Gold",
				className:
					"bg-yellow-500/10 text-yellow-400 border-yellow-500/20 shadow-[0_0_8px_rgba(234,179,8,0.12)]",
			};
		}
		if (score >= 6000) {
			return {
				label: "Silver",
				className: "bg-slate-500/10 text-slate-300 border-slate-500/20",
			};
		}
		return {
			label: "Bronze",
			className: "bg-amber-700/10 text-amber-600 border-amber-700/20",
		};
	};

	const formatDuration = (record: MatchRecord) => {
		const realDuration = record.restrictions?.real_duration;
		if (typeof realDuration === "number" && realDuration > 0) {
			const mins = Math.floor(realDuration / 60);
			const secs = realDuration % 60;
			if (mins > 0) {
				return `${mins}m ${secs}s`;
			}
			return `${secs}s`;
		}
		const estMin = Math.ceil((record.total_rounds * record.round_seconds) / 60);
		return `~${estMin}m`;
	};

	const formatPlayedDate = (dateString: string) => {
		const date = new Date(dateString);
		const day = String(date.getDate()).padStart(2, "0");
		const months = [
			"January",
			"February",
			"March",
			"April",
			"May",
			"June",
			"July",
			"August",
			"September",
			"October",
			"November",
			"December",
		];
		const month = months[date.getMonth()];
		const year = date.getFullYear();

		let hours = date.getHours();
		const minutes = String(date.getMinutes()).padStart(2, "0");
		const ampm = hours >= 12 ? "PM" : "AM";
		hours = hours % 12;
		hours = hours ? hours : 12;
		const timeStr = `${hours}:${minutes} ${ampm}`;

		return `${day} ${month} ${year} at ${timeStr}`;
	};

	if (loading) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--color-app-blue)]" />
			</div>
		);
	}

	if (!user) {
		return (
			<div className="flex flex-col items-center justify-center h-full gap-4">
				<div className="text-center">
					<h2 className="text-2xl font-bold text-[var(--color-app-text)] mb-2">
						Sign in to view your match history
					</h2>
					<p className="text-[var(--color-app-text-muted)]">
						You need to be logged in to access your match records.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="w-full h-full min-h-0 flex flex-col gap-8 text-[var(--color-app-text)] font-sans pb-12 overflow-y-auto no-scrollbar">
			<div className="w-full flex flex-col gap-8">
				{/* Stats Summary */}
				<div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
					<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-xl p-4">
						<div className="text-[10px] font-bold uppercase text-[var(--color-app-text-muted)] mb-1">
							Wins (Multiplayer)
						</div>
						<div className="text-2xl font-bold text-green-400">
							{stats.wins}
						</div>
					</div>
					<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-xl p-4">
						<div className="text-[10px] font-bold uppercase text-[var(--color-app-text-muted)] mb-1">
							Losses (Multiplayer)
						</div>
						<div className="text-2xl font-bold text-red-400">
							{stats.losses}
						</div>
					</div>
					<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-xl p-4">
						<div className="text-[10px] font-bold uppercase text-[var(--color-app-text-muted)] mb-1">
							Classic Matches
						</div>
						<div className="text-2xl font-bold text-blue-400">
							{stats.classicMatches}
						</div>
					</div>
					<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-xl p-4">
						<div className="text-[10px] font-bold uppercase text-[var(--color-app-text-muted)] mb-1">
							Total XP
						</div>
						<div className="text-2xl font-bold text-yellow-400">
							{stats.totalExp.toLocaleString()}
						</div>
					</div>
					<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-xl p-4">
						<div className="text-[10px] font-bold uppercase text-[var(--color-app-text-muted)] mb-1">
							ELO Change
						</div>
						<div
							className={cn(
								"text-2xl font-bold",
								stats.eloChange >= 0 ? "text-green-400" : "text-red-400",
							)}>
							{stats.eloChange > 0 ? "+" : ""}
							{stats.eloChange}
						</div>
					</div>
				</div>

				{/* Filters */}
				<div className="mb-6 w-48">
					<Dropdown
						label="Mode"
						value={modeFilter}
						onChange={setModeFilter}
						options={[
							{ value: "all", label: "All Matches" },
							...Object.values(MODE_CONFIGS).map(config => ({
								value: config.id,
								label: config.label,
							})),
						]}
					/>
				</div>

				{/* Match List */}
				{error && <div className="text-red-500 mb-4">{error}</div>}

				{filteredMatches.length === 0 ?
					<div className="text-center py-12">
						<p className="text-[var(--color-app-text-muted)] text-lg">
							No matches found
						</p>
					</div>
				:	<div className="space-y-3">
						{filteredMatches.map(match => {
							const result = getResult(match);
							const opponent = getOpponentInfo(match);
							const playerScore = getPlayerScore(match);
							const expGained = getExpGained(match);
							const eloChange = getEloChange(match);
							const isExpanded = expandedId === match.id;

							return (
								<div
									key={match.id}
									className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-xl overflow-hidden">
									<button
										onClick={() => setExpandedId(isExpanded ? null : match.id)}
										className="w-full p-4 text-left hover:bg-[var(--color-app-hover)] transition-colors flex items-center justify-between">
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-4 flex-wrap">
												{/* Date */}
												<div className="flex items-center gap-2 text-sm text-[var(--color-app-text-muted)]">
													<Clock className="w-4 h-4" />
													{new Date(match.completed_at).toLocaleDateString(
														"en-US",
														{ month: "short", day: "numeric", year: "2-digit" },
													)}
												</div>

												{/* Mode & Result */}
												<div className="flex items-center gap-2">
													<span
														className={cn(
															"px-2.5 py-1 rounded-full text-[10px] font-bold uppercase flex items-center gap-1.5 border",
															match.mode === "classic" ?
																"bg-blue-500/10 text-blue-400 border-blue-500/20"
															:	"bg-purple-500/10 text-purple-400 border-purple-500/20",
														)}>
														{match.mode === "classic" ?
															<MapPin className="w-3.5 h-3.5" />
														:	<Users className="w-3.5 h-3.5" />}
														{MODE_CONFIGS[
															match.mode as keyof typeof MODE_CONFIGS
														]?.label || match.mode}
													</span>
													{match.mode !== "classic" && (
														match.mode === "creatorRoom" ? (() => {
															const rank = match.restrictions?.rank ?? (match.winner_id === user?.uid ? 1 : null);
															if (rank !== null) {
																const label = rank === 1 ? "1st Place" : rank === 2 ? "2nd Place" : rank === 3 ? "3rd Place" : `${rank}th Place`;
																const badgeClass =
																	rank === 1 ?
																		"bg-yellow-500/10 text-yellow-400 border-yellow-500/20 shadow-[0_0_8px_rgba(234,179,8,0.15)]"
																	: rank === 2 ?
																		"bg-slate-300/10 text-slate-300 border-slate-300/20"
																	: rank === 3 ?
																		"bg-amber-600/10 text-amber-500 border-amber-600/20"
																	:	"bg-gray-500/10 text-gray-400 border-gray-500/20";
																return (
																	<span className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold uppercase flex items-center gap-1 border", badgeClass)}>
																		<Trophy className="w-3 h-3" />
																		{label.toUpperCase()}
																	</span>
																);
															}
															return (
																<span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase flex items-center gap-1 border bg-gray-500/10 text-gray-400 border-gray-500/20">
																	<Trophy className="w-3 h-3" />
																	PLAYED
																</span>
															);
														})() : (
															<span
																className={cn(
																	"px-2.5 py-1 rounded-full text-[10px] font-bold uppercase flex items-center gap-1 border",
																	result === "win" ?
																		"bg-green-500/10 text-green-400 border-green-500/20"
																	: result === "loss" ?
																		"bg-red-500/10 text-red-400 border-red-500/20"
																	:	"bg-gray-500/10 text-gray-400 border-gray-500/20",
																)}>
																<Trophy className="w-3 h-3" />
																{result.toUpperCase()}
															</span>
														)
													)}
												</div>

												{/* Score */}
												<div className="text-sm font-bold text-[var(--color-app-text)] flex items-center gap-2">
													{match.mode === "classic" || match.mode === "creatorRoom" ?
														<>
															<div className="flex items-center gap-1">
																<span className="text-yellow-500 font-semibold text-base leading-none">
																	★
																</span>
																<span>{playerScore.toLocaleString()} pts</span>
															</div>
															{match.mode === "classic" && (() => {
																const rank = getClassicRank(playerScore);
																return (
																	<span
																		className={cn(
																			"px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase border tracking-wider",
																			rank.className,
																		)}>
																		{rank.label}
																	</span>
																);
															})()}
														</>
													:	<span className="flex items-center gap-1.5">
															<span
																className={cn(
																	playerScore > opponent.score ?
																		"text-green-400 font-extrabold"
																	: playerScore < opponent.score ?
																		"text-red-400 font-medium"
																	:	"text-gray-400 font-medium",
																)}>
																{playerScore}
															</span>
															<span className="text-[var(--color-app-text-muted)] font-normal text-xs px-0.5">
																vs
															</span>
															<span
																className={cn(
																	opponent.score > playerScore ?
																		"text-green-400 font-extrabold"
																	: opponent.score < playerScore ?
																		"text-red-400 font-medium"
																	:	"text-gray-400 font-medium",
																)}>
																{opponent.score}
															</span>
														</span>
													}
												</div>

												{/* Opponent */}
												{match.mode !== "classic" && match.mode !== "creatorRoom" && (
													<div className="flex items-center gap-1 text-sm text-[var(--color-app-text-muted)]">
														<Users className="w-4 h-4" />
														{opponent.name}
													</div>
												)}

												{/* XP & ELO */}
												<div className="flex items-center gap-2 ml-auto text-sm font-medium">
													<div className="flex items-center gap-1 text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded-lg text-xs font-semibold">
														<Zap className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
														+{expGained} XP
													</div>
													{eloChange !== null && eloChange !== 0 && (
														<div
															className={cn(
																"flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold border",
																eloChange > 0 ?
																	"bg-green-500/10 text-green-400 border-green-500/20"
																:	"bg-red-500/10 text-red-400 border-red-500/20",
															)}>
															{eloChange > 0 ? "+" : ""}
															{eloChange} ELO
														</div>
													)}
												</div>
											</div>
										</div>

										<ChevronDown
											className={cn(
												"w-5 h-5 text-[var(--color-app-text-muted)] transition-transform ml-4 flex-shrink-0",
												isExpanded && "rotate-180",
											)}
										/>
									</button>

									{/* Expanded Details */}
									{isExpanded && (
										<div className="border-t border-[var(--color-app-border-light)] p-4 space-y-4">
											{/* Maps & Restrictions */}
											<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
												{/* Maps */}
												<div className="flex items-center gap-2.5">
													<div className="text-[10px] font-bold uppercase text-[var(--color-app-text-muted)] flex items-center gap-1.5 flex-shrink-0">
														<MapPin className="w-3.5 h-3.5" />
														Maps Played
													</div>
													<div className="flex flex-wrap gap-2">
														{(
															match.selected_maps &&
															match.selected_maps.length > 0
														) ?
															match.selected_maps.map(map => (
																<span
																	key={map}
																	className="px-2.5 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg text-xs font-medium capitalize">
																	{map}
																</span>
															))
														:	<span className="text-[var(--color-app-text-muted)] text-xs">
																-
															</span>
														}
													</div>
												</div>

												{/* Restrictions */}
												{match.restrictions &&
													(match.restrictions.no_moving ||
														match.restrictions.no_panning ||
														match.restrictions.no_zooming) && (
														<div className="flex items-center gap-2.5">
															<div className="text-[10px] font-bold uppercase text-[var(--color-app-text-muted)] flex-shrink-0">
																Restrictions
															</div>
															<div className="flex flex-wrap gap-2">
																{match.restrictions.no_moving && (
																	<span className="px-2 py-0.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-xs font-medium">
																		No Moving
																	</span>
																)}
																{match.restrictions.no_panning && (
																	<span className="px-2 py-0.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-xs font-medium">
																		No Panning
																	</span>
																)}
																{match.restrictions.no_zooming && (
																	<span className="px-2 py-0.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-xs font-medium">
																		No Zooming
																	</span>
																)}
															</div>
														</div>
													)}
											</div>

											{/* Match Details Grid */}
											<div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-3 border-t border-[var(--color-app-border-light)]">
												<div className="bg-[var(--color-app-bg)]/40 rounded-xl p-3 border border-[var(--color-app-border-light)]/50 hover:border-[var(--color-app-blue)]/30 transition-colors">
													<div className="text-[10px] font-bold uppercase text-[var(--color-app-text-muted)] mb-1">
														Rounds
													</div>
													<div className="text-sm font-semibold text-[var(--color-app-text)]">
														{match.total_rounds}
													</div>
												</div>
												<div className="bg-[var(--color-app-bg)]/40 rounded-xl p-3 border border-[var(--color-app-border-light)]/50 hover:border-[var(--color-app-blue)]/30 transition-colors">
													<div className="text-[10px] font-bold uppercase text-[var(--color-app-text-muted)] mb-1">
														Time per Round
													</div>
													<div className="text-sm font-semibold text-[var(--color-app-text)]">
														{match.round_seconds}s
													</div>
												</div>
												<div className="bg-[var(--color-app-bg)]/40 rounded-xl p-3 border border-[var(--color-app-border-light)]/50 hover:border-[var(--color-app-blue)]/30 transition-colors">
													<div className="text-[10px] font-bold uppercase text-[var(--color-app-text-muted)] mb-1">
														Avg. Score/Round
													</div>
													<div className="text-sm font-semibold text-[var(--color-app-text)] flex items-center gap-1">
														<span className="text-yellow-500 text-xs">★</span>
														{Math.round(
															playerScore / match.total_rounds,
														).toLocaleString()}{" "}
														pts
													</div>
												</div>
												<div className="bg-[var(--color-app-bg)]/40 rounded-xl p-3 border border-[var(--color-app-border-light)]/50 hover:border-[var(--color-app-blue)]/30 transition-colors">
													<div className="text-[10px] font-bold uppercase text-[var(--color-app-text-muted)] mb-1">
														Duration
													</div>
													<div className="text-sm font-semibold text-[var(--color-app-text)] flex flex-col justify-center">
														<div className="flex items-center gap-1.5">
															<Clock className="w-3.5 h-3.5 text-blue-400" />
															{formatDuration(match)}
														</div>
														{match.restrictions?.real_duration && (
															<span className="text-[9px] text-[var(--color-app-text-muted)] font-normal mt-0.5">
																Avg:{" "}
																{Math.round(
																	match.restrictions.real_duration /
																		match.total_rounds,
																)}
																s/round
															</span>
														)}
													</div>
												</div>
												<div className="bg-[var(--color-app-bg)]/40 rounded-xl p-3 border border-[var(--color-app-border-light)]/50 hover:border-[var(--color-app-blue)]/30 transition-colors">
													<div className="text-[10px] font-bold uppercase text-[var(--color-app-text-muted)] mb-1">
														Played
													</div>
													<div className="text-sm font-semibold text-[var(--color-app-text)]">
														{formatPlayedDate(match.completed_at)}
													</div>
												</div>
											</div>
										</div>
									)}
								</div>
							);
						})}
					</div>
				}
			</div>
		</div>
	);
}
