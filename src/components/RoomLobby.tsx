import {
	Copy,
	Hash,
	Play,
	Users,
	X,
	Map as MapIcon,
	Clock,
	Settings,
	Target,
	Trophy,
	Loader2,
	Check,
	Trash2,
	AlertTriangle,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { cn } from "../lib/utils";
import {
	type MatchRoom,
	generateTargets,
	kickParticipantFromRoom,
	updateRoom,
	leaveRoom,
} from "../lib/Matchmaking";
import { useAuth } from "../lib/AuthContext";
import { supabase, logSystemError } from "../lib/supabase";
import { audioManager } from "../lib/audioManager";

import { type MapRegion, MAPS, MAX_SELECTED_MAPS } from "../lib/MapRegions";
import RoomChat from "./RoomChat";
import { Toggle, NumericInput } from "./ui";
import { useRef } from "react";
import {
	clearMatchSession,
	saveMatchSession,
} from "../lib/matchSessionPersistence";
import { useCallback } from "react";

interface RoomLobbyProps {
	room: MatchRoom;
	isHost: boolean;
	selectedMaps: MapRegion[];
	onUpdateMaps?: (maps: MapRegion[]) => void;
	onRoomUpdate?: (room: MatchRoom) => void;
	onUpdateSettings?: (settings: {
		rounds: number;
		seconds: number;
		noMoving: boolean;
		noPanning: boolean;
		noZooming: boolean;
		maps: MapRegion[];
		enableTimeMultiplier: boolean;
	}) => void;
	onStart: () => void;
	onLeave: () => void;
}

export default function RoomLobby({
	room,
	isHost,
	selectedMaps,
	onUpdateMaps,
	onRoomUpdate,
	onUpdateSettings,
	onStart,
	onLeave,
}: RoomLobbyProps) {
	const { user } = useAuth();
	const [players, setPlayers] = useState<
		{
			id: string;
			name: string;
			avatar: string;
			isReady: boolean;
			isHost: boolean;
		}[]
	>([]);

	const prevPlayersLengthRef = useRef(0);

	useEffect(() => {
		const prevLength = prevPlayersLengthRef.current;
		const currentLength = players.length;
		prevPlayersLengthRef.current = currentLength;

		if (prevLength > 0 && currentLength > prevLength) {
			audioManager.playSfx("join");
		}
	}, [players.length]);

	const [reconnectTrigger, setReconnectTrigger] = useState(0);

	useEffect(() => {
		const handleOnline = () => {
			toast.info("Connection restored. Re-syncing lobby state...");
			setReconnectTrigger(prev => prev + 1);
		};
		window.addEventListener("online", handleOnline);
		return () => window.removeEventListener("online", handleOnline);
	}, []);
	const [copied, setCopied] = useState(false);
	const [generatingTargets, setGeneratingTargets] = useState(false);
	const [isEditingSettings, setIsEditingSettings] = useState(false);
	const [isConfirmingClose, setIsConfirmingClose] = useState(false);
	const [playerToKick, setPlayerToKick] = useState<{ id: string; name: string } | null>(null);
	const [localIsReady, setLocalIsReady] = useState(isHost); // Host is ready by default
	const [isSyncingReady, setIsSyncingReady] = useState(false); // Track ready status sync state
	const [localIsPublic, setLocalIsPublic] = useState(room.is_public ?? true);

	useEffect(() => {
		setLocalIsPublic(room.is_public ?? true);
	}, [room.is_public]);

	const MAX_PLAYERS = 30;
	const roomChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(
		null,
	);
	const guestPresenceKeyRef = useRef(
		`guest_${room.id}_${Math.random().toString(36).slice(2, 8)}`,
	);
	const presenceReadyStatesRef = useRef<Record<string, boolean>>({});
	const kickedPlayerIdsRef = useRef<Set<string>>(new Set());

	const roomRef = useRef(room);
	roomRef.current = room;
	const presenceId = user?.uid || guestPresenceKeyRef.current;

	// Count consecutive presence syncs where host is missing before forcing a leave
	const hostMissingCountRef = useRef(0);
	const hostFirstMissingTimeRef = useRef<number | null>(null);
	const isSettledRef = useRef(false);
	useEffect(() => {
		const timer = setTimeout(() => {
			isSettledRef.current = true;
		}, 5000);
		return () => clearTimeout(timer);
	}, []);

	// Refs to ensure callbacks always read the absolute latest state without causing connection reconnects
	const localIsReadyRef = useRef(localIsReady);
	localIsReadyRef.current = localIsReady;

	const userRef = useRef(user);
	userRef.current = user;

	const isHostRef = useRef(isHost);
	isHostRef.current = isHost;

	const onStartRef = useRef(onStart);
	onStartRef.current = onStart;

	const onLeaveRef = useRef(onLeave);
	onLeaveRef.current = onLeave;

	const syncPresence = useCallback(
		async (readyState: boolean) => {
			const channel = roomChannelRef.current;
			if (!channel) return false;

			// Wait up to 2 seconds (10 × 200ms) for the channel to join
			for (let attempts = 0; attempts < 10; attempts++) {
				if (channel.state === "joined") break;
				// Give up early if channel is in a terminal error state
				if (channel.state === "closed" || channel.state === "errored") return false;
				await new Promise(resolve => window.setTimeout(resolve, 200));
			}

			if (channel.state !== "joined") return false;

			try {
				await channel.track({
					id: presenceId,
					name:
						user?.displayName ? user.displayName
						: isHost ? "Host"
						: "Guest Player",
					avatar:
						user?.avatarUrl ||
						user?.photoURL ||
						`https://ui-avatars.com/api/?name=${user?.displayName || (isHost ? "H" : "G")}&background=${isHost ? "3B82F6" : "10B981"}&color=fff`,
					isHost,
					isReady: readyState,
				});
				return true;
			} catch (error) {
				console.error("Failed to sync ready presence:", error);
				return false;
			}
		},
		[
			isHost,
			presenceId,
			user?.avatarUrl,
			user?.displayName,
			user?.photoURL,
		],
	);

	useEffect(() => {
		const currentReady = room.ready_states?.[presenceId];
		setLocalIsReady(typeof currentReady === "boolean" ? currentReady : isHost);
	}, [isHost, room.ready_states, presenceId]);

	const rebuildPlayersList = useCallback(() => {
		const channel = roomChannelRef.current;
		if (!channel) return;

		const state = channel.presenceState();
		const activePlayers: {
			id: string;
			name: string;
			avatar: string;
			isReady: boolean;
			isHost: boolean;
		}[] = [];
		const playerMap = new Map<
			string,
			{
				id: string;
				name: string;
				avatar: string;
				isReady: boolean;
				isHost: boolean;
			}
		>();
		let hostFound = false;

		const newPresenceReadyStates: Record<string, boolean> = {};
		const currentReadyStates = roomRef.current.ready_states || {};

		Object.keys(state).forEach(key => {
			const presenceElements = state[key] as any[];
			const presenceData = presenceElements[0];
			if (!presenceData) return;
			if (presenceData.isHost) hostFound = true;

			if (presenceData.isReady !== undefined) {
				newPresenceReadyStates[presenceData.id] = !!presenceData.isReady;
			}

			// Include player if they are host OR if they are in participants list and not kicked
			const isKicked = kickedPlayerIdsRef.current.has(presenceData.id);
			const isParticipant = (roomRef.current.participants || []).includes(presenceData.id);
			if (presenceData.isHost || (isParticipant && !isKicked)) {
				const dbReady = currentReadyStates[presenceData.id];
				const isReady = !!(presenceData.isHost ? true : (typeof dbReady === "boolean" ? dbReady : (presenceData.isReady !== undefined ? presenceData.isReady : false)));
				playerMap.set(presenceData.id, {
					id: presenceData.id,
					name: presenceData.name,
					avatar: presenceData.avatar,
					isReady,
					isHost: !!presenceData.isHost,
				});
			}
		});

		presenceReadyStatesRef.current = newPresenceReadyStates;

		// Always add host first if found
		if (hostFound) {
			const hostPlayer = Array.from(playerMap.values()).find(p => p.isHost);
			if (hostPlayer) activePlayers.push(hostPlayer);
		}

		// Add remaining players in sorted order (for stability)
		Array.from(playerMap.values())
			.filter(p => !p.isHost)
			.sort((a, b) => a.id.localeCompare(b.id))
			.forEach(p => activePlayers.push(p));

		if (!hostFound && isHostRef.current) {
			activePlayers.unshift({
				id: userRef.current?.uid || roomRef.current.player1_id,
				name: userRef.current?.displayName || "Host",
				avatar: `https://ui-avatars.com/api/?name=Host&background=3B82F6&color=fff`,
				isHost: true,
				isReady: true,
			});
		}

		setPlayers(activePlayers.slice(0, MAX_PLAYERS));
	}, []);

	useEffect(() => {
		const currentParticipants = room.participants || [];
		currentParticipants.forEach(id => {
			kickedPlayerIdsRef.current.delete(id);
		});
		rebuildPlayersList();
	}, [room.ready_states, room.participants, rebuildPlayersList]);

	const canStartMatch =
		isHost &&
		players.length >= 2 &&
		players.every(player => player.isReady) &&
		!generatingTargets &&
		!isSyncingReady;

	const startMatchDisabledReason = useMemo(() => {
		if (!isHost) return "";
		if (players.length < 2) return "Waiting for players to join (minimum 2 players required).";
		if (!players.every(player => player.isReady)) return "Waiting for all players to be ready.";
		if (isSyncingReady) return "Syncing readiness status...";
		if (generatingTargets) return "Generating targets...";
		return "";
	}, [isHost, players, isSyncingReady, generatingTargets]);

	useEffect(() => {
		if (!user?.uid) return;

		if (room.status === "completed") {
			clearMatchSession();
			return;
		}

		saveMatchSession({
			userId: user.uid,
			roomId: room.id,
			mode: "creatorRoom",
			tab: room.status === "active" ? "Match" : "RoomLobby",
			isHost,
		});
	}, [isHost, room.id, room.status, user?.uid]);

	useEffect(() => {
		if (!roomChannelRef.current) return;
		void syncPresence(localIsReadyRef.current);
	}, [syncPresence]);

	// Temporary state for editing settings before saving
	const [editSelectedMaps, setEditSelectedMaps] = useState<MapRegion[]>(
		room.selected_maps || ["world"],
	);
	const [editRounds, setEditRounds] = useState<number | "">(room.total_rounds);
	const [editTime, setEditTime] = useState<number | "">(room.round_seconds);
	const [editNoMove, setEditNoMove] = useState(room.no_moving);
	const [editNoPan, setEditNoPan] = useState(room.no_panning);
	const [editNoZoom, setEditNoZoom] = useState(room.no_zooming);
	const [editEnableTimeMultiplier, setEditEnableTimeMultiplier] = useState(
		room.enable_time_multiplier === true,
	);

	useEffect(() => {
		if (isEditingSettings) {
			setEditSelectedMaps(roomRef.current.selected_maps || ["world"]);
			setEditRounds(roomRef.current.total_rounds);
			setEditTime(roomRef.current.round_seconds);
			setEditNoMove(roomRef.current.no_moving);
			setEditNoPan(roomRef.current.no_panning);
			setEditNoZoom(roomRef.current.no_zooming);
			setEditEnableTimeMultiplier(roomRef.current.enable_time_multiplier === true);
		}
	}, [isEditingSettings]);

	useEffect(() => {
		const channelName = `room_${room.id}`;
		const existingChannel = supabase.getChannels().find(
			(ch: any) => ch.name === channelName || ch.topic === `realtime:${channelName}`
		);
		if (existingChannel) {
			supabase.removeChannel(existingChannel);
		}

		// Setup Realtime Presence
		const channel = supabase.channel(channelName, {
			config: {
				presence: {
					key: user?.uid || guestPresenceKeyRef.current,
				},
			},
		});
		roomChannelRef.current = channel;

		channel
			.on("presence", { event: "sync" }, () => {
				const state = channel.presenceState();
				let hostFound = false;
				let presenceCount = 0;
				Object.keys(state).forEach(key => {
					const presenceElements = state[key] as any[];
					const presenceData = presenceElements[0];
					if (presenceData) {
						presenceCount++;
						if (presenceData.isHost) hostFound = true;
					}
				});

				if (!hostFound) {
					hostMissingCountRef.current = (hostMissingCountRef.current || 0) + 1;
					if (hostFirstMissingTimeRef.current === null) {
						hostFirstMissingTimeRef.current = Date.now();
					}
				} else {
					hostMissingCountRef.current = 0;
					hostFirstMissingTimeRef.current = null;
				}

				if (roomRef.current.status === "completed") {
					hostMissingCountRef.current = 0;
					hostFirstMissingTimeRef.current = null;
					rebuildPlayersList();
					return;
				}

				if (!hostFound && !isHostRef.current && presenceCount > 0 && hostFirstMissingTimeRef.current !== null && (Date.now() - hostFirstMissingTimeRef.current >= 15000) && isSettledRef.current) {
					toast.error("The host has left the room. Moving back to home.");
					onLeaveRef.current();
					return;
				}

				rebuildPlayersList();
			})
			.on("broadcast", { event: "kick" }, payload => {
				const { kickedUserId } = payload.payload;
				kickedPlayerIdsRef.current.add(kickedUserId);
				rebuildPlayersList();
				if (presenceId === kickedUserId) {
					toast.error("You were kicked from the room.");
					onLeaveRef.current();
				}
			})
			.on("broadcast", { event: "room_updated" }, payload => {
				const updatedRoom = payload.payload as MatchRoom;
				onRoomUpdate?.(updatedRoom);
			})
			.on("broadcast", { event: "generating_maps" }, () => {
				setGeneratingTargets(true);
			})
			.on("broadcast", { event: "generation_failed" }, () => {
				setGeneratingTargets(false);
			})
			.on("broadcast", { event: "room_started" }, () => {
				if (!isHostRef.current) {
					onStartRef.current();
				}
			})
			.on(
				"postgres_changes",
				{
					event: "UPDATE",
					schema: "public",
					table: "match_rooms",
					filter: `id=eq.${room.id}`,
				},
				payload => {
					if (payload.new) {
						const rawRoom = payload.new;
						const updatedRoom = {
							...rawRoom,
							targets:
								typeof rawRoom.targets === "string" ?
									JSON.parse(rawRoom.targets)
								:	rawRoom.targets,
							ready_states:
								typeof rawRoom.ready_states === "string" ?
									JSON.parse(rawRoom.ready_states)
								: 	rawRoom.ready_states || {},
							participants:
								typeof rawRoom.participants === "string" ?
									JSON.parse(rawRoom.participants)
								:	rawRoom.participants || [],
							selected_maps:
								typeof rawRoom.selected_maps === "string" ?
									JSON.parse(rawRoom.selected_maps)
								:	rawRoom.selected_maps || ["world"],
							scores:
								typeof rawRoom.scores === "string" ?
									JSON.parse(rawRoom.scores)
								:	rawRoom.scores || {},
						} as MatchRoom;

						onRoomUpdate?.(updatedRoom);

						// Check if current user has been kicked
						const currentUserId = presenceId;
						const participants =
							Array.isArray(updatedRoom.participants) ?
								updatedRoom.participants
							:	[];

						if (
							!isHostRef.current &&
							!participants.includes(currentUserId) &&
							players.length > 0
						) {
							toast.error("You were kicked from the room.");
							onLeaveRef.current();
							return;
						}
					}
					if (payload.new.status === "active" && !isHostRef.current) {
						onStartRef.current();
					}
				},
			)
			.on(
				"postgres_changes",
				{
					event: "DELETE",
					schema: "public",
					table: "match_rooms",
					filter: `id=eq.${room.id}`,
				},
				() => {
					if (!isHostRef.current) {
						toast.error("The host has closed the room.");
						onLeaveRef.current();
					}
				},
			)
			.subscribe(async status => {
				if (status === "SUBSCRIBED") {
					void syncPresence(localIsReadyRef.current);
				}
			});

		return () => {
			roomChannelRef.current = null;
			supabase.removeChannel(channel);
		};
	}, [room.id, presenceId, syncPresence, reconnectTrigger]);


	const handleReadyToggle = async () => {
		if (isSyncingReady) return;

		const previousReady = localIsReadyRef.current;
		const nextReady = !previousReady;
		setLocalIsReady(nextReady);
		setIsSyncingReady(true);

		try {
			const { data, error } = await supabase.rpc("set_player_ready", {
				p_room_id: room.id,
				p_user_id: presenceId,
				p_is_ready: nextReady,
			});

			if (error) throw error;

			const parsedRoom = {
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
			} as MatchRoom;

			onRoomUpdate?.(parsedRoom);

			const channel = roomChannelRef.current;
			if (channel) {
				if (channel.state === "joined") {
					void channel.send({
						type: "broadcast",
						event: "room_updated",
						payload: parsedRoom,
					});
				} else {
					console.warn("Could not broadcast room_updated: channel not joined.", parsedRoom);
				}
			}

			const synced = await syncPresence(nextReady);
			if (!synced) {
				setLocalIsReady(previousReady);
				toast.error("Ready status sync failed. Please try again.");
			}
		} catch (err) {
			console.error("Failed to sync ready status:", err);
			setLocalIsReady(previousReady);
			toast.error("Ready status sync failed. Please check your network connection.");
			void logSystemError("Failed to sync ready status", {
				roomId: room.id,
				playerId: presenceId,
				error: err instanceof Error ? err.message : String(err),
			});
		} finally {
			setIsSyncingReady(false);
		}
	};

	const handleLeave = async () => {
		if (!user) return;
		const myId = user.uid;
		clearMatchSession();
		if (isHost) {
			if (!isConfirmingClose) {
				setIsConfirmingClose(true);
				return;
			}

			try {
				// Delete room from DB via secure RPC
				const { error } = await supabase.rpc("close_match_room", {
					p_room_id: room.id,
					p_user_id: myId,
				});
				if (error) {
					console.error("Failed to close room:", error);
					void logSystemError("close_match_room RPC failure", {
						roomId: room.id,
						userId: myId,
						error: error.message,
						code: error.code,
					});
					// Fallback: try direct delete if RPC fails
					const { error: deleteError } = await supabase.from("match_rooms").delete().eq("id", room.id);
					if (deleteError) {
						console.error("Direct room delete fallback failure:", deleteError);
						void logSystemError("Direct room delete fallback failure", {
							roomId: room.id,
							error: deleteError.message,
							code: deleteError.code,
						});
					}
				}
			} catch (err) {
				console.error("Error during room closure:", err);
			} finally {
				onLeave();
			}
		} else {
			try {
				await leaveRoom(room.id, myId);
			} catch (err) {
				console.error("Failed to leave room:", err);
				toast.error("Failed to cleanly leave the room from the server.");
				void logSystemError("leaveRoom exception", {
					roomId: room.id,
					userId: myId,
					error: err instanceof Error ? err.message : String(err),
				});
			}
			onLeave();
		}
	};

	const copyCode = () => {
		navigator.clipboard.writeText(room.id.substring(0, 6).toUpperCase());
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="w-full h-full flex flex-col relative animate-in fade-in duration-700 text-[var(--color-app-text)]">
			{generatingTargets && (
				<div className="fixed inset-0 z-[1000] flex flex-col items-center justify-center bg-black/75 backdrop-blur-md text-white animate-in fade-in duration-200">
					<div className="relative flex flex-col items-center justify-center p-8 rounded-3xl border border-[var(--color-app-border-light)] bg-[var(--color-app-panel)]/95 max-w-sm w-full mx-4 shadow-2xl text-center">
						<Loader2 className="w-12 h-12 text-[var(--color-app-blue)] animate-spin mb-4" />
						<h3 className="text-lg font-black text-[var(--color-app-text)] mb-2">Generating Maps</h3>
						<p className="text-sm text-[var(--color-app-text-muted)] leading-relaxed">
							The host has started the match. Preparing street view locations, please wait...
						</p>
					</div>
				</div>
			)}
			<div className="w-full flex flex-col gap-8 h-full">
				<div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch h-full">
					{/* Left Side: Room Info & Rules */}
					<div className="lg:col-span-3 flex flex-col gap-6">
						{/* Room Info Card */}
						<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-3xl p-6 sm:p-8 shadow-xl">
							<div className="flex flex-col gap-6">
								<div className="flex flex-col gap-2">
									<h1 className="text-2xl font-black text-[var(--color-app-text)] flex items-center gap-3">
										<Hash className="w-6 h-6 text-[var(--color-app-blue)]" />
										Room Lobby
									</h1>
									<p className="text-xs text-[var(--color-app-text-muted)]">
										Share this code with up to {MAX_PLAYERS} players.
									</p>
								</div>

								<div className="flex flex-col items-center p-4 bg-[var(--color-app-bg)]/40 rounded-2xl border border-[var(--color-app-border-light)]">
									<div className="text-[10px] font-black uppercase tracking-widest text-[var(--color-app-text-muted)] mb-2">
										Entry Code
									</div>
									<div
										onClick={copyCode}
										className="flex items-center gap-3 cursor-pointer group">
										<span className="text-3xl font-mono font-black text-[var(--color-app-text)] tracking-[0.2em] ml-2">
											{room.id.substring(0, 6).toUpperCase()}
										</span>
										<div
											className={cn(
												"p-2 rounded-lg transition-colors",
												copied ?
													"bg-green-500/20 text-green-400"
												:	"bg-[var(--color-app-hover)] text-[var(--color-app-text-muted)] group-hover:text-[var(--color-app-text)]",
											)}>
											{copied ?
												<Users className="w-4 h-4" />
											:	<Copy className="w-4 h-4" />}
										</div>
									</div>
								</div>

								<div className="flex items-center justify-between p-4 bg-[var(--color-app-bg)]/20 border border-[var(--color-app-border-light)] rounded-2xl">
									<span className="text-xs font-bold text-[var(--color-app-text)] flex items-center gap-2">
										{localIsPublic ? "🌍 Public Room" : "🔒 Private Room"}
									</span>
									{isHost && (
										<Toggle
											label=""
											checked={localIsPublic}
											onChange={async (val) => {
												setLocalIsPublic(val);
												await supabase.from("match_rooms").update({ is_public: val }).eq("id", room.id);
												const updatedRoom = { ...room, is_public: val };
												onRoomUpdate?.(updatedRoom);
												const channel = roomChannelRef.current;
												if (channel?.state === "joined") {
													void channel.send({ type: "broadcast", event: "room_updated", payload: updatedRoom });
												}
											}}
										/>
									)}
								</div>

								<div className="flex flex-col items-center mt-2">
									{!isHost && (
										<button
											onClick={handleReadyToggle}
											disabled={isSyncingReady}
											className={cn(
												"w-full h-14 rounded-2xl font-black text-sm tracking-widest uppercase transition-all shadow-lg flex items-center justify-center gap-2",
												isSyncingReady ?
													"bg-yellow-500/20 border border-yellow-500/50 text-yellow-400 cursor-wait opacity-75"
												: localIsReady ?
													"bg-green-500/20 border border-green-500/50 text-green-400 hover:bg-green-500/30"
												:	"bg-[var(--color-app-blue)] text-[var(--color-app-text)] hover:bg-blue-500 shadow-blue-500/20 shadow-blue-500/20 hover:scale-[1.02] active:scale-95",
											)}>
											{isSyncingReady ?
												<>
													<div className="w-5 h-5 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
													Syncing...
												</>
											: localIsReady ?
												<>
													<Check className="w-5 h-5" />
													I'm Ready!
												</>
											:	<>
													<Play className="w-5 h-5" />
													Set Ready
												</>
											}
										</button>
									)}
									{isHost && (
										<div className="w-full h-14 rounded-2xl bg-[var(--color-app-hover)] border border-[var(--color-app-border-light)] flex items-center justify-center gap-2">
											<Trophy className="w-4 h-4 text-yellow-500" />
											<span className="text-[10px] font-black uppercase tracking-widest text-[var(--color-app-text-muted)]">
												Room Master
											</span>
										</div>
									)}
								</div>
							</div>
						</div>

						{/* Match Rules Card */}
						<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-3xl p-6 shadow-xl h-fit">
							<div className="flex items-center justify-between mb-6">
								<h3 className="text-xs font-black uppercase tracking-widest text-[var(--color-app-text-muted)] flex items-center gap-2">
									<Settings className="w-4 h-4" /> Match Rules
								</h3>
								{isHost && (
									<button
										className="text-xs text-[var(--color-app-blue)] hover:text-blue-400 font-bold uppercase tracking-wider"
										onClick={() => setIsEditingSettings(true)}>
										Edit
									</button>
								)}
							</div>

							<div className="flex flex-col gap-4">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-3">
										<div className="w-8 h-8 rounded-lg bg-[var(--color-app-hover)] flex items-center justify-center">
											<Target className="w-4 h-4 text-[var(--color-app-text-muted)]" />
										</div>
										<span className="text-sm font-medium text-[var(--color-app-text)] opacity-80">
											Rounds
										</span>
									</div>
									<span className="font-mono font-bold text-[var(--color-app-blue)]">
										{room.total_rounds}
									</span>
								</div>

								<div className="flex items-center justify-between">
									<div className="flex items-center gap-3">
										<div className="w-8 h-8 rounded-lg bg-[var(--color-app-hover)] flex items-center justify-center">
											<Clock className="w-4 h-4 text-[var(--color-app-text-muted)]" />
										</div>
										<span className="text-sm font-medium text-[var(--color-app-text)] opacity-80">
											Round Time
										</span>
									</div>
									<span className="font-mono font-bold text-[var(--color-app-blue)]">
										{room.round_seconds}s
									</span>
								</div>

								<div className="h-px bg-[var(--color-app-border-light)] my-2" />

								<div className="space-y-3">
									<div
										className={cn(
											"flex items-center justify-between text-xs",
											room.no_moving ? "text-green-500" : "text-red-400",
										)}>
										<span className="font-medium text-[var(--color-app-text)] opacity-60">
											No Moving
										</span>
										<span className="font-bold">
											{room.no_moving ? "ON" : "OFF"}
										</span>
									</div>
									<div
										className={cn(
											"flex items-center justify-between text-xs",
											room.no_panning ? "text-green-500" : "text-red-400",
										)}>
										<span className="font-medium text-[var(--color-app-text)] opacity-60">
											No Panning
										</span>
										<span className="font-bold">
											{room.no_panning ? "ON" : "OFF"}
										</span>
									</div>
									<div
										className={cn(
											"flex items-center justify-between text-xs",
											room.no_zooming ? "text-green-500" : "text-red-400",
										)}>
										<span className="font-medium text-[var(--color-app-text)] opacity-60">
											No Zooming
										</span>
										<span className="font-bold">
											{room.no_zooming ? "ON" : "OFF"}
										</span>
									</div>
									<div
										className={cn(
											"flex items-center justify-between text-xs",
											room.enable_time_multiplier === true ? "text-green-500" : "text-red-400",
										)}>
										<span className="font-medium text-[var(--color-app-text)] opacity-60">
											Time Multiplier
										</span>
										<span className="font-bold">
											{room.enable_time_multiplier === true ? "ON" : "OFF"}
										</span>
									</div>
								</div>
							</div>
						</div>

						{/* Leave Button for non-mobile */}
						<div className="hidden sm:flex flex-col gap-2">
							<button
								onClick={handleLeave}
								className={cn(
									"w-full h-12 rounded-2xl border font-bold transition-all flex items-center justify-center gap-2",
									isConfirmingClose ?
										"bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30"
									:	"border-[var(--color-app-border-light)] text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] hover:bg-[var(--color-app-hover)]",
								)}>
								{isConfirmingClose ?
									<AlertTriangle className="w-4 h-4" />
								:	<X className="w-4 h-4" />}
								{isHost ?
									isConfirmingClose ?
										"Confirm Close?"
									:	"Close Room"
								:	"Leave Room"}
							</button>
							{isConfirmingClose && (
								<button
									onClick={() => setIsConfirmingClose(false)}
									className="text-[10px] text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors uppercase font-black tracking-widest text-center cursor-pointer">
									Cancel
								</button>
							)}
						</div>
					</div>

					{/* Right Side: Players List */}
					<div className="lg:col-span-9 flex flex-col gap-4 min-h-0 flex-1">
						{/* Selected Maps Horizontal Panel */}
						<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-3xl p-5 shadow-xl flex items-center gap-6 overflow-x-auto no-scrollbar animate-in slide-in-from-right duration-500">
							<div className="flex items-center gap-3 shrink-0">
								<div className="w-10 h-10 rounded-xl bg-[var(--color-app-blue)]/10 flex items-center justify-center border border-[var(--color-app-blue)]/20 shadow-inner">
									<MapIcon className="w-5 h-5 text-[var(--color-app-blue)]" />
								</div>
								<span className="text-[10px] font-black uppercase tracking-widest text-[var(--color-app-text-muted)] leading-none">
									Selected Maps
								</span>
							</div>

							<div className="flex items-center gap-3 pr-4">
								{(
									!room.selected_maps ||
									room.selected_maps.length === 0 ||
									room.selected_maps.includes("world")
								) ?
									<div className="px-4 py-2 rounded-2xl bg-[var(--color-app-hover)] border border-[var(--color-app-border-light)] flex items-center gap-3 whitespace-nowrap shadow-sm">
										<span className="text-2xl">🌎</span>
										<span className="text-sm font-bold text-[var(--color-app-text)] opacity-90">
											World
										</span>
									</div>
								:	room.selected_maps.map(mapKey => {
										const map = MAPS[mapKey];
										if (!map) return null;
										return (
											<div
												key={mapKey}
												className="px-4 py-2 rounded-2xl bg-[var(--color-app-hover)] border border-[var(--color-app-border-light)] flex items-center gap-3 whitespace-nowrap shadow-sm hover:bg-[var(--color-app-border)] transition-colors">
												<span className="text-2xl">{map.flag}</span>
												<span className="text-sm font-bold text-[var(--color-app-text)] opacity-90">
													{map.name}
												</span>
											</div>
										);
									})
								}
							</div>
						</div>

						<div className="grid grid-cols-1 xl:grid-cols-12 gap-4 flex-1 min-h-0">
							<div className="xl:col-span-7 bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-3xl p-6 sm:p-8 shadow-xl flex flex-col min-h-0">
								<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
									<h3 className="text-xs font-black uppercase tracking-widest text-[var(--color-app-text-muted)] flex items-center gap-2">
										<Users className="w-5 h-5 text-[var(--color-app-blue)]" />
										Participants ({players.length}/{MAX_PLAYERS})
									</h3>									{isHost && (
										<div className="flex flex-col items-end gap-1.5">
											<button
												disabled={!canStartMatch || generatingTargets}
												title={!canStartMatch ? startMatchDisabledReason : ""}
												onClick={async () => {
													if (!canStartMatch) {
														toast.error(startMatchDisabledReason || "Need 2 ready players");
														return;
													}
													if (room.id) {
														const channel = roomChannelRef.current;
														if (channel && channel.state === "joined") {
															void channel.send({
																type: "broadcast",
																event: "generating_maps",
															});
														}
														setGeneratingTargets(true);
														try {
															const apiKey =
																import.meta.env.VITE_GOOGLE_MAPS_PLATFORM_KEY ??
																"";
															const initialTargetCount = Math.min(2, room.total_rounds);
															const initialTargets = await generateTargets(
																apiKey,
																room.selected_maps || ["world"],
																initialTargetCount,
																"creatorRoom"
															);
															const { error: updateError } = await supabase
																.from("match_rooms")
																.update({
																	status: "active",
																	targets: initialTargets as any,
																})
																.eq("id", room.id);
															if (updateError) {
																throw updateError;
															}

															const startedRoom: MatchRoom = {
																...room,
																status: "active",
																targets: initialTargets as any,
															};
															onRoomUpdate?.(startedRoom);
															
															// Broadcast started match status
															if (channel) {
																if (channel.state === "joined") {
																	void channel.send({
																		type: "broadcast",
																		event: "room_started",
																	});
																} else {
																	console.warn("Could not broadcast room_started: channel not joined.");
																}
															}
															onStart();

															if (initialTargetCount < room.total_rounds) {
																void (async () => {
																	try {
																		const remainingTargets = await generateTargets(
																			apiKey,
																			room.selected_maps || ["world"],
																			room.total_rounds - initialTargetCount,
																			"creatorRoom"
																		);
																		const combinedTargets = [...initialTargets, ...remainingTargets];
																		await supabase
																			.from("match_rooms")
																			.update({
																				targets: combinedTargets as any,
																			})
																			.eq("id", room.id);
																	} catch (backgroundError) {
																		console.error('Failed to continue generating Creator Room targets:', backgroundError);
																		void logSystemError('Creator Room background target generation failure', {
																			roomId: room.id,
																			error: backgroundError instanceof Error ? backgroundError.message : String(backgroundError),
																		});
																	}
																})();
															}
														} catch (e) {
															toast.error("Failed to start match or generate locations.");
															if (channel && channel.state === "joined") {
																void channel.send({
																	type: "broadcast",
																	event: "generation_failed",
																});
															}
															void logSystemError("Failed to start creator match room", {
																roomId: room.id,
																error: e instanceof Error ? e.message : String(e),
															});
														} finally {
															setGeneratingTargets(false);
														}
													}
												}}
												className={cn(
													"h-11 px-8 rounded-xl bg-[var(--color-app-blue)] text-white font-bold hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 group",
													(!canStartMatch || generatingTargets) && "opacity-50 cursor-not-allowed"
												)}>
												{generatingTargets ?
													<>
														<Loader2 className="w-4 h-4 animate-spin" />
														Generating Maps...
													</>
												:	<>
														<Play className="w-4 h-4 fill-current group-hover:scale-110 transition-transform" />
														Start Match
													</>
												}
											</button>
											{!canStartMatch && startMatchDisabledReason && (
												<span className="text-[10px] text-amber-500/90 font-bold max-w-[220px] text-right leading-tight select-none">
													{startMatchDisabledReason}
												</span>
											)}
										</div>
									)}
								</div>

								<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1 content-start overflow-y-auto no-scrollbar pr-1">
									{players.map(p => (
										<div
											key={p.id}
											className={cn(
												"flex items-center justify-between bg-[var(--color-app-bg)]/60 border border-[var(--color-app-border-light)] p-4 rounded-2xl transition-all group relative",
												p.isHost &&
													"border-[var(--color-app-blue)]/30 bg-[var(--color-app-blue)]/5",
												p.isReady &&
													!p.isHost &&
													"border-green-500/30 bg-green-500/5",
											)}>
											<div className="flex items-center gap-4">
												<div className="relative">
													<img
														src={p.avatar}
														alt=""
														className="w-12 h-12 rounded-xl object-cover border border-[var(--color-app-border-light)]"
													/>
													{p.isHost && (
														<div className="absolute -top-2 -right-2 bg-yellow-500 text-yellow-950 p-1 rounded-md shadow-lg">
															<Trophy className="w-3 h-3" />
														</div>
													)}
													{!p.isHost && p.isReady && (
														<div className="absolute -top-2 -right-2 bg-green-500 text-white p-1 rounded-md shadow-lg">
															<Check className="w-3 h-3" />
														</div>
													)}
												</div>
												<div>
													<div className="font-bold text-[var(--color-app-text)] text-base flex items-center gap-2">
														{p.name}
													</div>
													<div
														className={cn(
															"text-[10px] uppercase font-black tracking-widest",
															p.isHost ? "text-[var(--color-app-blue)]"
															: p.isReady ? "text-green-400"
															: "text-amber-400",
														)}>
														{p.isHost ?
															"Game Master"
														: p.isReady ?
															"Ready to Play"
														:	"Still Preparing"}
													</div>
												</div>
											</div>
											{isHost && !p.isHost && (
												<button
													onClick={() => setPlayerToKick({ id: p.id, name: p.name })}
													className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-red-500/20 rounded-full text-red-400"
													title="Kick this player"
													aria-label={`Kick ${p.name}`}>
													<X className="w-3.5 h-3.5" />
												</button>
											)}
										</div>
									))}
								</div>
							</div>

							<div className="xl:col-span-5 bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-3xl shadow-xl flex flex-col min-h-0 flex-1">
								<div className="px-6 sm:px-8 py-4 sm:py-5 border-b border-[var(--color-app-border-light)]">
									<h3 className="text-xs font-black uppercase tracking-widest text-[var(--color-app-text-muted)] flex items-center gap-2">
										<Clock className="w-4 h-4 text-[var(--color-app-blue)]" />{" "}
										Room Chat
									</h3>
								</div>
								<div className="flex-1 min-h-0 overflow-hidden">
									<RoomChat room={room} isHost={isHost} />
								</div>
							</div>
							{/* Mobile Leave Button */}
							<div className="flex sm:hidden flex-col gap-2 mt-8">
								<button
									onClick={handleLeave}
									className={cn(
										"w-full h-12 rounded-2xl border font-bold transition-all flex items-center justify-center gap-2",
										isConfirmingClose ?
											"bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30"
										:	"border-[var(--color-app-border-light)] text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] hover:bg-[var(--color-app-hover)]",
									)}>
									{isConfirmingClose ?
										<Hash className="w-4 h-4" />
									:	<X className="w-4 h-4" />}
									{isHost ?
										isConfirmingClose ?
											"Confirm Close?"
										:	"Close Room"
									:	"Leave Room"}
								</button>
								{isConfirmingClose && (
									<button
										onClick={() => setIsConfirmingClose(false)}
										className="text-[10px] text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors uppercase font-black tracking-widest text-center cursor-pointer">
										Cancel
									</button>
								)}
							</div>
						</div>
					</div>
				</div>
			</div>

			{isEditingSettings && isHost && (
				<div className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
					<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-3xl w-full max-w-6xl shadow-2xl relative max-h-[90vh] flex flex-col md:flex-row overflow-hidden text-[var(--color-app-text)]">
						{/* Left side: Game Settings */}
						<div className="w-full md:w-1/3 p-6 md:border-r border-[var(--color-app-border-light)] bg-[var(--color-app-panel)] flex flex-col overflow-y-auto no-scrollbar">
							<h3 className="text-lg font-black text-[var(--color-app-text)] mb-6">
								Edit Match Rules
							</h3>
							<div className="space-y-4 flex-1">
								<NumericInput
									label="Rounds"
									min={5}
									max={30}
									value={editRounds}
									onChange={(val) => setEditRounds(val)}
									className="mb-1"
								/>
								<NumericInput
									label="Round Time"
									min={20}
									max={90}
									step={5}
									value={editTime}
									onChange={(val) => setEditTime(val)}
									suffix="s"
									className="mb-1"
								/>
								<div className="flex flex-col gap-3 py-2">
									<Toggle
										label="No Move"
										checked={editNoMove}
										onChange={setEditNoMove}
									/>
									<Toggle
										label="No Pan"
										checked={editNoPan}
										onChange={setEditNoPan}
									/>
									<Toggle
										label="No Zoom"
										checked={editNoZoom}
										onChange={setEditNoZoom}
									/>
									<Toggle
										label="Time Multiplier"
										checked={editEnableTimeMultiplier}
										onChange={setEditEnableTimeMultiplier}
									/>
								</div>
							</div>
							<div className="flex flex-col gap-3 mt-8">
								<button
									onClick={async () => {
										try {
											const rounds = Math.max(5, Math.min(30, Number(editRounds) || 5));
											const time = Math.max(20, Math.min(90, Math.round((Number(editTime) || 20) / 5) * 5));
											const mapsToSave =
												editSelectedMaps.length > 0 ?
													editSelectedMaps
												:	["world"];

											const { error } = await supabase
												.from("match_rooms")
												.update({
													total_rounds: rounds,
													round_seconds: time,
													no_moving: editNoMove,
													no_panning: editNoPan,
													no_zooming: editNoZoom,
													selected_maps: mapsToSave,
													enable_time_multiplier: editEnableTimeMultiplier,
												})
												.eq("id", room.id);

											if (error) throw error;

											// Update room state immediately for better sync
											const updatedRoom = {
												...room,
												total_rounds: rounds,
												round_seconds: time,
												no_moving: editNoMove,
												no_panning: editNoPan,
												no_zooming: editNoZoom,
												selected_maps: mapsToSave as MapRegion[],
												enable_time_multiplier: editEnableTimeMultiplier,
											};
											onRoomUpdate?.(updatedRoom);

											// Broadcast the updated settings to all clients
											const channel = roomChannelRef.current;
											if (channel) {
												if (channel.state === "joined") {
													void channel.send({
														type: "broadcast",
														event: "room_updated",
														payload: updatedRoom,
													});
												} else {
													console.warn("Could not broadcast room_updated: channel not joined.", updatedRoom);
												}
											}

											if (onUpdateSettings) {
												onUpdateSettings({
													rounds,
													seconds: time,
													noMoving: editNoMove,
													noPanning: editNoPan,
													noZooming: editNoZoom,
													maps: mapsToSave as MapRegion[],
													enableTimeMultiplier: editEnableTimeMultiplier,
												});
											}

											if (onUpdateMaps) {
												// Removed redundant call as maps are now in onUpdateSettings
											}

											setIsEditingSettings(false);
											toast.success("Rules updated!");
										} catch (e) {
											console.error("Update error:", e);
											toast.error("Failed to update rules. Please check your network connection.");
											void logSystemError("Failed to update creator room settings", {
												roomId: room.id,
												error: e instanceof Error ? e.message : String(e),
											});
										}
									}}
									className="w-full py-3.5 rounded-xl bg-[var(--color-app-blue)] text-[var(--color-app-text)] font-bold hover:bg-blue-500 transition shadow-lg shadow-blue-500/20">
									Save Changes
								</button>
								<button
									onClick={() => setIsEditingSettings(false)}
									className="w-full py-3.5 rounded-xl border border-[var(--color-app-border-light)] text-[var(--color-app-text)] opacity-70 font-bold hover:bg-[var(--color-app-hover)] transition">
									Cancel
								</button>
							</div>
						</div>

						{/* Right side: Map Selection */}
						<div className="w-full md:w-2/3 p-6 bg-[var(--color-app-bg)] flex flex-col overflow-y-auto no-scrollbar">
							<div className="flex items-center justify-between mb-2">
								<h3 className="text-lg font-black text-[var(--color-app-text)]">
									Maps
								</h3>
								<span className="text-xs font-bold text-[var(--color-app-blue)]">
									{editSelectedMaps.includes("world") ?
										"World selected"
									:	`${editSelectedMaps.length}/${MAX_SELECTED_MAPS} Selected`}
								</span>
							</div>
							<p className="text-xs text-[var(--color-app-text-muted)] mb-6">
								Select up to {MAX_SELECTED_MAPS} maps. Choosing World overrides
								others.
							</p>

							<div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
								<button
									onClick={() => {
										if (editSelectedMaps.includes("world")) {
											setEditSelectedMaps([]);
										} else {
											setEditSelectedMaps(["world"]);
										}
									}}
									className={`relative h-24 overflow-hidden rounded-xl border-2 transition-all flex flex-col items-center justify-center ${editSelectedMaps.includes("world") ? "border-[var(--color-app-blue)] shadow-[0_0_15px_rgba(59,130,246,0.2)]" : "border-[var(--color-app-border-light)] hover:border-[var(--color-app-border)]"}`}>
									<div className="absolute inset-0 bg-[var(--color-app-panel)]" />
									{editSelectedMaps.includes("world") && (
										<div className="absolute inset-0 bg-[var(--color-app-blue)]/10 z-10" />
									)}
									<div className="relative z-20 flex flex-col items-center">
										<span className="text-3xl mb-1">🌎</span>
										<span
											className={`text-xs font-bold ${editSelectedMaps.includes("world") ? "text-[var(--color-app-blue)] font-extrabold" : "text-[var(--color-app-text)]"}`}>
											World
										</span>
									</div>
								</button>

								{Object.entries(MAPS)
									.filter(([k]) => k !== "world")
									.map(([mapKey, map]) => {
										const active = editSelectedMaps.includes(
											mapKey as MapRegion,
										);
										const worldSelected = editSelectedMaps.includes("world");
										const disabled =
											!active &&
											(editSelectedMaps.length >= MAX_SELECTED_MAPS ||
												worldSelected);

										return (
											<button
												key={mapKey}
												disabled={disabled}
												onClick={() => {
													let newMaps = [...editSelectedMaps];
													if (active) {
														newMaps = newMaps.filter(m => m !== mapKey);
													} else {
														newMaps.push(mapKey as MapRegion);
													}
													setEditSelectedMaps(newMaps);
												}}
												className={`relative h-24 overflow-hidden rounded-xl border-2 transition-all flex flex-col items-center justify-center ${active ? "border-[var(--color-app-blue)] shadow-[0_0_15px_rgba(59,130,246,0.2)]" : "border-[var(--color-app-border-light)] hover:border-[var(--color-app-border)]"} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}>
												<div
													className="absolute inset-0 bg-cover bg-center"
													style={{
														backgroundImage:
															map.flagImage ?
																`url(${map.flagImage})`
															:	map.background,
													}}
												/>
												<div className="absolute inset-0 bg-slate-950/70" />
												{active && (
													<div className="absolute inset-0 bg-[var(--color-app-blue)]/10 z-10" />
												)}
												<div className="relative z-20 flex flex-col items-center">
													<span className="text-3xl mb-1 drop-shadow-md">
														{map.flag}
													</span>
													<span
														className={`text-xs font-bold drop-shadow-md ${active ? "text-blue-300" : "text-white"}`}>
														{map.name}
													</span>
												</div>
												{active && (
													<div className="absolute top-1.5 right-1.5 z-20 bg-[var(--color-app-blue)] text-[var(--color-app-text)] rounded-full min-w-5 h-5 px-1 flex items-center justify-center shadow-md">
														<span className="text-[10px] font-black">
															{editSelectedMaps.indexOf(mapKey as MapRegion) +
																1}
														</span>
													</div>
												)}
											</button>
										);
									})}
							</div>
						</div>
					</div>
				</div>
			)}
			{playerToKick && (
				<div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
					<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-3xl w-full max-w-md shadow-2xl p-6 relative text-[var(--color-app-text)] text-center animate-in fade-in zoom-in-95 duration-200">
						<div className="w-16 h-16 bg-red-500/10 border border-red-500/20 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
							<AlertTriangle className="w-8 h-8 animate-pulse" />
						</div>
						<h3 className="text-lg font-black text-[var(--color-app-text)] mb-2">
							Kick Player?
						</h3>
						<p className="text-sm text-[var(--color-app-text-muted)] mb-6">
							Are you sure you want to kick <span className="text-[var(--color-app-text)] font-bold">{playerToKick.name}</span> from the lobby?
						</p>
						<div className="flex gap-3">
							<button
								onClick={() => setPlayerToKick(null)}
								className="flex-1 h-12 rounded-xl border border-[var(--color-app-border-light)] bg-[var(--color-app-hover)] font-bold hover:bg-[var(--color-app-border)] transition-colors"
							>
								Cancel
							</button>
							<button
								onClick={async () => {
									const p = playerToKick;
									setPlayerToKick(null);
									try {
										const success = await kickParticipantFromRoom(
											room.id,
											p.id,
											user?.uid || "",
										);
										if (success) {
											toast.success(`Kicked ${p.name}`);
											// Broadcast the kick event to all clients
											const channel = roomChannelRef.current;
											if (channel) {
												if (channel.state === "joined") {
													void channel.send({
														type: "broadcast",
														event: "kick",
														payload: { kickedUserId: p.id },
													});
												} else {
													console.warn("Could not broadcast kick: channel not joined.", p.id);
												}
											}
										} else {
											toast.error("Failed to kick participant");
										}
									} catch (err) {
										console.error("Kick error:", err);
										toast.error("Failed to kick participant");
									}
								}}
								className="flex-1 h-12 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold shadow-lg shadow-red-950/20 transition-colors"
							>
								Kick Player
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
