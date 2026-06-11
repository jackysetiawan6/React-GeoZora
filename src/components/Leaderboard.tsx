import { useState, useEffect } from "react";
import { Trophy, ChevronDown, Medal, Target, Flame, Clock } from "lucide-react";
import { supabase } from "../lib/supabase";
import { cn } from "../lib/utils";
import { useAuth } from "../lib/AuthContext";

type TimeFilter = "today" | "week" | "month" | "year" | "overall";

interface LeaderboardEntry {
	id: string;
	rank: number;
	display_name: string;
	score: number;
	exp: number;
	elo: number;
	rounds_played?: number;
	avg_score?: number;
	avatar?: string;
	isCurrentUser: boolean;
}

export default function Leaderboard() {
	const [filter, setFilter] = useState<TimeFilter>("overall");
	const [metric, setMetric] = useState<"exp" | "elo">("exp");
	const [isTimeFilterOpen, setIsTimeFilterOpen] = useState(true);
	const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const { user } = useAuth();

	const filterLabels: Record<TimeFilter, string> = {
		today: "Today",
		week: "This Week",
		month: "This Month",
		year: "This Year",
		overall: "All Time",
	};

	useEffect(() => {
		const fetchLeaderboard = async (isBackground = false) => {
			if (!isBackground) setLoading(true);

			try {
				const { data, error } = await supabase.rpc("get_leaderboard", {
					p_filter: filter,
					p_metric: metric,
					p_limit: 100,
				});

				if (!error && data && data.length > 0) {
					setEntries(
						data.map((p: any, index: number) => {
							const rounds = p.rounds_window || 0;
							const score = p.score || 0;
							return {
								id: p.id,
								rank: index + 1,
								display_name: p.display_name || "Anonymous Player",
								score: score,
								exp: p.exp || 0,
								elo: p.elo || 1300,
								rounds_played: rounds,
								avg_score: rounds > 0 ? Math.round(score / rounds) : 0,
								avatar: p.avatar_url || undefined,
								isCurrentUser: user?.uid === p.id,
							};
						}),
					);
				} else {
					setEntries([]);
				}
			} catch (err) {
				console.error("Leaderboard error:", err);
			} finally {
				if (!isBackground) setLoading(false);
			}
		};

		fetchLeaderboard();

		const intervalId = setInterval(
			() => {
				fetchLeaderboard(true);
			},
			10 * 60 * 1000,
		);

		return () => clearInterval(intervalId);
	}, [filter, metric, user]);

	const topThree = entries.slice(0, 3);
	const remaining = entries.slice(3);

	const getRankColor = (rank: number) => {
		if (rank === 1)
			return {
				bg: "bg-yellow-500",
				text: "text-yellow-500",
				border: "border-yellow-500/30",
			};
		if (rank === 2)
			return {
				bg: "bg-gray-300",
				text: "text-gray-300",
				border: "border-gray-400/30",
			};
		if (rank === 3)
			return {
				bg: "bg-amber-600",
				text: "text-amber-600",
				border: "border-amber-700/30",
			};
		return {
			bg: "bg-[var(--color-app-border)]",
			text: "text-[var(--color-app-text-muted)]",
			border: "border-transparent",
		};
	};

	return (
		<div className="w-full h-full flex flex-col lg:flex-row gap-8 relative z-20 overflow-hidden text-[var(--color-app-text)] font-sans">
			{/* Sidebar */}
			<div className="w-full lg:w-64 flex flex-col gap-8 flex-shrink-0 lg:overflow-y-auto no-scrollbar pb-6 rounded-2xl">
				<div>
					<h1 className="text-3xl font-bold tracking-tight mb-2">
						Leaderboards
					</h1>
					<p className="text-[var(--color-app-text-muted)] text-sm leading-relaxed">
						See how you rank against other explorers around the world.
					</p>
				</div>

				{/* Filters */}
				<div className="flex flex-col gap-6">
					{/* Metric Filter */}
					<div className="flex flex-col gap-3">
						<h3 className="text-xs font-black uppercase tracking-widest text-[var(--color-app-text-muted)] flex items-center gap-2">
							<Trophy className="w-4 h-4" /> Metric
						</h3>
						<div className="flex bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] p-1 rounded-xl">
							<button
								onClick={() => setMetric("exp")}
								className={cn(
									"flex-1 px-4 py-2 text-sm font-bold rounded-lg transition-all border border-transparent cursor-pointer",
									metric === "exp" ?
										"bg-[var(--color-app-hover)] text-[var(--color-app-text)] shadow shadow-black/20 border-[var(--color-app-border)]"
										: "text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)]",
								)}>
								EXP
							</button>
							<button
								onClick={() => setMetric("elo")}
								className={cn(
									"flex-1 px-4 py-2 text-sm font-bold rounded-lg transition-all border border-transparent cursor-pointer",
									metric === "elo" ?
										"bg-[var(--color-app-hover)] text-[var(--color-app-text)] shadow shadow-black/20 border-[var(--color-app-border)]"
										: "text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)]",
								)}>
								ELO
							</button>
						</div>
					</div>

					{/* Time Filter Radio UI */}
					<div className="flex flex-col gap-3">
						<h3 className="text-xs font-black uppercase tracking-widest text-[var(--color-app-text-muted)] flex items-center gap-2">
							<Clock className="w-4 h-4" /> Time Filter
						</h3>
						<div className="flex flex-col gap-1">
							{(Object.keys(filterLabels) as TimeFilter[]).map(key => (
								<button
									key={key}
									onClick={() => setFilter(key)}
									className={cn(
										"w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer outline-none relative",
										filter === key ?
											"bg-[var(--color-app-blue)]/10 text-[var(--color-app-blue)] font-bold border border-[var(--color-app-blue)]/20 shadow-inner"
											: "text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] hover:bg-[var(--color-app-hover)] border border-transparent",
									)}>
									{filterLabels[key]}
									{filter === key && (
										<div className="absolute right-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[var(--color-app-blue)] shadow-[0_0_8px_rgba(59,130,246,0.6)]"></div>
									)}
								</button>
							))}
						</div>
					</div>

					<div className="mt-auto pt-6 border-t border-[var(--color-app-border-light)] flex items-start gap-3 text-[11px] text-[var(--color-app-text-muted)]">
						<Clock className="w-4 h-4 shrink-0" />
						<p>Leaderboards update every 10 minutes based on recent matches.</p>
					</div>
				</div>
			</div>

			{/* Main Content Area */}
			<div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
				{loading ?
					<div className="flex-1 flex flex-col gap-4 p-4 lg:p-8 pt-0 items-center justify-center">
						<div className="w-12 h-12 border-4 border-[var(--color-app-blue)] border-t-transparent rounded-full animate-spin"></div>
						<p className="text-[var(--color-app-text-muted)] font-medium">
							Loading rankings...
						</p>
					</div>
					: entries.length === 0 ?
						<div className="flex-1 flex flex-col items-center justify-center text-center py-20 bg-[var(--color-app-panel)] rounded-2xl border border-[var(--color-app-border)] shadow-xl">
							<div className="w-20 h-20 bg-[var(--color-app-bg)] rounded-full flex items-center justify-center mb-6 text-[var(--color-app-text-muted)] border border-[var(--color-app-border-light)] shadow-inner">
								<Medal className="w-10 h-10 opacity-30" />
							</div>
							<h3 className="text-xl font-bold text-[var(--color-app-text)] mb-2">
								No explorers found
							</h3>
							<p className="text-[var(--color-app-text-muted)] text-sm max-w-sm">
								No one has earned points in this category yet. Start exploring to
								claim #1!
							</p>
						</div>
						: <div className="flex-1 flex flex-col overflow-y-auto no-scrollbar scroll-smooth pr-1 lg:pr-4 pb-12 pt-4">
							{/* Podium (Top 3) */}
							<div className="flex flex-row items-end justify-center gap-3 lg:gap-6 pt-24 lg:pt-32 pb-8 mb-4 min-h-[340px]">
								{/* Rank 2 */}
								{topThree[1] && (
									<div className="flex flex-col items-center animate-in fade-in slide-in-from-bottom-8 duration-700 w-1/3 max-w-[180px]">
										<div className="relative mb-3 group flex flex-col items-center">
											<div className="absolute -top-6 bg-[var(--color-app-panel)] border border-gray-400 shadow-[0_0_15px_rgba(156,163,175,0.3)] w-8 h-8 rounded-full flex items-center justify-center z-20 font-black text-gray-200">
												2
											</div>
											<img
												src={
													topThree[1].avatar ||
													`https://ui-avatars.com/api/?name=${topThree[1].display_name.replace(/ /g, "+")}&background=random`
												}
												alt={topThree[1].display_name}
												className="w-20 h-20 lg:w-24 lg:h-24 rounded-full border-4 border-gray-400/40 object-cover z-10 shadow-xl transition-transform group-hover:scale-105"
											/>
											{topThree[1].isCurrentUser && (
												<div className="absolute -bottom-2 z-20 text-[10px] uppercase font-black bg-[var(--color-app-blue)] text-white px-2 py-0.5 rounded-full shadow-md">
													You
												</div>
											)}
										</div>
										<div className="text-center px-2">
											<h3 className="font-bold text-[var(--color-app-text)] truncate w-full text-sm lg:text-base mb-1">
												{topThree[1].display_name}
											</h3>
											<div className="text-blue-400 font-bold mx-auto">
												{(metric === "exp" ? topThree[1].exp : topThree[1].elo).toLocaleString()}{" "}
												<span className="text-[10px] uppercase text-blue-400/60 font-semibold">
													{metric === "exp" ? "XP" : "ELO"}
												</span>
											</div>
										</div>
									</div>
								)}

								{/* Rank 1 */}
								{topThree[0] && (
									<div className="flex flex-col items-center animate-in fade-in slide-in-from-bottom-10 duration-700 delay-150 w-1/3 max-w-[220px] -mt-10 lg:-mt-16 z-10 pb-4">
										<div className="relative mb-4 group flex flex-col items-center">
											<div className="absolute -top-7 lg:-top-9 bg-yellow-500 text-yellow-900 border border-yellow-300 shadow-[0_0_30px_rgba(234,179,8,0.6)] w-10 h-10 lg:w-12 lg:h-12 rounded-lg flex items-center justify-center z-20 font-black text-lg lg:text-xl transform rotate-45">
												<span className="-rotate-45">1</span>
											</div>
											<div className="absolute inset-0 bg-yellow-500 rounded-full blur-[40px] opacity-20"></div>
											<img
												src={
													topThree[0].avatar ||
													`https://ui-avatars.com/api/?name=${topThree[0].display_name.replace(/ /g, "+")}&background=random`
												}
												alt={topThree[0].display_name}
												className="w-28 h-28 lg:w-36 lg:h-36 rounded-full border-[5px] border-yellow-500 object-cover z-10 shadow-2xl transition-transform group-hover:scale-105"
											/>
											{topThree[0].isCurrentUser && (
												<div className="absolute -bottom-2 z-20 text-[10px] uppercase font-black bg-[var(--color-app-blue)] text-white px-3 py-1 rounded-full shadow-md">
													You
												</div>
											)}
										</div>
										<div className="text-center px-2 w-full">
											<h3 className="font-bold text-[var(--color-app-text)] text-base lg:text-xl truncate mb-1.5">
												{topThree[0].display_name}
											</h3>
											<div className="text-yellow-400 font-black text-lg lg:text-xl mx-auto drop-shadow-md">
												{(metric === "exp" ? topThree[0].exp : topThree[0].elo).toLocaleString()}{" "}
												<span className="text-xs uppercase text-yellow-500/70 font-bold">
													{metric === "exp" ? "XP" : "ELO"}
												</span>
											</div>
										</div>
									</div>
								)}

								{/* Rank 3 */}
								{topThree[2] && (
									<div className="flex flex-col items-center animate-in fade-in slide-in-from-bottom-6 duration-700 delay-300 w-1/3 max-w-[180px]">
										<div className="relative mb-3 group flex flex-col items-center">
											<div className="absolute -top-6 bg-[var(--color-app-panel)] border border-amber-600 shadow-[0_0_15px_rgba(217,119,6,0.3)] w-8 h-8 rounded-full flex items-center justify-center z-20 font-black text-amber-500">
												3
											</div>
											<img
												src={
													topThree[2].avatar ||
													`https://ui-avatars.com/api/?name=${topThree[2].display_name.replace(/ /g, "+")}&background=random`
												}
												alt={topThree[2].display_name}
												className="w-20 h-20 lg:w-24 lg:h-24 rounded-full border-4 border-amber-600/40 object-cover z-10 shadow-xl transition-transform group-hover:scale-105"
											/>
											{topThree[2].isCurrentUser && (
												<div className="absolute -bottom-2 z-20 text-[10px] uppercase font-black bg-[var(--color-app-blue)] text-white px-2 py-0.5 rounded-full shadow-md">
													You
												</div>
											)}
										</div>
										<div className="text-center px-2">
											<h3 className="font-bold text-[var(--color-app-text)] truncate w-full text-sm lg:text-base mb-1">
												{topThree[2].display_name}
											</h3>
											<div className="text-amber-500 font-bold mx-auto">
												{(metric === "exp" ? topThree[2].exp : topThree[2].elo).toLocaleString()}{" "}
												<span className="text-[10px] uppercase text-amber-500/60 font-semibold">
													{metric === "exp" ? "XP" : "ELO"}
												</span>
											</div>
										</div>
									</div>
								)}
							</div>

							{/* List for Rank 4+ */}
							{remaining.length > 0 && (
								<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-2xl shadow-xl overflow-hidden mt-4 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-500">
									{/* Table Header */}
									<div className="grid grid-cols-12 gap-4 items-center px-6 py-4 border-b border-[var(--color-app-border-light)] text-xs font-black uppercase tracking-widest text-[var(--color-app-text-muted)] bg-[var(--color-app-hover)]">
										<div className="col-span-2 md:col-span-1 text-center">
											Rank
										</div>
										<div className="col-span-4 md:col-span-5">Player</div>
										<div className="col-span-2 hidden md:block text-right">
											Rounds
										</div>
										<div className="col-span-2 hidden md:block text-right">
											Accuracy
										</div>
										<div className="col-span-6 md:col-span-2 text-right">
											Score
										</div>
									</div>

									{/* Rows */}
									<div className="flex flex-col">
										{remaining.map(entry => (
											<div
												key={entry.id}
												className={cn(
													"grid grid-cols-12 gap-4 items-center px-6 py-4 border-b border-[var(--color-app-border-light)] last:border-0 hover:bg-[var(--color-app-hover)] transition-colors",
													entry.isCurrentUser &&
													"bg-[var(--color-app-blue)]/5 hover:bg-[var(--color-app-blue)]/10",
												)}>
												{/* Rank */}
												<div className="col-span-2 md:col-span-1 text-center">
													<span className="font-bold text-[var(--color-app-text-muted)]">
														{entry.rank}
													</span>
												</div>

												{/* Player Info */}
												<div className="col-span-4 md:col-span-5 flex items-center gap-4">
													<img
														src={
															entry.avatar ||
															`https://ui-avatars.com/api/?name=${entry.display_name.replace(/ /g, "+")}&background=random`
														}
														alt={entry.display_name}
														className="w-8 h-8 rounded-full border border-[var(--color-app-border)] object-cover shadow-sm bg-[var(--color-app-bg)]"
													/>
													<div className="flex items-center gap-2 overflow-hidden">
														<h3
															className={cn(
																"font-semibold truncate",
																entry.isCurrentUser ? "text-blue-400" : (
																	"text-[var(--color-app-text)]"
																),
															)}>
															{entry.display_name}
														</h3>
														{entry.isCurrentUser && (
															<span className="ml-1 text-[9px] uppercase font-bold bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded shadow-sm border border-blue-500/30">
																You
															</span>
														)}
													</div>
												</div>

												{/* Rounds (Desktop only) */}
												<div className="col-span-2 hidden md:block text-right">
													<span className="font-mono text-sm text-[var(--color-app-text-muted)]">
														{entry.rounds_played != null ?
															entry.rounds_played.toLocaleString()
															: "-"}
													</span>
												</div>

												{/* Accuracy (Desktop only) */}
												<div className="col-span-2 hidden md:block text-right">
													<span className="font-mono text-sm text-[var(--color-app-text-muted)]">
														{entry.avg_score != null ?
															`${Math.round((entry.avg_score / 5000) * 100)}%`
															: "-"}
													</span>
												</div>

												{/* Score */}
												<div className="col-span-6 md:col-span-2 text-right">
													<span className="font-mono font-medium text-[var(--color-app-text)] tracking-wider">
														<span
															className={
																metric === "exp" ? "text-blue-400 font-bold" : ""
															}>
															{metric === "exp" ?
																entry.exp.toLocaleString()
																: entry.elo.toLocaleString()}
														</span>
														<span className="text-xs text-[var(--color-app-text-muted)] ml-1">
															pts
														</span>
													</span>
												</div>
											</div>
										))}
									</div>
								</div>
							)}
						</div>
				}
			</div>
		</div>
	);
}
