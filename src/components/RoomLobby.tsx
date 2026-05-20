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
} from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { cn } from "../lib/utils";
import {
	type MatchRoom,
	generateTargets,
	kickParticipantFromRoom,
} from "../lib/Matchmaking";
import { useAuth } from "../lib/AuthContext";
import { supabase } from "../lib/supabase";

import { type MapRegion, MAPS, MAX_SELECTED_MAPS } from "../lib/MapRegions";
import RoomChat from "./RoomChat";
import { Toggle } from "./ui";
import { useRef } from "react";
import {
	clearMatchSession,
	saveMatchSession,
} from "../lib/matchSessionPersistence";

interface RoomLobbyProps {
	room: MatchRoom;
	isHost: boolean;
	selectedMaps: MapRegion[];
	onUpdateMaps?: (maps: MapRegion[]) => void;
	onUpdateSettings?: (settings: {
		rounds: number;
		seconds: number;
		noMoving: boolean;
		noPanning: boolean;
		noZooming: boolean;
		maps: MapRegion[];
	}) => void;
	onStart: () => void;
	onLeave: () => void;
}

export default function RoomLobby({
	room,
	isHost,
	selectedMaps,
	onUpdateMaps,
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
	const [copied, setCopied] = useState(false);
	const [generatingTargets, setGeneratingTargets] = useState(false);
	const [isEditingSettings, setIsEditingSettings] = useState(false);
	const [isConfirmingClose, setIsConfirmingClose] = useState(false);
	const [localIsReady, setLocalIsReady] = useState(isHost); // Host is ready by default
	const [isSyncingReady, setIsSyncingReady] = useState(false); // Track ready status sync state
	const MAX_PLAYERS = 30;
	const roomChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(
		null,
	);
	const guestPresenceKeyRef = useRef(
		`guest_${room.id}_${Math.random().toString(36).slice(2, 8)}`,
	);

	const [localRoom, setLocalRoom] = useState<MatchRoom>(room);
	const presenceId = user?.uid || guestPresenceKeyRef.current;

	// Refs to ensure callbacks always read the absolute latest state without causing connection reconnects
	const localIsReadyRef = useRef(localIsReady);
	localIsReadyRef.current = localIsReady;

	const isSyncingReadyRef = useRef(isSyncingReady);
	isSyncingReadyRef.current = isSyncingReady;

	const userRef = useRef(user);
	userRef.current = user;

	const isHostRef = useRef(isHost);
	isHostRef.current = isHost;

	const canStartMatch =
		isHost &&
		players.length >= 2 &&
		players.every(player => player.isReady) &&
		!generatingTargets &&
		!isSyncingReady;

	useEffect(() => {
		setLocalRoom(room);
	}, [room]);

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
		void roomChannelRef.current.track({
			id: presenceId,
			name:
				user?.displayName ? `${user.displayName}${isHost ? " (host)" : ""}`
				: isHost ? "Host (host)"
				: "Guest Player",
			avatar:
				user?.avatarUrl ||
				user?.photoURL ||
				`https://ui-avatars.com/api/?name=${user?.displayName || (isHost ? "H" : "G")}&background=${isHost ? "3B82F6" : "10B981"}&color=fff`,
			isHost,
			isReady: localIsReady,
		});
	}, [
		localIsReady,
		isHost,
		user?.uid,
		user?.displayName,
		user?.avatarUrl,
		user?.photoURL,
		presenceId,
	]);

	// Temporary state for editing settings before saving
	const [editSelectedMaps, setEditSelectedMaps] = useState<MapRegion[]>(
		room.selected_maps || ["world"],
	);
	const [editRounds, setEditRounds] = useState(room.total_rounds);
	const [editTime, setEditTime] = useState(room.round_seconds);
	const [editNoMove, setEditNoMove] = useState(room.no_moving);
	const [editNoPan, setEditNoPan] = useState(room.no_panning);
	const [editNoZoom, setEditNoZoom] = useState(room.no_zooming);

	useEffect(() => {
		if (isEditingSettings) {
			setEditSelectedMaps(localRoom.selected_maps || ["world"]);
			setEditRounds(localRoom.total_rounds);
			setEditTime(localRoom.round_seconds);
			setEditNoMove(localRoom.no_moving);
			setEditNoPan(localRoom.no_panning);
			setEditNoZoom(localRoom.no_zooming);
		}
	}, [isEditingSettings, localRoom]);

	useEffect(() => {
		// Setup Realtime Presence
		const channel = supabase.channel(`room_${room.id}`, {
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

				// Build a map of all players from presence state
				Object.keys(state).forEach(key => {
					const presenceElements = state[key] as any[];
					const presenceData = presenceElements[0];
					if (presenceData.isHost) hostFound = true;

					playerMap.set(presenceData.id, {
						id: presenceData.id,
						name: presenceData.name,
						avatar: presenceData.avatar,
						isReady: !!presenceData.isReady,
						isHost: !!presenceData.isHost,
					});
				});

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

				// If host is not in presence state and we are not the host, the room is disbanded
				if (!hostFound && !isHostRef.current && players.length > 0) {
					toast.error("The host has left the room. Moving back to home.");
					onLeave();
					return;
				}

				if (!hostFound && isHostRef.current) {
					activePlayers.unshift({
						id: userRef.current?.uid || room.player1_id,
						name: `${userRef.current?.displayName || "Host"} (host)`,
						avatar: `https://ui-avatars.com/api/?name=Host&background=3B82F6&color=fff`,
						isHost: true,
						isReady: localIsReadyRef.current,
					});
				}

				setPlayers(activePlayers.slice(0, MAX_PLAYERS));

				// Clear syncing state when presence sync is confirmed
				if (isSyncingReadyRef.current) {
					const currentPlayer = activePlayers.find(
						p => p.id === (userRef.current?.uid || guestPresenceKeyRef.current),
					);
					if (currentPlayer && currentPlayer.isReady === localIsReadyRef.current) {
						setIsSyncingReady(false);
					}
				}
			})
			.on("broadcast", { event: "kick" }, payload => {
				const { kickedUserId } = payload.payload;
				if (presenceId === kickedUserId) {
					toast.error("You were kicked from the room.");
					onLeave();
				}
			})
			.on("broadcast", { event: "room_updated" }, payload => {
				const updatedRoom = payload.payload as MatchRoom;
				setLocalRoom(updatedRoom);
			})
			.on("broadcast", { event: "room_started" }, () => {
				if (!isHostRef.current) {
					onStart();
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
						setLocalRoom(payload.new as MatchRoom);

						// Check if current user has been kicked
						const currentUserId = presenceId;
						const updatedRoom = payload.new as MatchRoom;
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
							onLeave();
							return;
						}
					}
					if (payload.new.status === "active" && !isHostRef.current) {
						onStart();
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
						onLeave();
					}
				},
			)
			.subscribe(async status => {
				if (status === "SUBSCRIBED") {
					const avatar =
						userRef.current?.avatarUrl ||
						userRef.current?.photoURL ||
						`https://ui-avatars.com/api/?name=${userRef.current?.displayName || (isHostRef.current ? "H" : "G")}&background=${isHostRef.current ? "3B82F6" : "10B981"}&color=fff`;
					await channel.track({
						id: presenceId,
						name:
							userRef.current?.displayName ?
								`${userRef.current.displayName}${isHostRef.current ? " (host)" : ""}`
							: isHostRef.current ? "Host (host)"
							: "Guest Player",
						avatar,
						isHost: isHostRef.current,
						isReady: localIsReadyRef.current,
					});
				}
			});

		return () => {
			roomChannelRef.current = null;
			supabase.removeChannel(channel);
		};
	}, [
		room.id,
		presenceId,
		onStart,
		onLeave,
	]);

	const handleLeave = async () => {
		const myId = user?.uid || "guest_host";
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
					// Fallback: try direct delete if RPC fails
					await supabase.from("match_rooms").delete().eq("id", room.id);
				}
			} catch (err) {
				console.error("Error during room closure:", err);
			} finally {
				onLeave();
			}
		} else {
			onLeave();
		}
	};

	const copyCode = () => {
		navigator.clipboard.writeText(room.id.substring(0, 6).toUpperCase());
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="w-full relative animate-in fade-in duration-700 text-[var(--color-app-text)]">
			<div className="w-full flex flex-col gap-8">
				<div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
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
												:	"bg-white/5 text-[var(--color-app-text-muted)] group-hover:text-white",
											)}>
											{copied ?
												<Users className="w-4 h-4" />
											:	<Copy className="w-4 h-4" />}
										</div>
									</div>
								</div>

								<div className="flex flex-col items-center mt-2">
									{!isHost && (
										<button
											onClick={() => {
												setLocalIsReady(!localIsReady);
												setIsSyncingReady(true);
											}}
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
										<div className="w-full h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center gap-2">
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
										<div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
											<Target className="w-4 h-4 text-[var(--color-app-text-muted)]" />
										</div>
										<span className="text-sm font-medium text-[var(--color-app-text)] opacity-80">
											Rounds
										</span>
									</div>
									<span className="font-mono font-bold text-[var(--color-app-blue)]">
										{localRoom.total_rounds}
									</span>
								</div>

								<div className="flex items-center justify-between">
									<div className="flex items-center gap-3">
										<div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
											<Clock className="w-4 h-4 text-[var(--color-app-text-muted)]" />
										</div>
										<span className="text-sm font-medium text-[var(--color-app-text)] opacity-80">
											Round Time
										</span>
									</div>
									<span className="font-mono font-bold text-[var(--color-app-blue)]">
										{localRoom.round_seconds}s
									</span>
								</div>

								<div className="h-px bg-[var(--color-app-border-light)] my-2" />

								<div className="space-y-3">
									<div
										className={cn(
											"flex items-center justify-between text-xs",
											localRoom.no_moving ? "text-red-400" : "text-green-500",
										)}>
										<span className="font-medium text-[var(--color-app-text)] opacity-60">
											No Moving
										</span>
										<span className="font-bold">
											{localRoom.no_moving ? "ON" : "OFF"}
										</span>
									</div>
									<div
										className={cn(
											"flex items-center justify-between text-xs",
											localRoom.no_panning ? "text-red-400" : "text-green-500",
										)}>
										<span className="font-medium text-[var(--color-app-text)] opacity-60">
											No Panning
										</span>
										<span className="font-bold">
											{localRoom.no_panning ? "ON" : "OFF"}
										</span>
									</div>
									<div
										className={cn(
											"flex items-center justify-between text-xs",
											localRoom.no_zooming ? "text-red-400" : "text-green-500",
										)}>
										<span className="font-medium text-[var(--color-app-text)] opacity-60">
											No Zooming
										</span>
										<span className="font-bold">
											{localRoom.no_zooming ? "ON" : "OFF"}
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
									:	"border-[var(--color-app-border-light)] text-white/70 hover:bg-white/5",
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
									className="text-[10px] text-[var(--color-app-text-muted)] hover:text-white transition-colors uppercase font-black tracking-widest text-center">
									Cancel
								</button>
							)}
						</div>
					</div>

					{/* Right Side: Players List */}
					<div className="lg:col-span-9 flex flex-col gap-4 min-h-[500px]">
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
									!localRoom.selected_maps ||
									localRoom.selected_maps.length === 0 ||
									localRoom.selected_maps.includes("world")
								) ?
									<div className="px-4 py-2 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3 whitespace-nowrap shadow-sm">
										<span className="text-2xl">🌎</span>
										<span className="text-sm font-bold text-white/90">
											World
										</span>
									</div>
								:	localRoom.selected_maps.map(mapKey => {
										const map = MAPS[mapKey];
										if (!map) return null;
										return (
											<div
												key={mapKey}
												className="px-4 py-2 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3 whitespace-nowrap shadow-sm hover:bg-white/[0.08] transition-colors">
												<span className="text-2xl">{map.flag}</span>
												<span className="text-sm font-bold text-white/90">
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
									</h3>

									{isHost && (
										<button
											disabled={generatingTargets}
											onClick={async () => {
												if (!canStartMatch) {
													toast.error("Need 2 ready players");
													return;
												}
												if (room.id) {
													setGeneratingTargets(true);
													try {
														const apiKey =
															import.meta.env.VITE_GOOGLE_MAPS_PLATFORM_KEY ??
															"";
														const targets = await generateTargets(
															apiKey,
															localRoom.selected_maps || ["world"],
															localRoom.total_rounds,
														);
														await supabase
															.from("match_rooms")
															.update({
																status: "active",
																targets: targets as any,
															})
															.eq("id", room.id);
														
														// Broadcast started match status
														const channel = roomChannelRef.current;
														if (channel) {
															void channel.send({
																type: "broadcast",
																event: "room_started",
															});
														}
														onStart();
													} catch (e) {
														toast.error("Failed to generate locations.");
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
									)}
								</div>

								<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1 content-start overflow-y-auto no-scrollbar pr-1">
									{players.map(p => (
										<div
											key={p.id}
											className={cn(
												"flex items-center justify-between bg-[var(--color-app-bg)]/60 border border-[var(--color-app-border-light)] p-4 rounded-2xl transition-all group",
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
														className="w-12 h-12 rounded-xl object-cover border border-white/10"
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
													<div className="font-bold text-white text-base flex items-center gap-2">
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
													onClick={async () => {
														try {
															const success = await kickParticipantFromRoom(
																room.id,
																p.id,
																user?.uid || "guest_host",
															);
															if (success) {
																toast.success(`Kicked ${p.name}`);
																// Broadcast the kick event to all clients
																const channel = roomChannelRef.current;
																if (channel) {
																	void channel.send({
																		type: "broadcast",
																		event: "kick",
																		payload: { kickedUserId: p.id },
																	});
																}
															} else {
																toast.error("Failed to kick participant");
															}
														} catch (err) {
															console.error("Kick error:", err);
															toast.error("Failed to kick participant");
														}
													}}
													className="opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-red-500/20 rounded-lg text-red-400 shrink-0"
													title="Kick this player">
													<Trash2 className="w-4 h-4" />
												</button>
											)}
										</div>
									))}
								</div>
							</div>

							<div className="xl:col-span-5 bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-3xl shadow-xl flex flex-col min-h-[420px]">
								<div className="px-6 sm:px-8 py-4 sm:py-5 border-b border-[var(--color-app-border-light)]">
									<h3 className="text-xs font-black uppercase tracking-widest text-[var(--color-app-text-muted)] flex items-center gap-2">
										<Clock className="w-4 h-4 text-[var(--color-app-blue)]" />{" "}
										Room Chat
									</h3>
								</div>
								<div className="flex-1 min-h-0 overflow-hidden">
									<RoomChat room={localRoom} isHost={isHost} />
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
										:	"border-[var(--color-app-border-light)] text-[var(--color-app-text)] opacity-70 hover:bg-white/5",
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
										className="text-[10px] text-[var(--color-app-text-muted)] hover:text-white transition-colors uppercase font-black tracking-widest text-center">
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
								<div>
									<label className="text-xs font-bold text-[var(--color-app-text-muted)] uppercase tracking-widest mb-2 block">
										Rounds
									</label>
									<input
										type="number"
										min="5"
										max="30"
										value={editRounds}
										onChange={e =>
											setEditRounds(
												Math.max(
													5,
													Math.min(30, parseInt(e.target.value) || 0),
												),
											)
										}
										className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[var(--color-app-text)] focus:outline-none focus:border-[var(--color-app-blue)]"
									/>
									<div className="text-[10px] text-[var(--color-app-text-muted)] mt-1">
										Min 5, Max 30
									</div>
								</div>
								<div>
									<label className="text-xs font-bold text-[var(--color-app-text-muted)] uppercase tracking-widest mb-2 block">
										Round Time (s)
									</label>
									<input
										type="number"
										step="5"
										min="20"
										max="90"
										value={editTime}
										onChange={e =>
											setEditTime(
												Math.max(
													20,
													Math.min(90, parseInt(e.target.value) || 0),
												),
											)
										}
										className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[var(--color-app-text)] focus:outline-none focus:border-[var(--color-app-blue)]"
									/>
									<div className="text-[10px] text-[var(--color-app-text-muted)] mt-1">
										Min 20, Max 90 (Step 5s)
									</div>
								</div>
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
								</div>
							</div>
							<div className="flex flex-col gap-3 mt-8">
								<button
									onClick={async () => {
										try {
											const rounds = Math.max(5, Math.min(30, editRounds));
											const time = Math.max(20, Math.min(90, editTime));
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
												})
												.eq("id", room.id);

											if (error) throw error;

											// Update localRoom state immediately for better sync
											const updatedRoom = {
												...localRoom,
												total_rounds: rounds,
												round_seconds: time,
												no_moving: editNoMove,
												no_panning: editNoPan,
												no_zooming: editNoZoom,
												selected_maps: mapsToSave as MapRegion[],
											};
											setLocalRoom(updatedRoom);

											// Broadcast the updated settings to all clients
											const channel = roomChannelRef.current;
											if (channel) {
												void channel.send({
													type: "broadcast",
													event: "room_updated",
													payload: updatedRoom,
												});
											}

											if (onUpdateSettings) {
												onUpdateSettings({
													rounds,
													seconds: time,
													noMoving: editNoMove,
													noPanning: editNoPan,
													noZooming: editNoZoom,
													maps: mapsToSave as MapRegion[],
												});
											}

											if (onUpdateMaps) {
												// Removed redundant call as maps are now in onUpdateSettings
											}

											setIsEditingSettings(false);
											toast.success("Rules updated!");
										} catch (e) {
											console.error("Update error:", e);
											toast.error("Failed to update rules");
										}
									}}
									className="w-full py-3.5 rounded-xl bg-[var(--color-app-blue)] text-[var(--color-app-text)] font-bold hover:bg-blue-500 transition shadow-lg shadow-blue-500/20">
									Save Changes
								</button>
								<button
									onClick={() => setIsEditingSettings(false)}
									className="w-full py-3.5 rounded-xl border border-white/10 text-[var(--color-app-text)] opacity-70 font-bold hover:bg-white/5 transition">
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
									className={`relative h-24 overflow-hidden rounded-xl border-2 transition-all flex flex-col items-center justify-center ${editSelectedMaps.includes("world") ? "border-[var(--color-app-blue)] shadow-[0_0_15px_rgba(59,130,246,0.2)]" : "border-white/10 hover:border-white/30"}`}>
									<div className="absolute inset-0 bg-slate-900" />
									{editSelectedMaps.includes("world") && (
										<div className="absolute inset-0 bg-[var(--color-app-blue)]/10 z-10" />
									)}
									<div className="relative z-20 flex flex-col items-center">
										<span className="text-3xl mb-1">🌎</span>
										<span
											className={`text-xs font-bold ${editSelectedMaps.includes("world") ? "text-blue-300" : "text-[var(--color-app-text)]"}`}>
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
												className={`relative h-24 overflow-hidden rounded-xl border-2 transition-all flex flex-col items-center justify-center ${active ? "border-[var(--color-app-blue)] shadow-[0_0_15px_rgba(59,130,246,0.2)]" : "border-white/10 hover:border-white/30"} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}>
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
														className={`text-xs font-bold drop-shadow-md ${active ? "text-blue-300" : "text-[var(--color-app-text)]"}`}>
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
		</div>
	);
}
