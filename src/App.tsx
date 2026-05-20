/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, useCallback } from "react";
import GameModes from "./components/GameModes";
import GlobeView from "./components/GlobeView";
import Header from "./components/Header";
import Hero from "./components/Hero";
import Leaderboard from "./components/Leaderboard";
import Match from "./components/Match";
import MatchSetup from "./components/MatchSetup";
import MatchmakingLobby from "./components/MatchmakingLobby";
import RoomLobby from "./components/RoomLobby";
import Profile from "./components/Profile";
import MatchHistory from "./components/MatchHistory";
import AdminPanel from "./components/AdminPanel";
import { testSupabaseConnection } from "./lib/supabase";
import { loadMapRegions } from "./lib/MapRegions";
import { useAuth } from "./lib/AuthContext";
import { Loader2 } from "lucide-react";
import { initializeHealthMonitor } from "./lib/ConnectionHealthMonitor";
import { loadGameModes, type GameModeId, MODE_CONFIGS } from "./lib/MatchGame";
import type { MapRegion } from "./lib/MapRegions";
import {
	createRoom,
	generateTargets,
	deleteRoom,
	cleanupUserRooms,
	fetchRoom,
	type MatchRoom,
} from "./lib/Matchmaking";
import { supabase } from "./lib/supabase";
import {
	clearMatchSession,
	loadMatchSession,
	saveMatchSession,
} from "./lib/matchSessionPersistence";

type AppTab =
	| "Home"
	| "Leaderboards"
	| "Setup"
	| "Matchmaking"
	| "Match"
	| "RoomLobby"
	| "Profile"
	| "Admin"
	| "History";

