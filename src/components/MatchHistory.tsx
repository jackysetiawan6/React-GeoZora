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
						Wins (H2H)
					</div>
					<div className="text-2xl font-bold text-green-400">{stats.wins}</div>
				</div>
				<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-xl p-4">
					<div className="text-[10px] font-bold uppercase text-[var(--color-app-text-muted)] mb-1">
						Losses (H2H)
					</div>
					<div className="text-2xl font-bold text-red-400">{stats.losses}</div>
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
														"px-3 py-1 rounded-full text-[10px] font-bold uppercase",
														match.mode === "classic" ?
															"bg-blue-500/10 text-blue-400"
														:	"bg-purple-500/10 text-purple-400",
													)}>
													{MODE_CONFIGS[match.mode as keyof typeof MODE_CONFIGS]?.label || match.mode}
												</span>
												<span
													className={cn(
														"px-3 py-1 rounded-full text-[10px] font-bold uppercase flex items-center gap-1",
														result === "win" ? "bg-green-500/10 text-green-400"
														: result === "loss" ? "bg-red-500/10 text-red-400"
														: "bg-gray-500/10 text-gray-400",
													)}>
													<Trophy className="w-3 h-3" />
													{result.toUpperCase()}
												</span>
											</div>

											{/* Score */}
											<div className="text-sm font-bold text-[var(--color-app-text)]">
												{playerScore} vs {opponent.score}
											</div>

											{/* Opponent */}
											<div className="flex items-center gap-1 text-sm text-[var(--color-app-text-muted)]">
												<Users className="w-4 h-4" />
												{opponent.name}
											</div>

											{/* XP & ELO */}
											<div className="flex items-center gap-2 ml-auto text-sm font-medium">
												<div className="flex items-center gap-1 text-yellow-400">
													<Zap className="w-4 h-4" />+{expGained}
												</div>
												{eloChange !== null && (
													<div
														className={cn(
															"flex items-center gap-1",
															eloChange > 0 ? "text-green-400" : "text-red-400",
														)}>
														{eloChange > 0 ? "+" : ""}
														{eloChange}
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
									<div className="border-t border-[var(--color-app-border-light)] p-4 space-y-3">
										{/* Maps */}
										<div>
											<div className="text-[10px] font-bold uppercase text-[var(--color-app-text-muted)] mb-2 flex items-center gap-1">
												<MapPin className="w-3 h-3" />
												Maps Played
											</div>
											<div className="flex flex-wrap gap-2">
												{match.selected_maps && match.selected_maps.length > 0 ?
													match.selected_maps.map(map => (
														<span
															key={map}
															className="px-3 py-1 bg-blue-500/10 text-blue-400 rounded-lg text-xs font-medium capitalize">
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
											Object.values(match.restrictions).some(v => v) && (
												<div>
													<div className="text-[10px] font-bold uppercase text-[var(--color-app-text-muted)] mb-2">
														Restrictions
													</div>
													<div className="flex flex-wrap gap-2">
														{match.restrictions.no_moving && (
															<span className="px-2 py-1 bg-red-500/10 text-red-400 rounded text-xs font-medium">
																No Moving
															</span>
														)}
														{match.restrictions.no_panning && (
															<span className="px-2 py-1 bg-red-500/10 text-red-400 rounded text-xs font-medium">
																No Panning
															</span>
														)}
														{match.restrictions.no_zooming && (
															<span className="px-2 py-1 bg-red-500/10 text-red-400 rounded text-xs font-medium">
																No Zooming
															</span>
														)}
													</div>
												</div>
											)}

										{/* Match Details */}
										<div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
											<div>
												<div className="font-bold text-[var(--color-app-text-muted)] mb-1">
													Rounds
												</div>
												<div className="text-[var(--color-app-text)]">
													{match.total_rounds}
												</div>
											</div>
											<div>
												<div className="font-bold text-[var(--color-app-text-muted)] mb-1">
													Time/Round
												</div>
												<div className="text-[var(--color-app-text)]">
													{match.round_seconds}s
												</div>
											</div>
											<div>
												<div className="font-bold text-[var(--color-app-text-muted)] mb-1">
													Duration
												</div>
												<div className="text-[var(--color-app-text)]">
													~
													{Math.ceil(
														(match.total_rounds * match.round_seconds) / 60,
													)}
													m
												</div>
											</div>
											<div>
												<div className="font-bold text-[var(--color-app-text-muted)] mb-1">
													Played
												</div>
												<div className="text-[var(--color-app-text)]">
													{new Date(match.completed_at).toLocaleDateString(
														"en-US",
														{ month: "short", day: "numeric" },
													)}
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
