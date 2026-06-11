import { supabase, logSystemError } from "./supabase";
import { fetchPlayerStats } from "./PlayerStats";
import type { StreetViewTarget } from "./MatchGame";
import {
	fetchRandomStreetViewTarget,
	getRoundCount,
	getRoundSeconds,
} from "./MatchGame";
import type { MapRegion } from "./MapRegions";

/* ── Config ── */

const INITIAL_ELO_RANGE = 150;
const MAX_ELO_RANGE = 500;
const RANGE_EXPAND_MS = 10_000;
const RANGE_EXPAND_STEP = 50;
const POLL_MS = 3_000;

/* ── Types ── */

export interface MatchRoom {
	id: string;
	player1_id: string;
	player2_id: string | null;
	participants: string[];
	scores: Record<string, number>;
	ready_states: Record<string, boolean>;
	player1_score: number;
	player2_score: number;
	current_round: number;
	total_rounds: number;
	round_seconds: number;
	no_moving: boolean;
	no_panning: boolean;
	no_zooming: boolean;
	enable_time_multiplier?: boolean;
	selected_maps: MapRegion[];
	targets: StreetViewTarget[];
	status: "waiting" | "active" | "completed";
	winner_id: string | null;
	mode: string;
}

export type H2HMessage =
	| {
			type: "guess_submitted";
			userId: string;
			round: number;
			score: number;
			distanceKm: number;
			guess: { lat: number; lng: number } | null;
	  }
	| { type: "round_advance"; round: number }
	| {
			type: "game_over";
			player1Score: number;
			player2Score: number;
			winnerId: string | null;
	  }
	| { type: "reset_match"; targets?: any[] };

/* ── Queue management ── */

export async function joinQueue(userId: string): Promise<boolean> {
	const stats = await fetchPlayerStats(userId);
	if (!stats) return false;

	// Requirement: Ensure each player can only join to 1 match at a time
	await cleanupUserRooms(userId);

	// Cleanup any existing queue entry via RPC
	try {
		const { error: leaveErr } = await supabase.rpc("leave_matchmaking_queue", { p_user_id: userId });
		if (leaveErr) {
			console.warn("Non-fatal matchmaking queue leave error:", leaveErr);
		}
	} catch (e) {}

	const { error } = await supabase.from("matchmaking_queue").upsert({
		user_id: userId,
		elo: stats.elo,
		status: "waiting",
	});
	if (error) {
		console.error("Failed to join matchmaking queue:", error);
		void logSystemError("joinQueue database failure", { error: error.message, code: error.code, userId });
	}
	return !error;
}

export async function leaveQueue(userId: string): Promise<void> {
	const { error } = await supabase.rpc("leave_matchmaking_queue", { p_user_id: userId });
	if (error) {
		console.error("Failed to leave matchmaking queue:", error);
		void logSystemError("leaveQueue RPC failure", { error: error.message, code: error.code, userId });
	}
}

/* ── Room helpers ── */

export async function fetchRoom(roomId: string): Promise<MatchRoom | null> {
	const { data, error } = await supabase
		.from("match_rooms")
		.select("*")
		.eq("id", roomId);
	if (error || !data || data.length === 0) return null;
	const room = data[0];
	return {
		...room,
		targets:
			typeof room.targets === "string" ?
				JSON.parse(room.targets)
			:	room.targets,
		ready_states:
			typeof room.ready_states === "string" ?
				JSON.parse(room.ready_states)
			: 	room.ready_states || {},
		participants:
			typeof room.participants === "string" ?
				JSON.parse(room.participants)
			: 	room.participants || [],
		selected_maps:
			typeof room.selected_maps === "string" ?
				JSON.parse(room.selected_maps)
			: 	room.selected_maps || ["world"],
		scores:
			typeof room.scores === "string" ?
				JSON.parse(room.scores)
			: 	room.scores || {},
		enable_time_multiplier: room.enable_time_multiplier !== false,
	} as MatchRoom;
}

