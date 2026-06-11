import { supabase, logSystemError } from "./supabase";

/* ── Types ── */

export interface PlayerStats {
	user_id: string;
	exp: number;
	elo: number;
	last_avg_score: number;
	games_played: number;
}

/* ── Constants ── */

const DEFAULT_ELO = 1300;
const ELO_K = 32;
const EXP_CLASSIC = 50;
const EXP_H2H_WIN = 100;
const EXP_H2H_DRAW = 60;
const EXP_H2H_LOSS = 30;
const EXP_SCORE_DIV = 100; // bonus +1 exp per 100 pts scored

type NotificationRow = {
	user_id: string;
	title: string;
	message: string;
};

type AchievementCheck = {
	id: string;
	name: string;
	wasUnlocked: boolean;
	isUnlocked: boolean;
};

/* ── EXP / Level helpers (exported so UI components can reuse them) ── */

/**
 * XP required to advance FROM level `n` TO level `n+1`.
 * Uses 100 × n^1.5, rounded to the nearest integer.
 * Example: L1→L2 = 100, L5→L6 = 1118, L10→L11 = 3162.
 */
export function getExpRequiredForLevel(level: number): number {
	return Math.round(100 * Math.pow(level, 1.5));
}

/**
 * Total cumulative XP needed to REACH `level` (starting from 0 XP / level 1).
 * getTotalExpToReachLevel(1) = 0
 * getTotalExpToReachLevel(2) = 100
 * getTotalExpToReachLevel(3) = 383
 */
export function getTotalExpToReachLevel(level: number): number {
	if (level <= 1) return 0;
	let total = 0;
	for (let l = 1; l < level; l++) {
		total += getExpRequiredForLevel(l);
	}
	return total;
}

/**
 * Derive the current level from a raw EXP amount.
 * No maximum level — iterates until the next level threshold exceeds exp.
 */
export function getLevel(exp: number): number {
	let level = 1;
	let cumulative = 0;
	while (true) {
		const needed = getExpRequiredForLevel(level);
		if (exp < cumulative + needed) break;
		cumulative += needed;
		level++;
	}
	return level;
}

/** EXP accumulated within the current level (resets at each level-up). */
export function getExpInCurrentLevel(exp: number): number {
	const level = getLevel(exp);
	return exp - getTotalExpToReachLevel(level);
}

/** EXP still needed to reach the next level from the current exp total. */
export function getExpToNextLevel(exp: number): number {
	const level = getLevel(exp);
	return getExpRequiredForLevel(level) - getExpInCurrentLevel(exp);
}

function getAchievementChecks(
	before: PlayerStats,
	after: PlayerStats,
): AchievementCheck[] {
	const beforeLevel = getLevel(before.exp);
	const afterLevel = getLevel(after.exp);

	return [
		{
			id: "rookie",
			name: "Rookie Explorer",
			wasUnlocked: before.games_played >= 1,
			isUnlocked: after.games_played >= 1,
		},
		{
			id: "traveler",
			name: "World Traveler",
			wasUnlocked: before.games_played >= 10,
			isUnlocked: after.games_played >= 10,
		},
		{
			id: "veteran",
			name: "Seasoned Veteran",
			wasUnlocked: beforeLevel >= 5,
			isUnlocked: afterLevel >= 5,
		},
		{
			id: "legend",
			name: "Living Legend",
			wasUnlocked: beforeLevel >= 10,
			isUnlocked: afterLevel >= 10,
		},
		{
			id: "pro",
			name: "Pro Competitor",
			wasUnlocked: before.elo >= 1500,
			isUnlocked: after.elo >= 1500,
		},
		{
			id: "sniper",
			name: "Elite Sniper",
			wasUnlocked: before.last_avg_score >= 4500,
			isUnlocked: after.last_avg_score >= 4500,
		},
	];
}

async function insertNotifications(rows: NotificationRow[]): Promise<void> {
	if (rows.length === 0) return;

	try {
		const { error } = await supabase.from("notifications").insert(
			rows.map(row => ({
				user_id: row.user_id,
				title: row.title,
				message: row.message,
			})),
		);
		if (error) {
			console.error("insertNotifications db error:", error);
			void logSystemError("insertNotifications database failure", { error: error.message, code: error.code });
		}
	} catch (error) {
		console.error("insertNotifications error:", error);
		void logSystemError("insertNotifications exception", { error: String(error) });
	}
}

/* ── Pure helpers ── */

export function calculateEloChange(
	playerElo: number,
	opponentElo: number,
	result: "win" | "loss" | "draw",
): number {
	const expected = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
	const actual =
		result === "win" ? 1
			: result === "draw" ? 0.5
				: 0;
	return Math.round(ELO_K * (actual - expected));
}

