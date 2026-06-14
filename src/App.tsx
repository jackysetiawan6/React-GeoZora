/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
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
import { testSupabaseConnection, logSystemError } from "./lib/supabase";
import { loadMapRegions } from "./lib/MapRegions";
import { useAuth } from "./lib/AuthContext";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
	leaveRoom,
} from "./lib/Matchmaking";
import { supabase } from "./lib/supabase";
import {
	clearMatchSession,
	loadMatchSession,
	saveMatchSession,
	type MatchSessionMode,
} from "./lib/matchSessionPersistence";
import { initAntiCheat } from "./lib/antiCheat";
import { DynamicBackground } from "./components/ui";
import { audioManager } from "./lib/audioManager";

import type { AppTab } from "./lib/types";

export default function App() {
	const { user } = useAuth();
	const [activeTab, setActiveTab] = useState<AppTab>("Home");

	const [appealMessage, setAppealMessage] = useState("");
	const [appealStatus, setAppealStatus] = useState<"idle" | "loading" | "submitted" | "error">("idle");

	useEffect(() => {
		if (user?.isBanned) {
			setAppealStatus("loading");
			supabase
				.from("feedbacks")
				.select("id")
				.eq("user_id", user.uid)
				.eq("type", "appeal")
				.eq("status", "open")
				.maybeSingle()
				.then(({ data, error }) => {
					if (error) {
						console.error("Error checking appeals:", error);
						setAppealStatus("idle");
					} else if (data) {
						setAppealStatus("submitted");
					} else {
						setAppealStatus("idle");
					}
				});
		}
	}, [user?.uid, user?.isBanned]);

	const handleSendAppeal = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!appealMessage.trim() || !user) return;

		setAppealStatus("loading");
		try {
			const { error } = await supabase.from("feedbacks").insert({
				user_id: user.uid,
				player_name: user.displayName || "Banned Player",
				type: "appeal",
				message: appealMessage.trim(),
				details: {
					ban_reason: user.banReason,
				},
			});

			if (error) throw error;
			setAppealStatus("submitted");
			toast.success("Appeal submitted successfully. Our team will review it.");
		} catch (err) {
			console.error("Error submitting appeal:", err);
			setAppealStatus("error");
			toast.error("Failed to submit appeal. Please try again.");
		}
	};

	const [selectedMode, setSelectedMode] = useState<GameModeId>("classic");
	const [botLevel, setBotLevel] = useState<number>(3);
	const hasRestoredMatchSessionRef = useRef(false);

	// Determine if we have a saved session to restore on initial mount
	const savedSnapshot = loadMatchSession();
	const hasSavedSnapshot = !!(savedSnapshot && user && savedSnapshot.userId === user.uid);
	const [isRestoringSession, setIsRestoringSession] = useState(hasSavedSnapshot);
	const [isBlockedByAntiCheat, setIsBlockedByAntiCheat] = useState(false);

	const [selectedMaps, setSelectedMaps] = useState<MapRegion[]>(["world"]);
	const [customRounds, setCustomRounds] = useState<number | "">(10);
	const [customSeconds, setCustomSeconds] = useState<number | "">(45);
	const [noMoving, setNoMoving] = useState(false);
	const [noPanning, setNoPanning] = useState(false);
	const [noZooming, setNoZooming] = useState(false);
	const [enableTimeMultiplier, setEnableTimeMultiplier] = useState(false);

	const [creatorRoom, setCreatorRoom] = useState<MatchRoom | null>(null);

	const [warningMessage, setWarningMessage] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	// Separate from isLoading (app init) — tracks room creation in progress
	const [isCreatingRoom, setIsCreatingRoom] = useState(false);
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

	// Initialize DevTools anti-cheat monitor on app start
	useEffect(() => {
		const cleanup = initAntiCheat(detected => {
			setIsBlockedByAntiCheat(detected);
		});
		return () => {
			cleanup();
		};
	}, []);

	// Start BGM on user interaction (satisfies browser autoplay policies)
	useEffect(() => {
		const handleInteraction = () => {
			void audioManager.resume().then(() => {
				audioManager.startMusic();
			});
			// Clean up listener after first interaction
			window.removeEventListener("click", handleInteraction);
			window.removeEventListener("touchstart", handleInteraction);
		};

		window.addEventListener("click", handleInteraction);
		window.addEventListener("touchstart", handleInteraction);

		return () => {
			window.removeEventListener("click", handleInteraction);
			window.removeEventListener("touchstart", handleInteraction);
			audioManager.stopMusic();
		};
	}, []);

	// Global Click and Hover sound effects event delegation
	useEffect(() => {
		const isInteractiveElement = (el: HTMLElement | null): HTMLElement | null => {
			if (!el) return null;
			let current: HTMLElement | null = el;
			while (current && current !== document.body) {
				const tag = current.tagName.toLowerCase();
				const role = current.getAttribute("role");
				const type = current.getAttribute("type");
				const className = current.className && typeof current.className === "string" ? current.className : "";
				const isClickableClass = className.includes("cursor-pointer");

				if (
					tag === "button" ||
					tag === "a" ||
					tag === "input" ||
					tag === "select" ||
					role === "button" ||
					role === "tab" ||
					role === "menuitem" ||
					isClickableClass ||
					current.hasAttribute("onClick") ||
					type === "button" ||
					type === "submit" ||
					type === "checkbox" ||
					type === "radio"
				) {
					return current;
				}
				current = current.parentElement;
			}
			return null;
		};

		const handleGlobalClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			const interactiveEl = isInteractiveElement(target);
			if (interactiveEl) {
				// Don't play click sound on range input (volume sliders)
				if (interactiveEl.tagName.toLowerCase() === "input" && interactiveEl.getAttribute("type") === "range") {
					return;
				}
				audioManager.playSfx("click");
			}
		};

		let lastHovered: HTMLElement | null = null;
		const handleGlobalMouseOver = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			const interactiveEl = isInteractiveElement(target);
			
			if (interactiveEl) {
				if (lastHovered !== interactiveEl) {
					lastHovered = interactiveEl;
					audioManager.playSfx("hover");
				}
			} else {
				lastHovered = null;
			}
		};

		window.addEventListener("click", handleGlobalClick, true);
		window.addEventListener("mouseover", handleGlobalMouseOver, true);

		return () => {
			window.removeEventListener("click", handleGlobalClick, true);
			window.removeEventListener("mouseover", handleGlobalMouseOver, true);
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
		];
		if (!user && !isLoading && protectedTabs.includes(activeTab)) {
			setActiveTab("Home");
		}
	}, [user, activeTab, isLoading]);

	useEffect(() => {
		if (isLoading || hasRestoredMatchSessionRef.current || !user?.uid) {
			if (!isLoading) {
				setIsRestoringSession(false);
			}
			return;
		}

		const savedSession = loadMatchSession();
		if (!savedSession) {
			setIsRestoringSession(false);
			return;
		}

		if (savedSession.userId !== user.uid) {
			clearMatchSession();
			setIsRestoringSession(false);
			return;
		}

		hasRestoredMatchSessionRef.current = true;

		const restore = async () => {
			try {
				const { data, error } = await supabase
					.from("match_rooms")
					.select("*")
					.eq("id", savedSession.roomId);

				if (error) {
					console.error("Failed to fetch room during restore:", error);
					void logSystemError("Session restore fetchRoom failure", {
						roomId: savedSession.roomId,
						error: error.message,
						code: error.code,
					});
					setIsRestoringSession(false);
					return;
				}

				if (!data || data.length === 0) {
					console.warn("Room not found during restore. Clearing session.");
					clearMatchSession();
					setIsRestoringSession(false);
					return;
				}

				const rawRoom = data[0];
				const room = {
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
						: 	rawRoom.participants || [],
					selected_maps:
						typeof rawRoom.selected_maps === "string" ?
							JSON.parse(rawRoom.selected_maps)
						: 	rawRoom.selected_maps || ["world"],
					scores:
						typeof rawRoom.scores === "string" ?
							JSON.parse(rawRoom.scores)
						: 	rawRoom.scores || {},
				} as MatchRoom;

				if (room.status === "completed") {
					clearMatchSession();
					setIsRestoringSession(false);
					return;
				}

				if (savedSession.mode === "creatorRoom") {
					const shouldResumeMatch =
						savedSession.tab === "Match" || room.status === "active";
					setSelectedMode("creatorRoom");
					setCreatorRoom(room);
					setActiveTab(shouldResumeMatch ? "Match" : "RoomLobby");
					setIsRestoringSession(false);
					return;
				}

				if (savedSession.mode === "classic") {
					setSelectedMode("classic");
					setH2hRoom(room);
					setActiveTab("Match");
					setIsRestoringSession(false);
					return;
				}

				setSelectedMode("headToHead");
				setH2hRoom(room);
				setH2hOpponentId(savedSession.opponentId ?? room.player2_id ?? null);
				setH2hOpponentElo(savedSession.opponentElo ?? 1300);
				setH2hIsHost(savedSession.isHost);
				setActiveTab("Match");
			} catch (err) {
				console.error("Error restoring session:", err);
				void logSystemError("Session restore exception", {
					roomId: savedSession.roomId,
					error: err instanceof Error ? err.message : String(err),
				});
			} finally {
				setIsRestoringSession(false);
			}
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
					// Validate parsed values before applying
					if (typeof parsed.customRounds === "number") setCustomRounds(Math.max(5, Math.min(30, parsed.customRounds)));
					if (typeof parsed.customSeconds === "number") setCustomSeconds(Math.max(20, Math.min(90, Math.round(parsed.customSeconds / 5) * 5)));
					if (typeof parsed.noMoving === "boolean") setNoMoving(parsed.noMoving);
					if (typeof parsed.noPanning === "boolean") setNoPanning(parsed.noPanning);
					if (typeof parsed.noZooming === "boolean") setNoZooming(parsed.noZooming);
					if (typeof parsed.enableTimeMultiplier === "boolean") setEnableTimeMultiplier(parsed.enableTimeMultiplier);
				} catch (e) {
					console.warn("Failed to parse saved creator settings — using defaults.", e);
					localStorage.removeItem("geozora_creator_settings");
				}
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
			if (!user) return;
			setIsCreatingRoom(true);
			setLoadingMessage("Setting up room on server...");
			try {
				// Cleanup existing waiting rooms by this user via secure RPC
				const myId = user.uid;
				await cleanupUserRooms(myId);

				// Use cryptographically random room ID instead of Math.random
				const bytes = new Uint8Array(4);
				crypto.getRandomValues(bytes);
				const roomId = Array.from(bytes, b => b.toString(36)).join("").toUpperCase().substring(0, 6);

				const room = await createRoom(
					roomId,
					user.uid,
					null, // No guest yet
					[], // Targets will be generated on Start
					customRounds === "" ? 10 : customRounds,
					customSeconds === "" ? 45 : customSeconds,
					noMoving,
					noPanning,
					noZooming,
					selectedMaps,
					"waiting", // Setting status to waiting
					"creatorRoom",
					enableTimeMultiplier,
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
				setIsCreatingRoom(false);
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

	// ── Creator Room Lobby Callbacks ──
	const handleCreatorRoomStart = useCallback(() => {
		setActiveTab("Match");
	}, []);

	const handleCreatorRoomLeave = useCallback(() => {
		if (creatorRoom && creatorRoom.status === "waiting" && user) {
			const isHost = creatorRoom.player1_id === user.uid;
			if (isHost) {
				void deleteRoom(creatorRoom.id, user.uid);
			} else {
				void leaveRoom(creatorRoom.id, user.uid);
			}
		}
		setCreatorRoom(null);
		setActiveTab("Setup");
	}, [creatorRoom, user]);

	const handleCreatorRoomReset = useCallback(async () => {
		if (creatorRoom) {
			try {
				const latestRoom = await fetchRoom(creatorRoom.id);
				if (latestRoom) {
					setCreatorRoom(latestRoom);
				}
			} catch (e) {
				console.error("Failed to fetch room on reset:", e);
			}
		}
		setActiveTab("RoomLobby");
	}, [creatorRoom]);

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
		if (isLoading || isRestoringSession) return;

		// If we have an active creator room but we aren't in lobby or match anymore, cleanup
		if (creatorRoom && activeTab !== "RoomLobby" && activeTab !== "Match") {
			if (!user) return;
			const myId = user.uid;
			const isHost = creatorRoom.player1_id === myId;
			if (isHost && creatorRoom.status === "waiting") {
				void deleteRoom(creatorRoom.id, myId);
			} else if (!isHost && creatorRoom.status === "waiting") {
				void leaveRoom(creatorRoom.id, myId);
			}
			clearMatchSession();
			setCreatorRoom(null);
		}
	}, [activeTab, creatorRoom, user, isLoading, isRestoringSession]);

	const initializeApp = useCallback(async () => {
		setIsLoading(true);
		setLoadingError(null);
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
					setCustomRounds(Math.max(5, Math.min(30, Number(parsed.customRounds) || 10)));
					setCustomSeconds(Math.max(20, Math.min(90, Math.round((Number(parsed.customSeconds) || 45) / 5) * 5)));
					setNoMoving(parsed.noMoving);
					setNoPanning(parsed.noPanning);
					setNoZooming(parsed.noZooming);
					if (typeof parsed.enableTimeMultiplier === "boolean") setEnableTimeMultiplier(parsed.enableTimeMultiplier);
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
	}, []);

	useEffect(() => {
		void initializeApp();
	}, [initializeApp]);

	// Save creator room settings to local storage when modified
	useEffect(() => {
		if (!isLoading && selectedMode === "creatorRoom") {
			try {
				localStorage.setItem(
					"geozora_creator_settings",
					JSON.stringify({
						customRounds: customRounds === "" ? 10 : customRounds,
						customSeconds: customSeconds === "" ? 45 : customSeconds,
						noMoving,
						noPanning,
						noZooming,
						enableTimeMultiplier,
					}),
				);
			} catch (e) {
				console.warn("Failed to save creator settings to localStorage:", e);
			}
		}
	}, [
		customRounds,
		customSeconds,
		noMoving,
		noPanning,
		noZooming,
		enableTimeMultiplier,
		isLoading,
		selectedMode,
	]);

	useEffect(() => {
		if (creatorRoom && selectedMode === "creatorRoom") {
			setCustomRounds(creatorRoom.total_rounds);
			setCustomSeconds(creatorRoom.round_seconds);
			setNoMoving(creatorRoom.no_moving);
			setNoPanning(creatorRoom.no_panning);
			setNoZooming(creatorRoom.no_zooming);
			setSelectedMaps(creatorRoom.selected_maps || ["world"]);
			setEnableTimeMultiplier(creatorRoom.enable_time_multiplier !== false);
		}
	}, [creatorRoom, selectedMode]);

	useEffect(() => {
		if (!user?.uid || isLoading || isRestoringSession) return;

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

		if (activeTab === "Match" && h2hRoom && selectedMode === "classic") {
			saveMatchSession({
				userId: user.uid,
				roomId: h2hRoom.id,
				mode: "classic",
				tab: "Match",
				isHost: true,
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
		isLoading,
		isRestoringSession,
	]);

	if (isBlockedByAntiCheat) {
		return (
			<div className="h-screen w-screen bg-[var(--color-app-bg)] text-[var(--color-app-text)] flex items-center justify-center font-sans relative overflow-hidden">
				<div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-red-500/20 blur-[120px] rounded-full pointer-events-none" />
				<div className="flex flex-col items-center gap-4 text-center max-w-md px-6 z-10 animate-in fade-in zoom-in-95 duration-350">
					<div className="w-16 h-16 bg-red-500/10 text-red-400 rounded-full flex items-center justify-center mb-2 shadow-[0_0_20px_rgba(239,68,68,0.2)]">
						<span className="text-2xl">🛡️</span>
					</div>
					<h2 className="text-2xl font-bold tracking-tight text-[var(--color-app-text)]">
						Security Enforcement
					</h2>
					<p className="text-[var(--color-app-text-muted)] mb-2">
						Developer Tools or Inspect Element is open. To protect the integrity of the game and matchmaking, please close Developer Tools and reload the page to resume playing.
					</p>
				</div>
			</div>
		);
	}

	if (isLoading || isRestoringSession) {
		return (
			<div className="h-screen w-screen bg-[var(--color-app-bg)] text-[var(--color-app-text)] flex items-center justify-center font-sans relative overflow-hidden">
				<div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-[var(--color-app-blue)]/20 blur-[120px] rounded-full pointer-events-none" />
				<div className="absolute top-[20%] right-[-10%] w-[40%] h-[40%] bg-[var(--color-app-purple)]/10 blur-[120px] rounded-full pointer-events-none" />

				<div className="flex flex-col items-center gap-6 z-10">
					<Loader2 className="w-12 h-12 text-[var(--color-app-blue)] animate-spin" />
					<div className="flex flex-col items-center gap-2">
						<h2 className="text-xl font-medium tracking-tight">
							{isRestoringSession ? "Resuming Match Session..." : (loadingMessage || "Initializing GeoZora...")}
						</h2>
						<p className="text-[var(--color-app-text-muted)] text-sm">
							{isRestoringSession ?
								"Reconnecting to active room and loading game assets..."
							: (loadingMessage ?
								"This may take a moment."
							:	"Connecting to server and loading map data...")}
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

				<div className="flex flex-col items-center gap-4 text-center max-w-md px-6 z-10 animate-in fade-in zoom-in-95 duration-350">
					<div className="w-16 h-16 bg-red-500/10 text-red-400 rounded-full flex items-center justify-center mb-2 shadow-[0_0_20px_rgba(239,68,68,0.2)]">
						<span className="text-2xl">⚠️</span>
					</div>
					<h2 className="text-2xl font-bold tracking-tight text-[var(--color-app-text)]">
						Connection Failed
					</h2>
					<p className="text-[var(--color-app-text-muted)] mb-2">{loadingError}</p>
					<button
						onClick={() => void initializeApp()}
						className="px-6 py-2.5 bg-red-600 hover:bg-red-700 active:scale-98 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-red-600/20 cursor-pointer"
					>
						Try Again
					</button>
				</div>
			</div>
		);
	}

	// ── Appeal Render Interception ──
	if (user?.isBanned && ["Setup", "Matchmaking", "Match", "RoomLobby"].includes(activeTab)) {
		return (
			<div className="h-screen w-screen bg-[var(--color-app-bg)] text-[var(--color-app-text)] flex items-center justify-center font-sans relative overflow-hidden">
				<div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-red-500/20 blur-[120px] rounded-full pointer-events-none" />
				<div className="absolute top-[20%] right-[-10%] w-[40%] h-[40%] bg-red-500/10 blur-[120px] rounded-full pointer-events-none" />

				<div className="bg-[var(--color-app-panel)] border border-red-500/20 max-w-md w-full rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-6 z-10 animate-in fade-in zoom-in-95 duration-350 mx-4">
					<div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mb-2 shadow-[0_0_20px_rgba(239,68,68,0.2)]">
						<span className="text-3xl">🚫</span>
					</div>
					<h2 className="text-2xl font-bold tracking-tight text-[var(--color-app-text)] text-center">
						Account Suspended
					</h2>
					<p className="text-[var(--color-app-text-muted)] text-sm text-center leading-relaxed">
						Your account has been suspended for violating our community guidelines. To restore access, you must submit an appeal.
					</p>

					<div className="w-full bg-red-500/5 border border-red-500/10 rounded-xl p-4 text-xs font-mono text-red-400">
						<span className="font-bold uppercase tracking-wider block mb-1">Reason:</span>
						<span>{user.banReason || "No reason provided."}</span>
					</div>

					{appealStatus === "loading" && (
						<div className="flex flex-col items-center gap-2 py-4">
							<Loader2 className="w-8 h-8 text-red-500 animate-spin" />
							<p className="text-xs text-[var(--color-app-text-muted)]">Checking appeal status...</p>
						</div>
					)}

					{appealStatus === "submitted" && (
						<div className="w-full bg-green-500/5 border border-green-500/20 rounded-xl p-4 text-center text-sm text-green-400 flex flex-col gap-2">
							<span className="font-bold">Appeal Submitted</span>
							<span className="text-xs text-[var(--color-app-text-muted)]">
								Our team is reviewing your case. We will notify you once a decision has been made.
							</span>
						</div>
					)}

					{(appealStatus === "idle" || appealStatus === "error") && (
						<form onSubmit={handleSendAppeal} className="w-full flex flex-col gap-4">
							<div className="flex flex-col gap-1.5">
								<label htmlFor="appeal-text" className="text-xs font-semibold text-[var(--color-app-text-muted)] uppercase tracking-wider">
									Appeal Description
								</label>
								<textarea
									id="appeal-text"
									required
									placeholder="Describe why your account should be unbanned..."
									value={appealMessage}
									onChange={e => setAppealMessage(e.target.value)}
									className="w-full min-h-[120px] bg-[var(--color-app-bg)] border border-[var(--color-app-border)] focus:border-red-500 rounded-xl p-3 text-sm resize-none focus:outline-none transition-colors"
								/>
							</div>
							<button
								type="submit"
								className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-red-600/20 cursor-pointer active:scale-98"
							>
								Submit Appeal
							</button>
						</form>
					)}

					<button
						onClick={() => setActiveTab("Home")}
						className="text-xs text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors underline cursor-pointer"
					>
						Back to Homepage
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="h-screen w-screen bg-[var(--color-app-bg)] text-[var(--color-app-text)] overflow-hidden flex flex-col font-sans relative">
			<DynamicBackground />

			{/* Hide header during matchmaking and match for full-screen experience */}
			{activeTab !== "Matchmaking" && activeTab !== "Match" && (
				<Header
					activeTab={activeTab}
					setActiveTab={setActiveTab}
					onJoinRoom={room => {
						setSelectedMode("creatorRoom");
						setCreatorRoom(room);
						setActiveTab("RoomLobby");
					}}
				/>
			)}

			{warningMessage && (
				<div
					role="alert"
					aria-live="assertive"
					className="fixed top-24 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-6 py-3 rounded-lg shadow-xl border border-red-400 z-[400] flex items-center gap-3 backdrop-blur-sm animate-in fade-in zoom-in duration-200">
					<span className="font-bold flex-shrink-0">⚠️ Warning</span>
					<span>{warningMessage}</span>
				</div>
			)}

			{/* Room creation overlay — distinct from the global app-init isLoading overlay */}
			{isCreatingRoom && (
				<div
					role="status"
					aria-label="Creating room"
					className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[500]">
					<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-2xl p-8 flex flex-col items-center gap-4 shadow-2xl">
						<div className="w-10 h-10 border-2 border-[var(--color-app-blue)] border-t-transparent rounded-full animate-spin" />
						<p className="text-sm font-medium text-[var(--color-app-text-muted)]">{loadingMessage || "Setting up room..."}</p>
					</div>
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
							enableTimeMultiplier={enableTimeMultiplier}
							setEnableTimeMultiplier={setEnableTimeMultiplier}
							onStart={handleStartFromSetup}
							botLevel={botLevel}
							setBotLevel={setBotLevel}
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
									creatorRoom.player1_id === user?.uid
								}
								selectedMaps={selectedMaps}
								onRoomUpdate={setCreatorRoom}
								onUpdateSettings={s => {
									setCustomRounds(s.rounds);
									setCustomSeconds(s.seconds);
									setNoMoving(s.noMoving);
									setNoPanning(s.noPanning);
									setNoZooming(s.noZooming);
									setSelectedMaps(s.maps);
									setEnableTimeMultiplier(s.enableTimeMultiplier);
									if (creatorRoom) {
										setCreatorRoom({
											...creatorRoom,
											total_rounds: s.rounds,
											round_seconds: s.seconds,
											no_moving: s.noMoving,
											no_panning: s.noPanning,
											no_zooming: s.noZooming,
											selected_maps: s.maps,
											enable_time_multiplier: s.enableTimeMultiplier,
										});
									}
								}}
								onStart={handleCreatorRoomStart}
								onLeave={handleCreatorRoomLeave}
							/>
						</div>
					</div>
				)}

				{activeTab === "Match" && (
					<div className="absolute inset-0 w-full h-full pointer-events-auto">
						<Match
							selectedMode={selectedMode}
							selectedMaps={selectedMaps}
							customRounds={customRounds === "" ? 10 : customRounds}
							customSeconds={customSeconds === "" ? 45 : customSeconds}
							botLevel={botLevel}
							onModeChange={handleModeChangeFromMatch}
							onBackToDashboard={handleBackToDashboard}
							onRoomReset={handleCreatorRoomReset}
							onRoomUpdate={selectedMode === "creatorRoom" ? setCreatorRoom : undefined}
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
									creatorRoom.player1_id === user?.uid
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