export async function createRoom(
	roomId: string,
	hostId: string,
	guestId: string | null,
	targets: StreetViewTarget[],
	totalRounds: number,
	roundSeconds: number,
	noMoving: boolean = false,
	noPanning: boolean = false,
	noZooming: boolean = false,
	selectedMaps: MapRegion[] = ["world"],
	status: "active" | "waiting" | "completed" = "active",
	mode: string = "headToHead",
	enableTimeMultiplier: boolean = true,
): Promise<MatchRoom | null> {
	const { data, error } = await supabase
		.from("match_rooms")
		.insert({
			id: roomId,
			player1_id: hostId,
			player2_id: guestId,
			participants: guestId ? [hostId, guestId] : [hostId],
			scores: {},
			ready_states: { [hostId]: true },
			targets: targets,
			total_rounds: totalRounds,
			round_seconds: roundSeconds,
			no_moving: noMoving,
			no_panning: noPanning,
			no_zooming: noZooming,
			enable_time_multiplier: enableTimeMultiplier,
			selected_maps: selectedMaps,
			status: status,
			mode: mode,
		})
		.select()
		.single();
	if (error) {
		console.error("Supabase room creation error:", error);
		return null;
	}
	return {
		...data,
		targets:
			typeof data.targets === "string" ?
				JSON.parse(data.targets)
			:	data.targets,
		ready_states:
			typeof data.ready_states === "string" ?
				JSON.parse(data.ready_states)
			: 	data.ready_states || {},
		participants:
			typeof data.participants === "string" ?
				JSON.parse(data.participants)
			: 	data.participants || [],
		selected_maps:
			typeof data.selected_maps === "string" ?
				JSON.parse(data.selected_maps)
			: 	data.selected_maps || ["world"],
		scores:
			typeof data.scores === "string" ?
				JSON.parse(data.scores)
			: 	data.scores || {},
		enable_time_multiplier: data.enable_time_multiplier !== false,
	} as MatchRoom;
}

export async function joinRoom(
	roomId: string,
	userId: string,
): Promise<boolean> {
	// Requirement: Ensure each player can only join to 1 match at a time
	await cleanupUserRooms(userId);

	const { data, error } = await supabase.rpc("join_match_room", {
		p_room_id: roomId,
		p_user_id: userId,
	});

	if (error) {
		console.error("Failed to join room via RPC:", error);
		return false;
	}
	return data === true;
}

export async function leaveRoom(
	roomId: string,
	userId: string,
): Promise<boolean> {
	const { data, error } = await supabase.rpc("leave_match_room", {
		p_room_id: roomId,
		p_user_id: userId,
	});

	if (error) {
		console.error("Failed to leave room via RPC:", error);
		return false;
	}
	return data === true;
}

export async function updateRoom(
	roomId: string,
	updates: Partial<
		Pick<
			MatchRoom,
			| "player1_score"
			| "player2_score"
			| "current_round"
			| "status"
			| "winner_id"
			| "scores"
			| "ready_states"
			| "participants"
			| "targets"
		>
	>,
): Promise<void> {
	const { error } = await supabase
		.from("match_rooms")
		.update(updates as any)
		.eq("id", roomId);
	if (error) {
		console.error("Failed to update room:", error);
		void logSystemError("updateRoom database failure", { error: error.message, code: error.code, roomId, updates });
		throw error;
	}
}

export async function deleteRoom(
	roomId: string,
	userId: string,
): Promise<void> {
	const { error } = await supabase.rpc("close_match_room", {
		p_room_id: roomId,
		p_user_id: userId,
	});
	if (error) {
		console.error("Failed to delete room:", error);
		void logSystemError("deleteRoom RPC failure", { error: error.message, code: error.code, roomId, userId });
		throw error;
	}
}

export async function cleanupUserRooms(userId: string): Promise<void> {
	const { error } = await supabase.rpc("cleanup_user_rooms", { p_user_id: userId });
	if (error) {
		console.error("Failed to cleanup user rooms:", error);
		void logSystemError("cleanupUserRooms RPC failure", { error: error.message, code: error.code, userId });
	}
}

export async function kickParticipantFromRoom(
	roomId: string,
	kickedUserId: string,
	hostId: string,
): Promise<boolean> {
	const { data, error } = await supabase.rpc("kick_participant_from_room", {
		p_room_id: roomId,
		p_kicked_user_id: kickedUserId,
		p_host_id: hostId,
	});

	if (error) {
		console.error("Failed to kick participant:", error);
		return false;
	}
	return data === true;
}

/* ── Pre-generate targets ── */

export async function generateTargets(
	apiKey: string,
	maps: MapRegion[],
	count: number,
	mode = "headToHead"
): Promise<StreetViewTarget[]> {
	const targets: StreetViewTarget[] = [];
	for (let i = 0; i < count; i++) {
		const target = await fetchRandomStreetViewTarget(
			apiKey,
			maps,
			targets.map(t => t.panoId).filter((id): id is string => !!id),
			mode as any,
			targets
		);
		targets.push(target);
	}
	return targets;
}

/* ── Matchmaking engine ── */