export function calculateExpGain(
	mode: "classic" | "headToHead" | "creatorRoom",
	totalScore: number,
	h2hResult?: "win" | "loss" | "draw",
): number {
	const bonus = Math.floor(totalScore / EXP_SCORE_DIV);
	if (mode === "classic") return EXP_CLASSIC + bonus;
	const base =
		h2hResult === "win" ? EXP_H2H_WIN
			: h2hResult === "draw" ? EXP_H2H_DRAW
				: EXP_H2H_LOSS;
	return base + bonus;
}

/** Average score per round for the last match, 2 decimal places */
export function calculateAvgScore(totalScore: number, rounds: number): number {
	if (rounds <= 0) return 0;
	return Math.round((totalScore / rounds) * 100) / 100;
}

/* ── DB reads ── */

export async function fetchPlayerStats(
	userId: string,
): Promise<PlayerStats | null> {
	let { data, error } = await supabase
		.from("profiles")
		.select("id, exp, elo, last_avg_score, games_played")
		.eq("id", userId)
		.single();

	if (error) {
		// If last_avg_score is missing, fallback
		if (error.message.includes("last_avg_score") || error.code === "PGRST200") {
			const fallback = await supabase
				.from("profiles")
				.select("id, exp, elo, games_played")
				.eq("id", userId)
				.single();

			data = fallback.data as any;
			error = fallback.error;
		} else {
			console.error("fetchPlayerStats error:", error);
			return null;
		}
	}

	if (error || !data) {
		return null;
	}

	return {
		user_id: data.id,
		exp: data.exp ?? 0,
		elo: data.elo ?? DEFAULT_ELO,
		last_avg_score: data.last_avg_score ?? 0,
		games_played: data.games_played ?? 0,
	};
}

/* ── DB writes ── */

export async function updateStatsAfterClassic(
	userId: string,
	totalScore: number,
	rounds: number,
	roomId: string | null = null,
): Promise<PlayerStats | null> {
	const cur = await fetchPlayerStats(userId);
	if (!cur) {
		console.error(
			"updateStatsAfterClassic: fetchPlayerStats returned null for",
			userId,
		);
		return null;
	}

	const expGain = calculateExpGain("classic", totalScore);
	const avgScore = calculateAvgScore(totalScore, rounds);

	const { data, error } = await supabase.rpc("increment_player_stats", {
		p_user_id: userId,
		p_exp_gain: expGain,
		p_elo_change: 0,
		p_avg_score: avgScore,
		p_room_id: roomId,
	});

	if (error || !data) {
		console.error("updateStatsAfterClassic error:", error);
		void logSystemError("updateStatsAfterClassic RPC failure", { error: error?.message || "No data returned", code: error?.code });
		return null;
	}

	const updated: PlayerStats = {
		user_id: data.id,
		exp: data.exp,
		elo: data.elo,
		last_avg_score: data.last_avg_score ?? 0,
		games_played: data.games_played,
	};

	const notifications: NotificationRow[] = [
		{
			user_id: userId,
			title: "EXP Gained",
			message: `You gained ${expGain} EXP.`,
		},
	];

	if (getLevel(updated.exp) > getLevel(cur.exp)) {
		notifications.push({
			user_id: userId,
			title: "Level Up!",
			message: `Congratulations! You reached level ${getLevel(updated.exp)}.`,
		});
	}

	for (const achievement of getAchievementChecks(cur, updated)) {
		if (!achievement.wasUnlocked && achievement.isUnlocked) {
			notifications.push({
				user_id: userId,
				title: "Achievement unlocked",
				message: `Achievement unlocked: ${achievement.name}.`,
			});
		}
	}

	await insertNotifications(notifications);

	return updated;
}

export async function updateStatsAfterH2H(
	userId: string,
	opponentElo: number,
	totalScore: number,
	rounds: number,
	result: "win" | "loss" | "draw",
	roomId: string | null = null,
): Promise<PlayerStats | null> {
	const cur = await fetchPlayerStats(userId);
	if (!cur) {
		console.error(
			"updateStatsAfterH2H: fetchPlayerStats returned null for",
			userId,
		);
		return null;
	}

	const eloChange = calculateEloChange(cur.elo, opponentElo, result);
	const expGain = calculateExpGain("headToHead", totalScore, result);
	const avgScore = calculateAvgScore(totalScore, rounds);

	const { data, error } = await supabase.rpc("increment_player_stats", {
		p_user_id: userId,
		p_exp_gain: expGain,
		p_elo_change: eloChange,
		p_avg_score: avgScore,
		p_room_id: roomId,
	});

	if (error || !data) {
		console.error("updateStatsAfterH2H error:", error);
		void logSystemError("updateStatsAfterH2H RPC failure", { error: error?.message || "No data returned", code: error?.code });
		return null;
	}

	const updated: PlayerStats = {
		user_id: data.id,
		exp: data.exp,
		elo: data.elo,
		last_avg_score: data.last_avg_score ?? 0,
		games_played: data.games_played,
	};

	const notifications: NotificationRow[] = [
		{
			user_id: userId,
			title: "EXP Gained",
			message: `You gained ${expGain} EXP.`,
		},
	];

	if (eloChange !== 0) {
		notifications.push({
			user_id: userId,
			title: "ELO Updated",
			message: `Your ELO changed by ${eloChange > 0 ? "+" : ""}${eloChange}.`,
		});
	}

	if (getLevel(updated.exp) > getLevel(cur.exp)) {
		notifications.push({
			user_id: userId,
			title: "Level Up!",
			message: `Congratulations! You reached level ${getLevel(updated.exp)}.`,
		});
	}

	for (const achievement of getAchievementChecks(cur, updated)) {
		if (!achievement.wasUnlocked && achievement.isUnlocked) {
			notifications.push({
				user_id: userId,
				title: "Achievement unlocked",
				message: `Achievement unlocked: ${achievement.name}.`,
			});
		}
	}

	await insertNotifications(notifications);

	return updated;
}