export default function App() {
	const { user } = useAuth();
	const [activeTab, setActiveTab] = useState<AppTab>("Home");
	const [selectedMode, setSelectedMode] = useState<GameModeId>("classic");
	const hasRestoredMatchSessionRef = useRef(false);

	const [selectedMaps, setSelectedMaps] = useState<MapRegion[]>(["world"]);
	const [customRounds, setCustomRounds] = useState(10);
	const [customSeconds, setCustomSeconds] = useState(45);
	const [noMoving, setNoMoving] = useState(false);
	const [noPanning, setNoPanning] = useState(false);
	const [noZooming, setNoZooming] = useState(false);

	const [creatorRoom, setCreatorRoom] = useState<MatchRoom | null>(null);

	const [warningMessage, setWarningMessage] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
	const [loadingError, setLoadingError] = useState<string | null>(null);
	const [connectionStatus, setConnectionStatus] = useState<boolean>(true);

	// Initialize connection health monitor on app start
	useEffect(() => {
		const healthMonitor = initializeHealthMonitor(connected => {
			setConnectionStatus(connected);
			if (!connected) {
				console.warn("Connection lost. Attempting to reconnect...");
			}
		});

		return () => {
			healthMonitor?.stop();
		};
	}, []);

	// ── Global Auth Guard ──
	useEffect(() => {
		const protectedTabs: AppTab[] = [
			"Setup",
			"Matchmaking",
			"Match",
			"RoomLobby",
			"Profile",
			"Admin",
			"History",
			"Leaderboards",
		];
		if (!user && !isLoading && protectedTabs.includes(activeTab)) {
			setActiveTab("Home");
		}
	}, [user, activeTab, isLoading]);

	useEffect(() => {
		if (isLoading || hasRestoredMatchSessionRef.current || !user?.uid) return;

		const savedSession = loadMatchSession();
		if (!savedSession) return;

		if (savedSession.userId !== user.uid) {
			clearMatchSession();
			return;
		}

		hasRestoredMatchSessionRef.current = true;

		const restore = async () => {
			const room = await fetchRoom(savedSession.roomId);
			if (!room || room.status === "completed") {
				clearMatchSession();
				return;
			}

			if (savedSession.mode === "creatorRoom") {
				setSelectedMode("creatorRoom");
				setCreatorRoom(room);
				setActiveTab(room.status === "active" ? "Match" : "RoomLobby");
				return;
			}

			setSelectedMode("headToHead");
			setH2hRoom(room);
			setH2hOpponentId(savedSession.opponentId ?? room.player2_id ?? null);
			setH2hOpponentElo(savedSession.opponentElo ?? 1300);
			setH2hIsHost(savedSession.isHost);
			setActiveTab("Match");
		};

		void restore();
	}, [isLoading, user?.uid]);

	// ── Mode change logic ──
	const handleModeSelect = useCallback((mode: GameModeId) => {
		setSelectedMode(mode);
		if (mode === "headToHead") {
			setSelectedMaps(["world"]);
			setWarningMessage("Head-to-head mode is locked to the World map.");
		} else if (mode === "creatorRoom") {
			const saved = localStorage.getItem("geozora_creator_settings");
			if (saved) {
				try {
					const parsed = JSON.parse(saved);
					setCustomRounds(parsed.customRounds);
					setCustomSeconds(parsed.customSeconds);
					setNoMoving(parsed.noMoving);
					setNoPanning(parsed.noPanning);
					setNoZooming(parsed.noZooming);
				} catch (e) {}
			} else {
				setCustomRounds(MODE_CONFIGS[mode]?.rounds || 8);
				setCustomSeconds(MODE_CONFIGS[mode]?.seconds || 75);
			}
		}
		setActiveTab("Setup");
	}, []);

	// ── H2H matchmaking state ──
	const [h2hRoom, setH2hRoom] = useState<MatchRoom | null>(null);
	const [h2hOpponentId, setH2hOpponentId] = useState<string | null>(null);
	const [h2hOpponentElo, setH2hOpponentElo] = useState(1300);
	const [h2hIsHost, setH2hIsHost] = useState(false);

	// ── Clear H2H state helper ──
	const clearH2hState = useCallback(() => {
		setH2hRoom(null);
		setH2hOpponentId(null);
		setH2hOpponentElo(1300);
		setH2hIsHost(false);
	}, []);

	// ── Setup → Start handler (routes H2H to matchmaking) ──
	const handleStartFromSetup = useCallback(async () => {
		if (selectedMode === "headToHead") {
			clearH2hState();
			setActiveTab("Matchmaking");
		} else if (selectedMode === "creatorRoom") {
			// Create a private room
			setIsLoading(true);
			setLoadingMessage("Setting up room on server...");
			try {
				// Cleanup existing waiting rooms by this user via secure RPC
				const myId = user?.uid || "guest_host";
				await cleanupUserRooms(myId);

				const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();

				const room = await createRoom(
					roomId,
					user?.uid || "guest_host",
					null, // No guest yet
					[], // Targets will be generated on Start
					customRounds,
					customSeconds,
					noMoving,
					noPanning,
					noZooming,
					selectedMaps,
					"waiting", // Setting status to waiting
				);

				if (room) {
					setCreatorRoom(room);
					setActiveTab("RoomLobby");
				} else {
					setWarningMessage(
						"Failed to create room on server. Check your connection.",
					);
				}
			} catch (err) {
				console.error("Room creation error:", err);
				setWarningMessage(
					"Failed to create room. " + (err instanceof Error ? err.message : ""),
				);
			} finally {
				setIsLoading(false);
				setLoadingMessage(null);
			}
		} else {
			clearH2hState();
			setActiveTab("Match");
		}
	}, [
		selectedMode,
		clearH2hState,
		selectedMaps,
		customRounds,
		customSeconds,
		noMoving,
		noPanning,
		noZooming,
	]);

	// ── Matchmaking found a match → enter Match ──
	const handleMatchReady = useCallback(
		(
			room: MatchRoom,
			opponentId: string,
			opponentElo: number,
			isHost: boolean,
		) => {
			setH2hRoom(room);
			setH2hOpponentId(opponentId);
			setH2hOpponentElo(opponentElo);
			setH2hIsHost(isHost);
			setActiveTab("Match");
		},
		[],
	);

	// ── Cancel matchmaking → back to Setup ──
	const handleMatchmakingCancel = useCallback(() => {
		clearH2hState();
		setActiveTab("Setup");
	}, [clearH2hState]);

	// ── Back to dashboard from Match ──
	const handleBackToDashboard = useCallback(() => {
		clearH2hState();
		clearMatchSession();
		setActiveTab("Home");
	}, [clearH2hState]);

	// ── Mode change from within Match (sidebar) ──
	const handleModeChangeFromMatch = useCallback(
		(mode: GameModeId) => {
			clearH2hState();
			clearMatchSession();
			setSelectedMode(mode);
			setActiveTab("Setup");
		},
		[clearH2hState],
	);

	// ── Auto-clear warning messages ──
	useEffect(() => {
		if (warningMessage) {
			const timer = setTimeout(() => {
				setWarningMessage(null);
			}, 5000);
			return () => clearTimeout(timer);
		}
	}, [warningMessage]);

	// ── Cleanup logic for Creator Rooms ──
	useEffect(() => {
		// If we have an active creator room but we aren't in lobby or match anymore, cleanup
		if (creatorRoom && activeTab !== "RoomLobby" && activeTab !== "Match") {
			const myId = user?.uid || "guest_host";
			const isHost = creatorRoom.player1_id === myId;
			if (isHost && creatorRoom.status === "waiting") {
				void deleteRoom(creatorRoom.id, myId);
			}
			clearMatchSession();
			setCreatorRoom(null);
		}
	}, [activeTab, creatorRoom, user]);

	useEffect(() => {
		const initializeApp = async () => {
			try {
				await Promise.all([
					testSupabaseConnection(),
					loadMapRegions(),
					loadGameModes(),
				]);

				// Initialize creator room defaults if no saved settings exist
				const saved = localStorage.getItem("geozora_creator_settings");
				if (!saved && MODE_CONFIGS["creatorRoom"]) {
					setCustomRounds(MODE_CONFIGS["creatorRoom"].rounds);
					setCustomSeconds(MODE_CONFIGS["creatorRoom"].seconds);
				} else if (saved) {
					try {
						const parsed = JSON.parse(saved);
						setCustomRounds(parsed.customRounds);
						setCustomSeconds(parsed.customSeconds);
						setNoMoving(parsed.noMoving);
						setNoPanning(parsed.noPanning);
						setNoZooming(parsed.noZooming);
					} catch (e) {}
				}
			} catch (err: any) {
				console.error("Initialization error:", err);
				setLoadingError(
					err?.message ||
						(err instanceof Error ?
							err.message
						:	"Failed to initialize application."),
				);
			} finally {
				setIsLoading(false);
			}
		};

		initializeApp();
	}, []);

	// Save creator room settings to local storage when modified
	useEffect(() => {
		if (!isLoading && selectedMode === "creatorRoom") {
			localStorage.setItem(
				"geozora_creator_settings",
				JSON.stringify({
					customRounds,
					customSeconds,
					noMoving,
					noPanning,
					noZooming,
				}),
			);
		}
	}, [
		customRounds,
		customSeconds,
		noMoving,
		noPanning,
		noZooming,
		isLoading,
		selectedMode,
	]);

	useEffect(() => {
		if (!user?.uid) return;

		if (activeTab === "RoomLobby" && creatorRoom) {
			saveMatchSession({
				userId: user.uid,
				roomId: creatorRoom.id,
				mode: "creatorRoom",
				tab: creatorRoom.status === "active" ? "Match" : "RoomLobby",
				isHost: creatorRoom.player1_id === user.uid,
			});
			return;
		}

		if (activeTab === "Match" && h2hRoom && selectedMode === "headToHead") {
			saveMatchSession({
				userId: user.uid,
				roomId: h2hRoom.id,
				mode: "headToHead",
				tab: "Match",
				isHost: h2hIsHost,
				opponentId: h2hOpponentId,
				opponentElo: h2hOpponentElo,
			});
			return;
		}

		if (activeTab === "Match") return;
		clearMatchSession();
	}, [
		activeTab,
		creatorRoom,
		h2hIsHost,
		h2hOpponentElo,
		h2hOpponentId,
		h2hRoom,
		selectedMode,
		user?.uid,
	]);

	if (isLoading) {
		return (
			<div className="h-screen w-screen bg-[var(--color-app-bg)] text-[var(--color-app-text)] flex items-center justify-center font-sans relative overflow-hidden">
				<div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-[var(--color-app-blue)]/20 blur-[120px] rounded-full pointer-events-none" />
				<div className="absolute top-[20%] right-[-10%] w-[40%] h-[40%] bg-[var(--color-app-purple)]/10 blur-[120px] rounded-full pointer-events-none" />

				<div className="flex flex-col items-center gap-6 z-10">
					<Loader2 className="w-12 h-12 text-[var(--color-app-blue)] animate-spin" />
					<div className="flex flex-col items-center gap-2">
						<h2 className="text-xl font-medium tracking-tight">
							{loadingMessage || "Initializing GeoZora..."}
						</h2>
						<p className="text-[var(--color-app-text-muted)] text-sm">
							{loadingMessage ?
								"This may take a moment."
							:	"Connecting to server and loading map data..."}
						</p>
					</div>
				</div>
			</div>
		);
	}

	if (loadingError) {
		return (
			<div className="h-screen w-screen bg-[var(--color-app-bg)] text-[var(--color-app-text)] flex items-center justify-center font-sans relative overflow-hidden">
				<div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-red-500/20 blur-[120px] rounded-full pointer-events-none" />

				<div className="flex flex-col items-center gap-4 text-center max-w-md px-6 z-10">
					<div className="w-16 h-16 bg-red-500/10 text-red-400 rounded-full flex items-center justify-center mb-2">
						<span className="text-2xl">⚠️</span>
					</div>
					<h2 className="text-2xl font-bold tracking-tight text-[var(--color-app-text)]">
						Connection Failed
					</h2>
					<p className="text-[var(--color-app-text-muted)]">{loadingError}</p>
				</div>
			</div>
		);
	}

	return (
		<div className="h-screen w-screen bg-[var(--color-app-bg)] text-[var(--color-app-text)] overflow-hidden flex flex-col font-sans relative">
			<div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600/20 blur-[120px] rounded-full pointer-events-none" />
			<div className="absolute top-[20%] right-[-10%] w-[40%] h-[40%] bg-indigo-600/10 blur-[120px] rounded-full pointer-events-none" />

			{/* Hide header during matchmaking and match for full-screen experience */}
			{activeTab !== "Matchmaking" && activeTab !== "Match" && (
				<Header
					activeTab={activeTab}
					setActiveTab={setActiveTab}
					onJoinRoom={room => {
						setCreatorRoom(room);
						setActiveTab("RoomLobby");
					}}
				/>
			)}

			{warningMessage && (
				<div className="fixed top-24 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-6 py-3 rounded-lg shadow-xl border border-red-400 z-[100] flex items-center gap-3 backdrop-blur-sm animate-in fade-in zoom-in duration-200">
					<span className="font-bold flex-shrink-0">⚠️ Warning</span>
					<span>{warningMessage}</span>
				</div>
			)}

			<div className="flex-1 w-full relative flex items-center justify-center">
				{activeTab === "Home" && (
					<>
						<GlobeView />

						<div className="absolute inset-0 flex justify-between px-6 lg:px-10 xl:px-16 pt-8 pb-6 pointer-events-none w-full h-full">
							<div className="h-full pointer-events-auto flex items-end w-full lg:w-[45%] xl:w-[40%] max-w-xl relative z-10">
								<Hero
									onPlayClick={() => setActiveTab("Setup")}
									onQuickMatchClick={() => {
										clearH2hState();
										setSelectedMode("classic");
										setSelectedMaps(["world"]);
										setActiveTab("Match");
									}}
								/>
							</div>

							<div className="hidden lg:flex h-full pointer-events-auto items-start w-full lg:w-[35%] xl:w-[25%] max-w-[340px] relative z-10">
								<GameModes
									selectedMode={selectedMode}
									onModeSelect={handleModeSelect}
									onQuickMatchClick={() => {
										clearH2hState();
										setSelectedMode("classic");
										setActiveTab("Match");
									}}
								/>
							</div>
						</div>
					</>
				)}

				{activeTab === "Setup" && (
					<div className="absolute inset-0 pt-8 pb-6 px-6 lg:px-10 xl:px-16 pointer-events-auto overflow-y-auto w-full h-full">
						<MatchSetup
							selectedMode={selectedMode}
							setSelectedMode={handleModeSelect}
							selectedMaps={selectedMaps}
							setSelectedMaps={setSelectedMaps}
							customRounds={customRounds}
							setCustomRounds={setCustomRounds}
							customSeconds={customSeconds}
							setCustomSeconds={setCustomSeconds}
							noMoving={noMoving}
							setNoMoving={setNoMoving}
							noPanning={noPanning}
							setNoPanning={setNoPanning}
							noZooming={noZooming}
							setNoZooming={setNoZooming}
							onStart={handleStartFromSetup}
						/>
					</div>
				)}

				{activeTab === "Leaderboards" && (
					<div className="absolute inset-0 pt-8 pb-6 px-6 lg:px-10 xl:px-16 pointer-events-auto overflow-y-auto w-full h-full">
						<Leaderboard />
					</div>
				)}

				{activeTab === "Matchmaking" && (
					<div className="absolute inset-0 w-full h-full pointer-events-auto">
						<MatchmakingLobby
							selectedMaps={selectedMaps}
							onMatchReady={handleMatchReady}
							onCancel={handleMatchmakingCancel}
						/>
					</div>
				)}

				{activeTab === "RoomLobby" && creatorRoom && (
					<div className="absolute inset-0 pt-8 pb-6 px-6 lg:px-10 xl:px-16 pointer-events-auto overflow-y-auto w-full h-full flex flex-col items-center">
						<div className="w-full h-full flex flex-col items-center">
							<RoomLobby
								room={creatorRoom}
								isHost={
									creatorRoom.player1_id === user?.uid ||
									(!user && creatorRoom.player1_id === "guest_host")
								}
								selectedMaps={selectedMaps}
								onUpdateSettings={s => {
									setCustomRounds(s.rounds);
									setCustomSeconds(s.seconds);
									setNoMoving(s.noMoving);
									setNoPanning(s.noPanning);
									setNoZooming(s.noZooming);
									setSelectedMaps(s.maps);
									if (creatorRoom) {
										setCreatorRoom({
											...creatorRoom,
											total_rounds: s.rounds,
											round_seconds: s.seconds,
											no_moving: s.noMoving,
											no_panning: s.noPanning,
											no_zooming: s.noZooming,
											selected_maps: s.maps,
										});
									}
								}}
								onStart={() => setActiveTab("Match")}
								onLeave={() => {
									if (creatorRoom.status === "waiting") {
										const myId = user?.uid || "guest_host";
										void deleteRoom(creatorRoom.id, myId);
									}
									setCreatorRoom(null);
									setActiveTab("Setup");
								}}
							/>
						</div>
					</div>
				)}

				{activeTab === "Match" && (
					<div className="absolute inset-0 w-full h-full pointer-events-auto">
						<Match
							selectedMode={selectedMode}
							selectedMaps={selectedMaps}
							customRounds={customRounds}
							customSeconds={customSeconds}
							onModeChange={handleModeChangeFromMatch}
							onBackToDashboard={handleBackToDashboard}
							onRoomReset={() => setActiveTab("RoomLobby")}
							onFindNewH2HMatch={() => {
								setH2hRoom(null);
								setH2hOpponentId(null);
								setActiveTab("Matchmaking");
							}}
							h2hRoom={h2hRoom || creatorRoom}
							h2hOpponentId={h2hOpponentId}
							h2hOpponentElo={h2hOpponentElo}
							h2hIsHost={
								h2hIsHost ||
								(creatorRoom ?
									creatorRoom.player1_id === user?.uid ||
									(!user && creatorRoom.player1_id === "guest_host")
								:	false)
							}
						/>
					</div>
				)}

				{activeTab === "Profile" && (
					<div className="absolute inset-0 pt-8 pb-6 px-6 lg:px-10 xl:px-16 pointer-events-auto overflow-y-auto w-full h-full">
						<Profile />
					</div>
				)}

				{activeTab === "Admin" && (
					<div className="absolute inset-0 pt-8 pb-6 px-6 lg:px-10 xl:px-16 pointer-events-auto overflow-y-auto w-full h-full">
						<AdminPanel />
					</div>
				)}

				{activeTab === "History" && (
					<div className="absolute inset-0 pt-8 pb-6 px-6 lg:px-10 xl:px-16 pointer-events-auto overflow-y-auto w-full h-full">
						<MatchHistory />
					</div>
				)}
			</div>
		</div>
	);
}