export function startMatchmaking(
	userId: string,
	callbacks: {
		onSearching: (eloRange: number) => void;
		onMatched: (
			roomId: string,
			opponentId: string,
			opponentElo: number,
			isHost: boolean,
		) => void;
		onError: (msg: string) => void;
		onTimeout: () => void;
	},
	maxWaitMs = 90_000,
): () => void {
	let cancelled = false;
	let pollTimer: number | null = null;
	let expandTimer: number | null = null;
	let currentRange = INITIAL_ELO_RANGE;
	const t0 = Date.now();

	const cleanup = () => {
		cancelled = true;
		if (pollTimer) clearInterval(pollTimer);
		if (expandTimer) clearInterval(expandTimer);
		void leaveQueue(userId);
	};

	const run = async () => {
		const joined = await joinQueue(userId);
		if (cancelled) {
			void leaveQueue(userId);
			return;
		}
		if (!joined) {
			callbacks.onError("Failed to join queue.");
			return;
		}

		callbacks.onSearching(currentRange);

		const poll = async () => {
			if (cancelled) return;

			/* 1. check if someone matched us */
			const { data: entry, error: entryErr } = await supabase
				.from("matchmaking_queue")
				.select("*")
				.eq("user_id", userId)
				.single();

			if (entryErr) {
				console.error("Failed to fetch matchmaking queue status:", entryErr);
				void logSystemError("startMatchmaking queue poll database failure", { error: entryErr.message, code: entryErr.code, userId });
			}

			if (cancelled) return;

			if (entry?.status === "matched" && entry.room_id) {
				if (pollTimer) clearInterval(pollTimer);
				if (expandTimer) clearInterval(expandTimer);
				const opponentId = entry.matched_with!;
				const oppStats = await fetchPlayerStats(opponentId);
				callbacks.onMatched(
					entry.room_id,
					opponentId,
					oppStats?.elo ?? 1300,
					false,
				);
				return;
			}

			/* 2. try to find a match ourselves */
			const myElo = entry?.elo ?? 1300;
			const { data: rpc, error: rpcErr } = await supabase.rpc("find_match", {
				p_user_id: userId,
				p_elo: myElo,
				p_range: currentRange,
			});

			if (rpcErr) {
				console.error("Failed to query find_match RPC:", rpcErr);
				void logSystemError("find_match RPC failure in poll", { error: rpcErr.message, code: rpcErr.code, userId, currentRange });
			}

			if (cancelled) return;

			if (rpc && rpc.length > 0 && rpc[0].new_room_id) {
				if (pollTimer) clearInterval(pollTimer);
				if (expandTimer) clearInterval(expandTimer);
				const m = rpc[0];
				callbacks.onMatched(
					m.new_room_id,
					m.matched_user_id,
					m.matched_elo,
					true,
				);
				return;
			}

			/* 3. check timeout */
			if (Date.now() - t0 > maxWaitMs) {
				if (pollTimer) clearInterval(pollTimer);
				if (expandTimer) clearInterval(expandTimer);
				void leaveQueue(userId);
				callbacks.onTimeout();
			}
		};

		pollTimer = window.setInterval(poll, POLL_MS);
		expandTimer = window.setInterval(() => {
			if (currentRange < MAX_ELO_RANGE) {
				currentRange = Math.min(
					currentRange + RANGE_EXPAND_STEP,
					MAX_ELO_RANGE,
				);
				callbacks.onSearching(currentRange);
			}
		}, RANGE_EXPAND_MS);

		await poll();
	};

	void run();
	return cleanup;
}

/* ── Realtime channel ── */

export function subscribeToRoom(
	roomId: string,
	onMessage: (msg: H2HMessage) => void,
) {
	const channelName = `room:${roomId}`;
	const existingCh = supabase.getChannels().find(
		(ch: any) => ch.name === channelName || ch.topic === `realtime:${channelName}`
	);
	if (existingCh) {
		supabase.removeChannel(existingCh);
	}

	const ch = supabase.channel(channelName, {
		config: { broadcast: { self: false } },
	});
	ch.on("broadcast", { event: "game" }, payload => {
		if (payload.payload) onMessage(payload.payload as H2HMessage);
	}).subscribe(status => {
		if (status === "CHANNEL_ERROR") {
			console.error(`Subscribing to room channel room:${roomId} failed.`);
			void logSystemError("subscribeToRoom channel error", { roomId });
		}
	});
	return ch;
}

export function broadcastToRoom(
	channel: ReturnType<typeof supabase.channel>,
	msg: H2HMessage,
) {
	if (channel.state === "joined") {
		void channel.send({ type: "broadcast", event: "game", payload: msg });
	} else {
		console.warn("Could not broadcast: channel not joined.", msg);
	}
}

export function unsubscribeRoom(channel: ReturnType<typeof supabase.channel>) {
	supabase.removeChannel(channel);
}