export async function updateStatsAfterCreatorRoom(
	userId: string,
	totalScore: number,
	rounds: number,
	result: "win" | "loss" | "draw",
	roomId: string | null = null,
): Promise<PlayerStats | null> {
	const cur = await fetchPlayerStats(userId);
	if (!cur) {
		console.error(
			"updateStatsAfterCreatorRoom: fetchPlayerStats returned null for",
			userId,
		);
		return null;
	}

	const expGain = calculateExpGain("creatorRoom", totalScore, result);
	const avgScore = calculateAvgScore(totalScore, rounds);

	const { data, error } = await supabase.rpc("increment_player_stats", {
		p_user_id: userId,
		p_exp_gain: expGain,
		p_elo_change: 0, // No ELO changes for custom creator rooms
		p_avg_score: avgScore,
		p_room_id: roomId,
	});

	if (error || !data) {
		console.error("updateStatsAfterCreatorRoom error:", error);
		void logSystemError("updateStatsAfterCreatorRoom RPC failure", { error: error?.message || "No data returned", code: error?.code });
		return null;
	}

	const updated: PlayerStats = {
		user_id: data.id,
		exp: data.exp,
		elo: data.elo,
		last_avg_score: data.last_avg_score ?? 0,
		games_played: data.games_played,
	};

	const notifications: NotificationRow[] = [
		{
			user_id: userId,
			title: "EXP Gained",
			message: `You gained ${expGain} EXP.`,
		},
	];

	if (getLevel(updated.exp) > getLevel(cur.exp)) {
		notifications.push({
			user_id: userId,
			title: "Level Up!",
			message: `Congratulations! You reached level ${getLevel(updated.exp)}.`,
		});
	}

	for (const achievement of getAchievementChecks(cur, updated)) {
		if (!achievement.wasUnlocked && achievement.isUnlocked) {
			notifications.push({
				user_id: userId,
				title: "Achievement unlocked",
				message: `Achievement unlocked: ${achievement.name}.`,
			});
		}
	}

	await insertNotifications(notifications);

	return updated;
}

export async function saveMatchHistory(
	player1Id: string | null,
	player2Id: string | null,
	player1Name: string,
	player2Name: string | null,
	player1Score: number,
	player2Score: number,
	mode: "classic" | "headToHead" | "creatorRoom",
	selectedMaps: string[],
	totalRounds: number,
	roundSeconds: number,
	restrictions: {
		no_moving: boolean;
		no_panning: boolean;
		no_zooming: boolean;
		real_duration?: number | null;
		rank?: number | null;
	},
	expGained: { player1: number; player2?: number },
	eloChange?: { player1: number; player2: number },
	matchId?: string,
	winnerIdOverride?: string | null,
): Promise<void> {
	try {
		let winnerId: string | null = winnerIdOverride || null;

		if (!winnerIdOverride && mode === "headToHead") {
			if (player1Score > player2Score) {
				winnerId = player1Id;
			} else if (player2Score > player1Score) {
				winnerId = player2Id;
			}
		}

		const { error } = await supabase.from("match_history").insert([
			{
				match_id: matchId,
				player1_id: player1Id,
				player2_id: player2Id,
				player1_name: player1Name,
				player2_name: player2Name,
				player1_score: player1Score,
				player2_score: player2Score,
				winner_id: winnerId,
				mode,
				selected_maps: selectedMaps,
				total_rounds: totalRounds,
				round_seconds: roundSeconds,
				restrictions,
				player1_elo_change: eloChange?.player1 || null,
				player2_elo_change: eloChange?.player2 || null,
				player1_exp_gained: expGained.player1,
				player2_exp_gained: expGained.player2 || null,
			},
		]);
		if (error) {
			console.error("saveMatchHistory database failure:", error);
			void logSystemError("saveMatchHistory database failure", { error: error.message, code: error.code, matchId });
			throw error;
		}
	} catch (err) {
		console.error("Failed to save match history:", err);
		void logSystemError("saveMatchHistory exception", { error: String(err), matchId });
		throw err;
	}
}
