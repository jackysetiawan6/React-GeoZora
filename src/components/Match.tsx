import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils";
import { useAuth } from "../lib/AuthContext";
import MatchSidebar from "./MatchSidebar";
import MatchLoadingOverlay from "./match/MatchLoadingOverlay";
import {
	GameModeId,
	GamePhase,
	LatLng,
	RoundResult,
	StreetViewTarget,
	calculateScore,
	getRoundCount,
	getRoundSeconds,
	haversineKm,
} from "../lib/MatchGame";
import type { MapRegion } from "../lib/MapRegions";
import {
	updateStatsAfterClassic,
	updateStatsAfterH2H,
	updateStatsAfterCreatorRoom,
	saveMatchHistory,
	calculateEloChange,
	calculateExpGain,
	fetchPlayerStats,
} from "../lib/PlayerStats";
import {
	subscribeToRoom,
	broadcastToRoom,
	unsubscribeRoom,
	updateRoom,
	generateTargets,
	fetchRoom,
	type MatchRoom,
	type H2HMessage,
} from "../lib/Matchmaking";
import { audioManager } from "../lib/audioManager";
import {
	createRoomPresenceMonitor,
	type RoomPresenceMonitor,
} from "../lib/RoomPresenceMonitor";
import { supabase, logSystemError } from "../lib/supabase";
import { toast } from "sonner";
import {
	clearMatchSession,
	saveMatchSession,
	type MatchSessionMode,
} from "../lib/matchSessionPersistence";
import { useAntiCheatTelemetry } from "../lib/antiCheat";

import MatchHud from "./match/MatchHud";
import MatchRevealOverlay from "./match/MatchRevealOverlay";
import MatchFinishedOverlay from "./match/MatchFinishedOverlay";
import ReportModal from "./match/ReportModal";
import ChatPanel from "./match/ChatPanel";
import { useStreetViewTargetQueue } from "./match/useStreetViewTargetQueue";
import { useDoubleBufferedStreetView } from "./match/useDoubleBufferedStreetView";

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_PLATFORM_KEY ?? "";

type MatchProps = {
	selectedMode: GameModeId;
	selectedMaps: MapRegion[];
	customRounds: number;
	customSeconds: number;
	onModeChange?: (mode: GameModeId) => void;
	onBackToDashboard?: () => void;
	onRoomReset?: () => void;
	onRoomUpdate?: (room: MatchRoom) => void;
	onFindNewH2HMatch?: () => void;

	h2hRoom?: MatchRoom | null;
	h2hOpponentId?: string | null;
	h2hOpponentElo?: number;
	h2hIsHost?: boolean;
};

export default function Match({
	selectedMode,
	selectedMaps,
	customRounds,
	customSeconds,
	onModeChange,
	onBackToDashboard,
	onRoomReset,
	onRoomUpdate,
	onFindNewH2HMatch,
	h2hRoom = null,
	h2hOpponentId = null,
	h2hOpponentElo = 1300,
	h2hIsHost = false,
}: MatchProps) {
	const { user } = useAuth();

	const [phase, setPhase] = useState<GamePhase>("loading");
	const [currentRoundIndex, setCurrentRoundIndex] = useState(0);

	const [reconnectTrigger, setReconnectTrigger] = useState(0);

	useEffect(() => {
		const handleOnline = () => {
			toast.info("Connection restored. Re-syncing match state...");
			setReconnectTrigger(prev => prev + 1);
		};
		window.addEventListener("online", handleOnline);
		return () => window.removeEventListener("online", handleOnline);
	}, []);

	const [localRoom, setLocalRoom] = useState<MatchRoom | null | undefined>(
		h2hRoom,
	);
	useEffect(() => {
		setLocalRoom(h2hRoom);
		if (h2hRoom) {
			setBackingRoomId(h2hRoom.id);
		}
	}, [h2hRoom]);

	const currentRoundIndexRef = useRef(currentRoundIndex);
	currentRoundIndexRef.current = currentRoundIndex;
	const [roundCount, setRoundCount] = useState(5);
	const [roundSeconds, setRoundSeconds] = useState(60);
	const [remainingSec, setRemainingSec] = useState(60);
	const [totalScore, setTotalScore] = useState(0);
	const [history, setHistory] = useState<RoundResult[]>([]);
	const [guess, setGuess] = useState<LatLng | null>(null);
	const [target, setTarget] = useState<StreetViewTarget | null>(null);
	const [isGoogleLoaded, setIsGoogleLoaded] = useState(false);
	const [showTips, setShowTips] = useState(true);
	const [currentResult, setCurrentResult] = useState<RoundResult | null>(null);
	const [locationName, setLocationName] = useState("");
	const [heading, setHeading] = useState(0);
	const [showHint, setShowHint] = useState(false);
	const [isReportModalOpen, setIsReportModalOpen] = useState(false);

	const [allScores, setAllScores] = useState<Record<string, number>>({});
	const [roundScores, setRoundScores] = useState<Record<string, number>>({});
	const [participantNames, setParticipantNames] = useState<Record<string, string>>({});
	const [opponentScore, setOpponentScore] = useState(0);
	const [opponentRoundDone, setOpponentRoundDone] = useState(false);
	const [statsSaved, setStatsSaved] = useState(false);

	const {
		pans,
		zooms,
		blurs,
		incrementPans,
		incrementZooms,
		resetTelemetry,
		getTelemetry,
	} = useAntiCheatTelemetry();

	const [backingRoomId, setBackingRoomId] = useState<string | null>(
		h2hRoom ? h2hRoom.id : null
	);

	const [matchEndedReason, setMatchEndedReason] = useState<string | null>(null);
	const [isInvalidMatch, setIsInvalidMatch] = useState(false);
	const creatorPresenceSyncedRef = useRef(false);
	const creatorPresenceObservedRef = useRef(false);
	const creatorPresenceSyncCountRef = useRef(0);
	const h2hOpponentMissingSyncCountRef = useRef(0);
	const h2hOpponentFirstMissingTimeRef = useRef<number | null>(null);
	const invalidMatchHandledRef = useRef(false);
	const hasRestoredRef = useRef(false);
	const initStartedRef = useRef(false);
	const participantNamesRef = useRef<Record<string, string>>({});

	useEffect(() => {
		participantNamesRef.current = participantNames;
	}, [participantNames]);

	const [activeParticipants, setActiveParticipants] = useState<Set<string>>(
		new Set(),
	);
	const roomMode = (localRoom?.mode || selectedMode) as GameModeId;
	const isH2H = roomMode === "headToHead" && localRoom !== null;
	const isCreator = roomMode === "creatorRoom" && localRoom !== null;
	const isRoomMatch = isH2H || isCreator || (roomMode === "classic" && localRoom !== null && localRoom !== undefined);

	type SubmissionsMap = Record<
		number,
		Record<
			string,
			{ score: number; guess: { lat: number; lng: number } | null }
		>
	>;
	const [roundSubmissions, setRoundSubmissions] = useState<SubmissionsMap>({});
	const roundSubmissionsRef = useRef<SubmissionsMap>({});
	const revealStandings = useMemo(() => {
		if (!isRoomMatch || Object.keys(allScores).length === 0) return [];

		const currentRoundScores = roundSubmissions[currentRoundIndex] || {};
		const entries = (Object.entries(allScores) as Array<[string, number]>).map(
			([uid, totalScore]) => {
			const roundScore = currentRoundScores[uid]?.score ?? 0;
			const isOffline = !activeParticipants.has(uid);
			return {
				uid,
				label:
					participantNames[uid] || (uid === user?.uid ? user?.displayName || "Player" : "Player"),
				totalScore,
				roundScore,
				isOffline,
				hasGuessed: currentRoundScores[uid] !== undefined && currentRoundScores[uid]?.guess !== null,
			};
			},
		);

		const currentSorted = [...entries].sort(
			(a, b) => b.totalScore - a.totalScore,
		);
		const previousSorted = [...entries].sort(
			(a, b) => (b.totalScore - b.roundScore) - (a.totalScore - a.roundScore),
		);
		const previousRankMap = new Map(
			previousSorted.map((entry, index) => [entry.uid, index + 1]),
		);

		return currentSorted.map((entry, index) => {
			const currentRank = index + 1;
			const previousRank = previousRankMap.get(entry.uid) ?? currentRank;
			return {
				...entry,
				rank: currentRank,
				delta: previousRank - currentRank,
			};
		});
	}, [
		allScores,
		currentRoundIndex,
		h2hOpponentId,
		isRoomMatch,
		participantNames,
		roundSubmissions,
		user?.uid,
		user?.displayName,
		activeParticipants,
	]);

	useEffect(() => {
		if (!isRoomMatch || !user?.uid) {
			if (Object.keys(participantNames).length > 0) {
				setParticipantNames({});
			}
			return;
		}

		const ids = new Set<string>();
		ids.add(user.uid);
		if (h2hOpponentId) ids.add(h2hOpponentId);
		if (localRoom?.player1_id) ids.add(localRoom.player1_id);
		if (localRoom?.player2_id) ids.add(localRoom.player2_id);
		Object.keys(allScores).forEach(uid => ids.add(uid));

		const resolvedNames: Record<string, string> = {
			[user.uid]: user.displayName || "Player",
		};
		const missingIds = Array.from(ids).filter(id => !resolvedNames[id]);

		let cancelled = false;
		const loadNames = async () => {
			if (missingIds.length > 0) {
				try {
					const { data } = await supabase
						.from("profiles")
						.select("id, display_name")
						.in("id", missingIds);

					if (cancelled) return;
					(data || []).forEach((row: any) => {
						if (row?.id && row?.display_name) {
							resolvedNames[row.id] = row.display_name;
						}
					});
				} catch (error) {
					if (!cancelled) {
						console.error("Failed to load match participant names:", error);
					}
				}
			}

			if (!cancelled) {
				setParticipantNames(resolvedNames);
			}
		};

		void loadNames();

		return () => {
			cancelled = true;
		};
	}, [
		allScores,
		h2hOpponentId,
		isRoomMatch,
		localRoom?.player1_id,
		localRoom?.player2_id,
		localRoom?.id,
		user?.displayName,
		user?.uid,
	]);

	const activeParticipantsRef = useRef<Set<string>>(new Set());

	const phaseRef = useRef<GamePhase>(phase);
	const totalScoreRef = useRef(0);
	const opponentScoreRef = useRef(0);
	const allScoresRef = useRef<Record<string, number>>({});
	const requestIdRef = useRef(0);
	const geocodeTokenRef = useRef(0);
	const nextRoundTimerRef = useRef<number | null>(null);
	const hintTimerRef = useRef<number | null>(null);
	const isSubmittingRef = useRef(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const channelRef = useRef<ReturnType<typeof subscribeToRoom> | null>(null);
	const presenceMonitorRef = useRef<RoomPresenceMonitor | null>(null);
	const [showQuitConfirm, setShowQuitConfirm] = useState(false);
	const matchStartTimeRef = useRef<number | null>(null);

	const handleQuitClick = () => {
		if (phase === "finished") {
			onBackToDashboard?.();
		} else {
			setShowQuitConfirm(true);
		}
	};

	const handleNextRoundSkip = () => {
		if (nextRoundTimerRef.current) {
			window.clearTimeout(nextRoundTimerRef.current);
			nextRoundTimerRef.current = null;
		}
		if (currentRoundIndex >= roundCount) {
			void finishMatch();
		} else {
			void goToNextRound();
		}
	};

	const selectedMapsKey = useMemo(() => selectedMaps.join("|"), [selectedMaps]);

	const stableSelectedMaps = useMemo(() => {
		return selectedMaps;
	}, [selectedMapsKey]);

	const roomTargets = useMemo(() => {
		return localRoom?.targets ?? [];
	}, [localRoom?.targets]);

	const {
		targetQueueRef,
		resetQueue,
		seedInitialTargets,
		ensureTargetsAhead,
		getTargetForRound,
	} = useStreetViewTargetQueue({
		apiKey: API_KEY,
		selectedMaps: stableSelectedMaps,
		customRounds,
		isRoomMatch,
		roomTargets,
	});

	const streetViewRules = useMemo(
		() => ({
			noMoving: isRoomMatch ? !!localRoom?.no_moving : false,
			noPanning: isRoomMatch ? !!localRoom?.no_panning : false,
			noZooming: isRoomMatch ? !!localRoom?.no_zooming : false,
		}),
		[
			isRoomMatch,
			localRoom?.no_moving,
			localRoom?.no_panning,
			localRoom?.no_zooming,
		],
	);

	const handleHeadingChange = useCallback((nextHeading: number) => {
		setHeading(nextHeading);
	}, []);

	const handleGoogleLoaded = useCallback(() => {
		setIsGoogleLoaded(true);
	}, []);

	const {
		containerARef,
		containerBRef,
		activeSlot,
		streetViewLoading,
		resetBuffers,
		initFirstRound,
		preloadRound,
		showRound,
	} = useDoubleBufferedStreetView({
		apiKey: API_KEY,
		rules: streetViewRules,
		onHeadingChange: handleHeadingChange,
		onGoogleLoaded: handleGoogleLoaded,
		onPan: incrementPans,
		onZoom: incrementZooms,
	});

	useEffect(() => {
		activeParticipantsRef.current = activeParticipants;
	}, [activeParticipants]);

	useEffect(() => {
		phaseRef.current = phase;
	}, [phase]);

	useEffect(() => {
		if (!isRoomMatch || !localRoom?.id || phase === "finished") return;

		let cancelled = false;
		const refreshRoom = async () => {
			try {
				const latestRoom = await fetchRoom(localRoom.id);
				if (cancelled || !latestRoom) return;

				const currentTargets = Array.isArray(localRoom.targets) ? localRoom.targets.length : 0;
				const latestTargets = Array.isArray(latestRoom.targets) ? latestRoom.targets.length : 0;
				if (
					latestTargets > currentTargets ||
					latestRoom.status !== localRoom.status ||
					latestRoom.current_round !== localRoom.current_round
				) {
					setLocalRoom(prev => prev ? { ...prev, ...latestRoom } : latestRoom);
				}
			} catch (error) {
				console.error("Failed to refresh room state:", error);
			}
		};

		void refreshRoom();
		const intervalId = window.setInterval(() => {
			void refreshRoom();
		}, 2000);

		return () => {
			cancelled = true;
			window.clearInterval(intervalId);
		};
	}, [
		isRoomMatch,
		localRoom?.current_round,
		localRoom?.id,
		localRoom?.status,
		localRoom?.targets?.length,
		phase,
	]);

	useEffect(() => {
		if (!user?.uid) return;

		if (!isRoomMatch || !localRoom) {
			if (phase === "finished") {
				clearMatchSession();
			}
			return;
		}

		if (phase === "finished") {
			clearMatchSession();
			return;
		}
		if (isInvalidMatch) return;

		const sessionMode: MatchSessionMode =
			roomMode === "classic" ? "classic"
			: roomMode === "creatorRoom" ? "creatorRoom"
			: "headToHead";

		saveMatchSession({
			userId: user.uid,
			roomId: localRoom.id,
			mode: sessionMode,
			tab: "Match",
			isHost: roomMode === "classic" ? true : h2hIsHost,
			opponentId: roomMode === "classic" ? null : h2hOpponentId,
			opponentElo: roomMode === "classic" ? null : h2hOpponentElo,
		});
	}, [
		isCreator,
		isRoomMatch,
		h2hIsHost,
		h2hOpponentElo,
		h2hOpponentId,
		localRoom,
		phase,
		user?.uid,
		selectedMode,
	]);

	useEffect(() => {
		totalScoreRef.current = totalScore;
	}, [totalScore]);

	useEffect(() => {
		opponentScoreRef.current = opponentScore;
	}, [opponentScore]);

	useEffect(() => {
		allScoresRef.current = allScores;
	}, [allScores]);

	// Persist active match progress to localStorage for reload restoration
	useEffect(() => {
		if (!user?.uid || !backingRoomId || phase === "finished" || phase === "loading") return;

		const progress = {
			currentRoundIndex,
			totalScore,
			history,
			phase,
			backingRoomId,
			target,
			guess,
			remainingSec,
			opponentScore,
			opponentRoundDone,
			roundSubmissions,
			allScores,
		};
		localStorage.setItem(`geozora_match_progress_${user.uid}`, JSON.stringify(progress));
	}, [
		user?.uid,
		currentRoundIndex,
		totalScore,
		history,
		phase,
		backingRoomId,
		target,
		guess,
		remainingSec,
		opponentScore,
		opponentRoundDone,
		roundSubmissions,
		allScores,
	]);

	// Clear match progress when the match is completed
	useEffect(() => {
		if (phase === "finished" && user?.uid) {
			localStorage.removeItem(`geozora_match_progress_${user.uid}`);
		}
	}, [phase, user?.uid]);

	const playerTotals = useMemo(() => {
		if (isRoomMatch) {
			return { 1: totalScore, 2: opponentScore };
		}

		return history.reduce(
			(acc, entry) => {
				acc[entry.player] += entry.score;
				return acc;
			},
			{ 1: 0, 2: 0 } as Record<1 | 2, number>,
		);
	}, [history, isRoomMatch, opponentScore, totalScore]);

	const activePlayerLabel = useMemo(() => {
		return isRoomMatch ? "You" : "Solo";
	}, [isRoomMatch]);

	const winnerText = useMemo(() => {
		if (isRoomMatch) {
			if (playerTotals[1] === playerTotals[2]) return "It is a draw!";
			return playerTotals[1] > playerTotals[2] ?
					"You win the duel!"
				:	"You lost the duel.";
		}

		if (history.length > 0)
			return `Final score: ${totalScore.toLocaleString()} pts`;
		if (roomMode === "creatorRoom")
			return "Configure the room and start your match.";
		if (roomMode === "chaos") return "Chaos Mode is coming soon.";

		return "";
	}, [history.length, isRoomMatch, playerTotals, roomMode, totalScore]);

	const clearTimers = useCallback(() => {
		if (nextRoundTimerRef.current) {
			window.clearTimeout(nextRoundTimerRef.current);
			nextRoundTimerRef.current = null;
		}
	}, []);

	const getResolvedRoundCount = useCallback(
		(mode: GameModeId) => {
			if (isRoomMatch) {
				return localRoom?.total_rounds ?? getRoundCount(mode, customRounds);
			}

			return getRoundCount(mode, customRounds);
		},
		[customRounds, localRoom?.total_rounds, isRoomMatch],
	);

	const getResolvedRoundSeconds = useCallback(
		(mode: GameModeId) => {
			if (isRoomMatch) {
				return localRoom?.round_seconds ?? getRoundSeconds(mode, customSeconds);
			}

			return getRoundSeconds(mode, customSeconds);
		},
		[customSeconds, localRoom?.round_seconds, isRoomMatch],
	);

	useEffect(() => {
		if (
			phase !== "finished" ||
			statsSaved ||
			isInvalidMatch ||
			!user?.uid ||
			history.length === 0
		) {
			return;
		}

		setStatsSaved(true);

		const saveStats = async () => {
			if (!user) return;
			const realDuration =
				matchStartTimeRef.current ?
					Math.round((Date.now() - matchStartTimeRef.current) / 1000)
				:	null;

			if (isH2H && localRoom && h2hOpponentId) {
				const isOpponentDisconnected = matchEndedReason === "Opponent disconnected.";
				const resolvedOpponentScore = isOpponentDisconnected ? -1 : opponentScore;
				const result: "win" | "loss" | "draw" =
					totalScore > resolvedOpponentScore ? "win"
					: totalScore < resolvedOpponentScore ? "loss"
					: "draw";

				// 1. Update own stats (runs on both clients)
				const updatedStats = await updateStatsAfterH2H(
					user.uid,
					h2hOpponentElo,
					totalScore,
					history.length,
					result,
					localRoom.id,
				);
				if (!updatedStats) {
					toast.error("Failed to sync duel progression. ELO/EXP may not be saved.");
					void logSystemError("H2H stats progression failure", {
						userId: user.uid,
						opponentElo: h2hOpponentElo,
						totalScore,
						rounds: history.length,
						result,
					});
				}

				// 2. Only write to match_history from Host, or Guest if Host disconnected, to prevent duplicate entries
				const shouldWriteHistory = h2hIsHost || matchEndedReason === "Opponent disconnected.";
				if (shouldWriteHistory) {
					let opponentName = "Opponent";
					try {
						const { data: oppProfile } = await supabase
							.from("profiles")
							.select("display_name")
							.eq("id", h2hOpponentId)
							.single();
						if (oppProfile?.display_name) {
							opponentName = oppProfile.display_name;
						}
					} catch (e) {
						console.error("Failed to fetch opponent name for match history:", e);
					}

					const playerStats = await fetchPlayerStats(user.uid);
					const playerElo = playerStats?.elo ?? 1300;

					const isPlayer1 = localRoom.player1_id === user.uid;
					const eloChange = calculateEloChange(playerElo, h2hOpponentElo, result);

					const playerExpGain = calculateExpGain(
						"headToHead",
						totalScore,
						result,
					);
					const opponentExpGain = calculateExpGain(
						"headToHead",
						resolvedOpponentScore,
						result === "win" ? "loss"
						: result === "loss" ? "win"
						: "draw",
					);

					await saveMatchHistory(
						localRoom.player1_id || user.uid,
						localRoom.player2_id || h2hOpponentId,
						isPlayer1 ? (user.displayName || "Player") : opponentName,
						isPlayer1 ? opponentName : (user.displayName || "Player"),
						isPlayer1 ? totalScore : resolvedOpponentScore,
						isPlayer1 ? resolvedOpponentScore : totalScore,
						"headToHead",
						stableSelectedMaps.map(m => m),
						localRoom.total_rounds,
						localRoom.round_seconds,
						{
							no_moving: localRoom.no_moving,
							no_panning: localRoom.no_panning,
							no_zooming: localRoom.no_zooming,
							real_duration: realDuration,
						},
						{
							player1: isPlayer1 ? playerExpGain : opponentExpGain,
							player2: isPlayer1 ? opponentExpGain : playerExpGain,
						},
						{
							player1: isPlayer1 ? eloChange : -eloChange,
							player2: isPlayer1 ? -eloChange : eloChange,
						},
						localRoom.id,
					);
				}
			} else if (roomMode === "creatorRoom" && localRoom) {
				const sortedScores = (
					Object.entries(allScoresRef.current) as [string, number][]
				).sort((a, b) => b[1] - a[1]);
				const topScoreEntry = sortedScores[0];
				const runnerUpEntry = sortedScores[1];

				let result: "win" | "loss" | "draw" = "loss";
				let winnerId: string | null = null;
				if (topScoreEntry) {
					winnerId = topScoreEntry[0];
					if (winnerId === user.uid) {
						if (runnerUpEntry && topScoreEntry[1] === runnerUpEntry[1]) {
							result = "draw";
						} else {
							result = "win";
						}
					} else {
						if (totalScore === topScoreEntry[1]) {
							result = "draw";
						}
					}
				}

				let myRank = 1;
				let lastScore = -1;
				for (let i = 0; i < sortedScores.length; i++) {
					const [playerId, score] = sortedScores[i];
					if (score !== lastScore) {
						myRank = i + 1;
						lastScore = score;
					}
					if (playerId === user.uid) {
						break;
					}
				}

				// Update user progression stats
				const updatedStats = await updateStatsAfterCreatorRoom(
					user.uid,
					totalScore,
					history.length,
					result,
					localRoom.id,
				);
				if (!updatedStats) {
					toast.error("Failed to sync progression stats. EXP may not be saved.");
					void logSystemError("Creator Room stats progression failure", {
						userId: user.uid,
						totalScore,
						rounds: history.length,
						result,
					});
				}

				// Save match history from each participant's perspective (to support multi-player room querying)
				const expGained = calculateExpGain("creatorRoom", totalScore, result);

				await saveMatchHistory(
					user.uid,
					null,
					user.displayName || "Player",
					"Creator Match",
					totalScore,
					0,
					"creatorRoom",
					stableSelectedMaps.map(m => m),
					localRoom.total_rounds,
					localRoom.round_seconds,
					{
						no_moving: localRoom.no_moving,
						no_panning: localRoom.no_panning,
						no_zooming: localRoom.no_zooming,
						real_duration: realDuration,
						rank: myRank,
					},
					{
						player1: expGained,
					},
					undefined,
					localRoom.id,
					winnerId,
				);
			} else if (roomMode === "classic") {
				const expGain = calculateExpGain("classic", totalScore);
				const updatedStats = await updateStatsAfterClassic(user.uid, totalScore, history.length, backingRoomId);
				if (!updatedStats) {
					toast.error("Failed to sync progression stats. EXP may not be saved.");
					void logSystemError("Classic stats progression failure", {
						userId: user.uid,
						totalScore,
						rounds: history.length,
					});
				}

				await saveMatchHistory(
					user.uid,
					null,
					user.displayName || "Player",
					null,
					totalScore,
					0,
					"classic",
					stableSelectedMaps.map(m => m),
					roundCount,
					roundSeconds,
					{
						no_moving: false,
						no_panning: false,
						no_zooming: false,
						real_duration: realDuration,
					},
					{
						player1: expGain,
					},
				);

				if (backingRoomId) {
					const { error: deleteError } = await supabase
						.from("match_rooms")
						.delete()
						.eq("id", backingRoomId);
					if (deleteError) {
						console.error("Failed to delete classic backing room:", deleteError);
					}
				}
			}
		};

		void saveStats();
	}, [
		h2hOpponentElo,
		history.length,
		isH2H,
		isInvalidMatch,
		opponentScore,
		phase,
		selectedMode,
		statsSaved,
		totalScore,
		user?.uid,
		user?.displayName,
		localRoom,
		h2hOpponentId,
		stableSelectedMaps,
		customRounds,
		getResolvedRoundSeconds,
		roundCount,
		roundSeconds,
		h2hIsHost,
		matchEndedReason,
		allScores,
		backingRoomId,
	]);

	const resetMatchState = useCallback(() => {
		clearTimers();

		requestIdRef.current += 1;
		geocodeTokenRef.current += 1;

		setHistory([]);
		setTotalScore(0);
		setOpponentScore(0);
		setAllScores({});
		setRoundSubmissions({});
		roundSubmissionsRef.current = {};
		setCurrentResult(null);
		setLocationName("");
		setGuess(null);
		setTarget(null);
		setShowHint(false);
		setStatsSaved(false);

		totalScoreRef.current = 0;
		opponentScoreRef.current = 0;
		allScoresRef.current = {};

		resetTelemetry();

		resetQueue();
		resetBuffers();
	}, [clearTimers, resetBuffers, resetQueue, resetTelemetry]);

	const finalizeInvalidCreatorRoom = useCallback(
		async (reason: string) => {
			if (!localRoom || invalidMatchHandledRef.current) return;
			invalidMatchHandledRef.current = true;
			setIsInvalidMatch(true);
			setMatchEndedReason(reason);

			try {
				await updateRoom(localRoom.id, {
					status: "completed",
					winner_id: null,
					scores: {},
					player1_score: 0,
					player2_score: 0,
				});

				const completedRoom = {
					...localRoom,
					status: "completed" as const,
					winner_id: null,
					scores: {},
					player1_score: 0,
					player2_score: 0,
				};
				onRoomUpdate?.(completedRoom as MatchRoom);

				if (channelRef.current) {
					broadcastToRoom(channelRef.current, {
						type: "game_over",
						player1Score: 0,
						player2Score: 0,
						winnerId: null,
						reason,
					} as any);
				}
			} catch (err) {
				console.error("Failed to finalize invalid creator room:", err);
			} finally {
				setPhase("finished");
			}
		},
		[localRoom],
	);

	const startSession = useCallback(
		async (mode: GameModeId, targetsOverride?: StreetViewTarget[]) => {
			if (!user?.uid) return;

			resetMatchState();

			const requestId = ++requestIdRef.current;
			const resolvedRounds = getResolvedRoundCount(mode);
			const resolvedSeconds = getResolvedRoundSeconds(mode);

			setRoundCount(resolvedRounds);
			setRoundSeconds(resolvedSeconds);
			setRemainingSec(resolvedSeconds);
			setCurrentRoundIndex(0);
			setPhase("loading");

			if (!API_KEY || mode === "chaos") {
				setPhase("finished");
				return;
			}

			try {
				let firstTarget: StreetViewTarget | null = null;
				let secondTarget: StreetViewTarget | null = null;

				if (mode === "classic") {
					const initialSeedCount = Math.min(2, resolvedRounds);
					const initialTargets = await seedInitialTargets(mode, resolvedRounds, initialSeedCount);

					if (requestIdRef.current !== requestId) return;

					firstTarget = initialTargets[0] || null;
					secondTarget = initialTargets[1] || null;

					const classicRoomId = `classic_${user.uid}_${Date.now()}`;
					
					// Cleanup any orphaned classic rooms for this user
					try {
						await supabase
							.from("match_rooms")
							.delete()
							.eq("player1_id", user.uid)
							.eq("mode", "classic");
					} catch (e) {
						console.warn("Failed to cleanup old classic rooms:", e);
					}

					const { error: roomError } = await supabase
						.from("match_rooms")
						.insert({
							id: classicRoomId,
							player1_id: user.uid,
							targets: initialTargets,
							total_rounds: resolvedRounds,
							round_seconds: resolvedSeconds,
							no_moving: false,
							no_panning: false,
							no_zooming: false,
							enable_time_multiplier: false,
							selected_maps: stableSelectedMaps,
							status: "playing",
							current_round: 1,
							mode: "classic",
						});

					if (roomError) {
						console.error("Failed to create backing room for classic match:", roomError);
						toast.warning("Server connection failed. Telemetry and statistics might not be saved.");
						void logSystemError("Classic backing room creation failure", {
							userId: user.uid,
							error: roomError.message,
							code: roomError.code,
							classicRoomId,
						});
						setBackingRoomId(null);
					} else {
						setBackingRoomId(classicRoomId);
						setLocalRoom({
							id: classicRoomId,
							player1_id: user.uid,
							targets: initialTargets,
							total_rounds: resolvedRounds,
							round_seconds: resolvedSeconds,
							no_moving: false,
							no_panning: false,
							no_zooming: false,
							enable_time_multiplier: false,
							selected_maps: stableSelectedMaps,
							status: "playing",
							current_round: 1,
							mode: "classic",
						} as any);
					}

					if (initialSeedCount < resolvedRounds) {
						void (async () => {
							try {
								const remainingTargets = await generateTargets(
									API_KEY,
									stableSelectedMaps,
									resolvedRounds - initialSeedCount,
									"classic"
								);
								const combinedTargets = [...initialTargets, ...remainingTargets];
								
								// Update in database
								await updateRoom(classicRoomId, {
									targets: combinedTargets,
								});
								
								// Update locally
								setLocalRoom(prev => prev ? { ...prev, targets: combinedTargets } : null);
							} catch (backgroundError) {
								console.error("Failed to generate background targets for classic:", backgroundError);
							}
						})();
					}
				} else {
					await seedInitialTargets(mode, resolvedRounds, 3, targetsOverride);

					if (requestIdRef.current !== requestId) return;

					firstTarget = await getTargetForRound(1, mode, resolvedRounds, targetsOverride);
					secondTarget = await getTargetForRound(2, mode, resolvedRounds, targetsOverride);
				}

				if (!firstTarget) {
					setPhase("finished");
					return;
				}

				if (requestIdRef.current !== requestId) return;

				setCurrentResult(null);
				setLocationName("");
				setGuess(null);
				isSubmittingRef.current = false;
				setIsSubmitting(false);

				resetTelemetry(Date.now());

				await initFirstRound({
					round: 1,
					target: firstTarget,
					nextTarget: secondTarget,
				});

				if (requestIdRef.current !== requestId) return;

				setTarget(firstTarget);
				setCurrentRoundIndex(1);
				setRemainingSec(resolvedSeconds);
				setPhase("playing");
				matchStartTimeRef.current = Date.now();

				if (mode !== "classic") {
					void ensureTargetsAhead(1, mode, resolvedRounds, 3);
				}
			} catch {
				if (requestIdRef.current !== requestId) return;
				setPhase("finished");
			}
		},
		[
			ensureTargetsAhead,
			getResolvedRoundCount,
			getResolvedRoundSeconds,
			getTargetForRound,
			initFirstRound,
			resetMatchState,
			seedInitialTargets,
			user?.uid,
		],
	);

	const onRoomResetRef = useRef(onRoomReset);
	onRoomResetRef.current = onRoomReset;

	const startSessionRef = useRef(startSession);
	startSessionRef.current = startSession;

	const localRoomRef = useRef(localRoom);
	localRoomRef.current = localRoom;

	useEffect(() => {
		const room = localRoomRef.current;
		if (!isRoomMatch || !room) return;

		// Create and start presence monitor for detecting disconnections
		const monitorRef = createRoomPresenceMonitor(
			room.id,
			event => {
				// Disconnection detected
				if (roomMode === "headToHead" && event.userId === h2hOpponentId) {
					const isMidMatch =
						phaseRef.current === "playing" ||
						phaseRef.current === "reveal" ||
						phaseRef.current === "waiting_for_others";

					if (isMidMatch && event.wasActive) {
						// Opponent was active and now disconnected
						try {
							// Determine authoritative remaining participant(s)
							const remaining = presenceMonitorRef.current?.getActiveParticipants() || [];
							let winnerId: string | null = null;
							if (remaining.length === 1) {
								winnerId = remaining[0];
							} else {
								// Fallback to current user if ambiguous
								winnerId = user?.uid ?? null;
							}

							if (channelRef.current) {
								broadcastToRoom(channelRef.current, {
									type: "game_over",
									player1Score: totalScoreRef.current,
									player2Score: opponentScoreRef.current,
									winnerId,
									reason: "Opponent disconnected.",
								} as any);
							}

							const finalScoresMap: Record<string, number> = {
								...allScoresRef.current,
							};
							if (user?.uid) finalScoresMap[user.uid] = totalScoreRef.current;
							finalScoresMap[h2hOpponentId] = -1;

							// Persist a winner based on remaining participant mapping
							const roomUpdates: any = {
								status: "completed",
								winner_id: winnerId,
								scores: finalScoresMap,
							};
							// Ensure player1_score/player2_score map to DB columns correctly
							const currentRoom = localRoomRef.current;
							if (currentRoom) {
								const p1 = currentRoom.player1_id;
								const p2 = currentRoom.player2_id;
								if (p1 && p2) {
									roomUpdates.player1_score = finalScoresMap[p1] ?? 0;
									roomUpdates.player2_score = finalScoresMap[p2] ?? 0;
								}
							}

							void updateRoom(room.id, roomUpdates);

							setMatchEndedReason("Opponent disconnected.");
							setPhase("finished");
						} catch (err) {
							console.error("Error handling opponent disconnect:", err);
							setPhase("finished");
						}
					}
				} else if (roomMode === "creatorRoom" && event.wasActive) {
					// In creator room, notify about participant disconnect
					const isMidMatch =
						phaseRef.current === "playing" ||
						phaseRef.current === "reveal" ||
						phaseRef.current === "waiting_for_others";

					if (isMidMatch && localRoomRef.current?.status !== "completed" && phaseRef.current !== "finished") {
						const name = participantNamesRef.current[event.userId] || "A participant";
						toast.info(`${name} disconnected.`);
					}
				}
			},
			30000, // 30-second timeout
			15000, // Check every 15 seconds (optimized from 5s, reduced CPU polling)
		);

		presenceMonitorRef.current = monitorRef;

		// Presence channel for tracking active users during the match
		const presenceChannelName = `match_presence_${room.id}`;
		const existingPresenceCh = supabase.getChannels().find(
			(ch: any) => ch.name === presenceChannelName || ch.topic === `realtime:${presenceChannelName}`
		);
		if (existingPresenceCh) {
			supabase.removeChannel(existingPresenceCh);
		}

		const presenceCh = supabase.channel(presenceChannelName, {
			config: {
				presence: {
					key: user?.uid || `guest_${Math.random().toString(36).slice(2, 8)}`,
				},
			},
		});

		presenceCh
			.on("presence", { event: "sync" }, () => {
				const state = presenceCh.presenceState();
				const actives = new Set<string>();
				creatorPresenceSyncCountRef.current += 1;
				Object.keys(state).forEach(k => {
					const presenceElements = state[k] as any[];
					if (presenceElements && presenceElements.length > 0) {
						actives.add(presenceElements[0].id || k);
					}
				});
				if (actives.size > 0) {
					creatorPresenceObservedRef.current = true;
				}
				setActiveParticipants(actives);
				activeParticipantsRef.current = actives;

				// Update monitor with active participants
				monitorRef.syncActive(actives);

				setAllScores(prev => {
					let dirty = false;
					const next = { ...prev };
					actives.forEach(id => {
						if (typeof next[id] !== "number") {
							next[id] = 0;
							dirty = true;
						}
					});
					if (dirty) allScoresRef.current = next;
					return dirty ? next : prev;
				});



				if (roomMode === "headToHead" && room && h2hOpponentId) {
					const isMidMatch =
						phaseRef.current === "playing" ||
						phaseRef.current === "reveal" ||
						phaseRef.current === "waiting_for_others";
					const roomIsCompleted = localRoomRef.current?.status === "completed" || phaseRef.current === "finished";
					if (roomIsCompleted || !isMidMatch) {
						h2hOpponentMissingSyncCountRef.current = 0;
						h2hOpponentFirstMissingTimeRef.current = null;
						return;
					}
					if (
						!invalidMatchHandledRef.current &&
						actives.has(user?.uid || "") &&
						!actives.has(h2hOpponentId)
					) {
						if (h2hOpponentFirstMissingTimeRef.current === null) {
							h2hOpponentFirstMissingTimeRef.current = Date.now();
							window.setTimeout(() => {
								const currentActives = activeParticipantsRef.current;
								const currentRoom = localRoomRef.current;
								const currentPhase = phaseRef.current;
								const currentOpponentId = h2hOpponentId;
								const currentRoomIsCompleted = currentRoom?.status === "completed" || currentPhase === "finished";

								if (
									!invalidMatchHandledRef.current &&
									!currentRoomIsCompleted &&
									currentActives.has(user?.uid || "") &&
									!currentActives.has(currentOpponentId || "")
								) {
									invalidMatchHandledRef.current = true;
									try {
										const remaining = presenceMonitorRef.current?.getActiveParticipants() || [];
										let winnerId: string | null = null;
										if (remaining.length === 1) winnerId = remaining[0];
										else winnerId = user?.uid ?? null;

										if (channelRef.current) {
											broadcastToRoom(channelRef.current, {
												type: "game_over",
												player1Score: totalScoreRef.current,
												player2Score: opponentScoreRef.current,
												winnerId,
												reason: "Opponent disconnected.",
											} as any);
										}

										const finalScoresMap: Record<string, number> = {
											...allScoresRef.current,
										};
										if (user?.uid) finalScoresMap[user.uid] = totalScoreRef.current;
										if (currentOpponentId) finalScoresMap[currentOpponentId] = -1;

										const roomUpdates: any = {
											status: "completed",
											winner_id: winnerId,
											scores: finalScoresMap,
										};

										if (currentRoom) {
											const p1 = currentRoom.player1_id;
											const p2 = currentRoom.player2_id;
											if (p1 && p2) {
												roomUpdates.player1_score = finalScoresMap[p1] ?? 0;
												roomUpdates.player2_score = finalScoresMap[p2] ?? 0;
											}
										}

										void updateRoom(currentRoom.id, roomUpdates);

										setMatchEndedReason("Opponent disconnected.");
										setPhase("finished");
									} catch (err) {
										console.error("Error handling opponent disconnect (presence sync timeout):", err);
										setPhase("finished");
									}
								}
							}, 15000);
						}
					} else {
						h2hOpponentMissingSyncCountRef.current = 0;
						h2hOpponentFirstMissingTimeRef.current = null;
					}
				}
			})
			.subscribe(async status => {
				if (status === "SUBSCRIBED") {
					if (roomMode === "creatorRoom") {
						creatorPresenceSyncedRef.current = true;
						creatorPresenceSyncCountRef.current = 0;
					}
					await presenceCh.track({ isPlaying: true });
				}
			});

		const ch = subscribeToRoom(room.id, (msg: H2HMessage) => {
			if (msg.type === "guess_submitted") {
				if (msg.round < currentRoundIndexRef.current - 1) return; // Prevent very old round messages

				setRoundSubmissions(prev => {
					const next = { ...prev };
					if (!next[msg.round]) next[msg.round] = {};
					next[msg.round] = {
						...next[msg.round],
						[msg.userId]: { score: msg.score, guess: msg.guess },
					};
					roundSubmissionsRef.current = next;
					return next;
				});

				setAllScores(prev => {
					const next = {
						...prev,
						[msg.userId]: (prev[msg.userId] || 0) + msg.score,
					};

					allScoresRef.current = next;
					return next;
				});

				if (msg.userId !== user?.uid) {
					setOpponentScore(prev => {
						const next = prev + msg.score;
						opponentScoreRef.current = next;
						return next;
					});

					setOpponentRoundDone(true);
				}
			}

			if (msg.type === "game_over") {
				if ((msg as any).reason) {
					setMatchEndedReason((msg as any).reason);
				}
				clearTimers();
				setPhase("finished");
			}

			if (msg.type === "reset_match") {
				if (roomMode === "creatorRoom") {
					onRoomResetRef.current?.();
				} else {
					// Attempt to just reload
					if (msg.targets && localRoomRef.current) {
						setLocalRoom(prev =>
							prev ?
								{ ...prev, targets: msg.targets as StreetViewTarget[] }
							:	null,
						);
					}
					setPhase("loading");
					resetMatchState();
					void startSessionRef.current(roomMode);
				}
			}
		});

		channelRef.current = ch;

		return () => {
			unsubscribeRoom(ch);
			supabase.removeChannel(presenceCh);
			if (presenceMonitorRef.current) {
				presenceMonitorRef.current.stop();
				presenceMonitorRef.current = null;
			}
			channelRef.current = null;
		};
	}, [
		localRoom?.id,
		isRoomMatch,
		user?.uid,
		roomMode,
		h2hOpponentId,
		reconnectTrigger,
	]);

	const loadRound = useCallback(
		async (roundNumber: number) => {
			const requestId = ++requestIdRef.current;
			const resolvedSeconds = getResolvedRoundSeconds(roomMode);

			clearTimers();
			setPhase("loading");
			setRemainingSec(resolvedSeconds); // Reset timer early so HUD / other states don't read old round's 0 value
			geocodeTokenRef.current += 1;

			setGuess(null);
			setTarget(null);
			setCurrentResult(null);
			setLocationName("");
			setOpponentRoundDone(false);
			setShowHint(false);
			isSubmittingRef.current = false;
			setIsSubmitting(false);

			resetTelemetry(Date.now());

			const nextTarget = await (async () => {
				for (let attempts = 0; attempts < 15; attempts++) {
					const target = await getTargetForRound(
						roundNumber,
						roomMode,
						roundCount,
					);
					if (target) return target;

					if (!isRoomMatch || !localRoom?.id) break;

					try {
						const latestRoom = await fetchRoom(localRoom.id);
						if (latestRoom) {
							setLocalRoom(prev => prev ? { ...prev, ...latestRoom } : latestRoom);
						}
					} catch (error) {
						console.error("Failed to refresh room target queue:", error);
					}

					await new Promise(resolve => window.setTimeout(resolve, 1000));
				}

				return null;
			})();

			if (!nextTarget || requestIdRef.current !== requestId) return;

			await showRound(roundNumber, nextTarget);

			if (requestIdRef.current !== requestId) return;

			setTarget(nextTarget);
			setCurrentRoundIndex(roundNumber);
			setRemainingSec(resolvedSeconds);
			setPhase("playing");
			audioManager.playSfx("roundStart");

			// Persist current round to DB for room matches so server/other clients can stay in sync
			if (isRoomMatch && localRoom) {
				try {
					await updateRoom(localRoom.id, { current_round: roundNumber, status: "active" });
				} catch (err) {
					console.error("Failed to update room current_round:", err);
				}
			}

			const nextPreloadTarget = await getTargetForRound(
				roundNumber + 1,
				roomMode,
				roundCount,
			);

			if (nextPreloadTarget) {
				void preloadRound(roundNumber + 1, nextPreloadTarget).catch(() => {});
			}

			void ensureTargetsAhead(roundNumber, roomMode, roundCount, 3);
		},
		[
			clearTimers,
			ensureTargetsAhead,
			getResolvedRoundSeconds,
			getTargetForRound,
			preloadRound,
			roundCount,
			roomMode,
			showRound,
		],
	);

	const finishMatch = useCallback(async () => {
		if (isRoomMatch && localRoom) {
			const p1Final = totalScoreRef.current;
			const p2Final = opponentScoreRef.current;
			let winnerId: string | null = null;

			if (roomMode === "creatorRoom") {
				const sortedScores = (
					Object.entries(allScoresRef.current) as [string, number][]
				).sort((a, b) => b[1] - a[1]);
				const topScore = sortedScores[0];
				const runnerUpScore = sortedScores[1];
				if (topScore && (!runnerUpScore || topScore[1] > runnerUpScore[1])) {
					winnerId = topScore[0];
				}
			} else if (roomMode === "classic") {
				winnerId = user?.uid ?? null;
			} else {
				winnerId =
					p1Final > p2Final ? (user?.uid ?? null)
					: p1Final < p2Final ? h2hOpponentId
					: null;
			}

			if (channelRef.current) {
				broadcastToRoom(channelRef.current, {
					type: "game_over",
					player1Score: p1Final,
					player2Score: p2Final,
					winnerId,
				});
			}

			const finalScoresMap: Record<string, number> = {
				...allScoresRef.current,
			};

			if (user?.uid) finalScoresMap[user.uid] = p1Final;
			if (h2hOpponentId) finalScoresMap[h2hOpponentId] = p2Final;

			const roomUpdates: Record<string, any> = {
				scores: finalScoresMap,
				status: "completed",
				winner_id: winnerId,
			};

			if (roomMode !== "creatorRoom" && roomMode !== "classic") {
				roomUpdates.player1_score = h2hIsHost ? p1Final : p2Final;
				roomUpdates.player2_score = h2hIsHost ? p2Final : p1Final;
			}

			await updateRoom(localRoom.id, roomUpdates);
			setLocalRoom(prev =>
				prev ? { ...prev, status: "completed", winner_id: winnerId, scores: finalScoresMap } : prev,
			);
			if (roomMode === "creatorRoom") {
				onRoomUpdate?.({
					...localRoom,
					status: "completed",
					winner_id: winnerId,
					scores: finalScoresMap,
				} as MatchRoom);
			}
		}

		setPhase("finished");
	}, [
		h2hIsHost,
		h2hOpponentId,
		localRoom,
		isRoomMatch,
		roomMode,
		user?.uid,
	]);

	const goToNextRound = useCallback(async () => {
		if (phaseRef.current === "finished") return;
		const nextRound = currentRoundIndex + 1;

		if (nextRound > roundCount) {
			void finishMatch();
			return;
		}

		await loadRound(nextRound);
	}, [currentRoundIndex, loadRound, roundCount, finishMatch]);

	const finalizeReveal = useCallback(async () => {
		if (phaseRef.current === "reveal" || !target) return;
		setPhase("reveal");
		clearTimers();

		const geocodeToken = ++geocodeTokenRef.current;
		if (window.google?.maps?.Geocoder) {
			const geocoder = new window.google.maps.Geocoder();
			geocoder.geocode(
				{ location: { lat: target.lat, lng: target.lng } },
				(results: any, status: any) => {
					if (geocodeTokenRef.current !== geocodeToken) return;
					if (status === "OK" && results?.[0]) {
						const addressParts = results[0].address_components ?? [];
						const city = addressParts.find((p: any) =>
							p.types.includes("locality"),
						)?.long_name;
						const country = addressParts.find((p: any) =>
							p.types.includes("country"),
						)?.long_name;
						setLocationName(
							city && country ?
								`${city}, ${country}`
							:	results[0].formatted_address,
						);
					} else {
						setLocationName("Unknown Location");
					}
				},
			);
		} else {
			setLocationName("Unknown Location");
		}

		const nextRoundNumber = currentRoundIndex + 1;
		if (nextRoundNumber <= roundCount) {
			const nextTarget = await getTargetForRound(
				nextRoundNumber,
				roomMode,
				roundCount,
			);
			if (nextTarget) {
				void preloadRound(nextRoundNumber, nextTarget).catch(() => {});
			}
			void ensureTargetsAhead(currentRoundIndex, roomMode, roundCount, 3);
		}

		nextRoundTimerRef.current = window.setTimeout(() => {
			if (currentRoundIndex >= roundCount) {
				void finishMatch();
				return;
			}

			void goToNextRound();
		}, 12000); // 12 seconds reveal duration!
	}, [
		clearTimers,
		currentRoundIndex,
		ensureTargetsAhead,
		getTargetForRound,
		goToNextRound,
		preloadRound,
		roundCount,
		roomMode,
		target,
		finishMatch,
	]);

	const submitGuess = useCallback(
		async (forcedTimeout = false) => {
			if (phase !== "playing" && phase !== "waiting_for_others") return;
			if (!target || isSubmittingRef.current) return;

			audioManager.playSfx("guessSubmit");

			isSubmittingRef.current = true;
			setIsSubmitting(true);

			const usedGuess = guess;
			const clientDistanceKm = usedGuess ? haversineKm(usedGuess, target) : 20000;
			const clientScore =
				forcedTimeout || !usedGuess ? 0 : (
					calculateScore(clientDistanceKm, remainingSec, roundSeconds, roomMode !== "classic" && localRoom?.enable_time_multiplier !== false)
				);

			let verifiedScore = clientScore;
			let verifiedDistanceKm = clientDistanceKm;
			let verifiedTarget = { lat: target.lat, lng: target.lng };

			try {
				const telemetry = getTelemetry();

				const { data, error } = await supabase.rpc("submit_match_guess", {
					p_room_id: backingRoomId,
					p_round: currentRoundIndex,
					p_guess_lat: usedGuess ? usedGuess.lat : null,
					p_guess_lng: usedGuess ? usedGuess.lng : null,
					p_time_left: forcedTimeout || !usedGuess ? 0 : remainingSec,
					p_telemetry: telemetry,
				});

				if (error) {
					console.error("Error calling submit_match_guess RPC:", error);
					toast.error("Failed to submit guess to server. Match sync may be affected.");
					void logSystemError("submit_match_guess RPC failure", {
						roomId: backingRoomId,
						round: currentRoundIndex,
						error: error.message,
						code: error.code,
					});
				} else if (data) {
					if (data.cheat_detected) {
						toast.error(`Suspicious activity flagged: ${data.reason || "Validation failed"}`);
					}
					verifiedScore = data.score;
					verifiedDistanceKm = data.distance_km;
					if (data.target) {
						verifiedTarget = data.target;
					}
				}
			} catch (err) {
				console.error("Failed to run guess validation on server:", err);
				toast.error("Failed to run guess validation on server. Match sync may be affected.");
				void logSystemError("submit_match_guess RPC exception", {
					roomId: backingRoomId,
					round: currentRoundIndex,
					error: err instanceof Error ? err.message : String(err),
				});
			}

			const result: RoundResult = {
				round: currentRoundIndex,
				player: 1,
				guess: usedGuess,
				target: verifiedTarget,
				distanceKm: verifiedDistanceKm,
				score: verifiedScore,
				timeLeft: remainingSec,
			};

			const nextTotalScore = totalScoreRef.current + verifiedScore;
			totalScoreRef.current = nextTotalScore;

			setCurrentResult(result);
			setHistory(prev => [...prev, result]);
			setTotalScore(nextTotalScore);
			setLocationName("");

			if (isRoomMatch && channelRef.current && roomMode !== "classic") {
				broadcastToRoom(channelRef.current, {
					type: "guess_submitted",
					userId: user?.uid ?? "",
					round: currentRoundIndex,
					score: verifiedScore,
					distanceKm: verifiedDistanceKm,
					guess: usedGuess,
				});

				if (user?.uid) {
					setAllScores(prev => {
						const next = { ...prev, [user.uid]: nextTotalScore };
						allScoresRef.current = next;
						return next;
					});

					setRoundSubmissions(prev => {
						const next = { ...prev };
						if (!next[currentRoundIndex]) next[currentRoundIndex] = {};
						next[currentRoundIndex] = {
							...next[currentRoundIndex],
							[user.uid]: { score: verifiedScore, guess: usedGuess },
						};
						roundSubmissionsRef.current = next;
						return next;
					});
				}

				setPhase("waiting_for_others");
			} else {
				void finalizeReveal();
			}
		},
		[
			currentRoundIndex,
			guess,
			isRoomMatch,
			phase,
			remainingSec,
			roundSeconds,
			target,
			user?.uid,
			finalizeReveal,
			pans,
			zooms,
			blurs,
			backingRoomId,
			roomMode,
		],
	);

	useEffect(() => {
		if (phase === "waiting_for_others" && isRoomMatch) {
			let isEveryoneDone = true;
			const currentSubs = roundSubmissions[currentRoundIndex] || {};

			if (selectedMode === "headToHead" && localRoom) {
				const expected = localRoom.participants || [];
				if (expected.length === 0) isEveryoneDone = false;
				for (const pid of expected) {
					if (!currentSubs[pid]) {
						isEveryoneDone = false;
						break;
					}
				}
			} else {
				const actives = Array.from(activeParticipantsRef.current);
				if (actives.length > 0) {
					for (const pid of actives) {
						if (!currentSubs[pid]) {
							isEveryoneDone = false;
							break;
						}
					}
				} else {
					isEveryoneDone = false;
				}
			}

			if (isEveryoneDone) {
				void finalizeReveal();
			}
		}
	}, [
		phase,
		isRoomMatch,
		roundSubmissions,
		currentRoundIndex,
		activeParticipants,
		localRoom,
		selectedMode,
		finalizeReveal,
	]);

	useEffect(() => {
		if (!user?.uid || hasRestoredRef.current || initStartedRef.current) return;
		initStartedRef.current = true;

		const init = async () => {
			const savedProgressRaw = localStorage.getItem(`geozora_match_progress_${user.uid}`);
			if (savedProgressRaw) {
				try {
					const saved = JSON.parse(savedProgressRaw);
					const isMatchingRoom = isRoomMatch && localRoom && saved.backingRoomId === localRoom.id;
					
					if (isMatchingRoom) {
						hasRestoredRef.current = true;

						const resolvedRounds = getResolvedRoundCount(selectedMode);
						const resolvedSeconds = getResolvedRoundSeconds(selectedMode);
						setRoundCount(resolvedRounds);
						setRoundSeconds(resolvedSeconds);

						let restoredRound = saved.currentRoundIndex;
						let restoredHistory = [...(saved.history || [])];
						const serverRound = localRoom.current_round;

						if (serverRound > restoredRound) {
							// Client is behind the server round. Backfill missing rounds with 0 score.
							for (let r = restoredRound; r < serverRound; r++) {
								const targetForMissedRound = localRoom.targets?.[r - 1];
								restoredHistory.push({
									round: r,
									player: 1,
									guess: null,
									target: targetForMissedRound ? { lat: targetForMissedRound.lat, lng: targetForMissedRound.lng } : { lat: 0, lng: 0 },
									distanceKm: 20000,
									score: 0,
									timeLeft: 0,
								});
							}
							restoredRound = serverRound;
							saved.currentRoundIndex = serverRound;
							saved.history = restoredHistory;
							saved.phase = "playing";
							saved.remainingSec = resolvedSeconds;
							saved.target = localRoom.targets?.[serverRound - 1] || null;
							saved.guess = null;
						}

						setCurrentRoundIndex(saved.currentRoundIndex);
						setTotalScore(saved.totalScore);
						setHistory(saved.history);

						const finalPhase = saved.phase;
						if (finalPhase === "reveal") {
							setPhase("playing");
							phaseRef.current = "playing";
						} else {
							setPhase(finalPhase);
							phaseRef.current = finalPhase;
						}

						setBackingRoomId(saved.backingRoomId);
						setTarget(saved.target);
						setGuess(saved.guess);
						setRemainingSec(saved.remainingSec);
						setOpponentScore(saved.opponentScore);
						setOpponentRoundDone(saved.opponentRoundDone);
						if (saved.roundSubmissions) {
							setRoundSubmissions(saved.roundSubmissions);
							roundSubmissionsRef.current = saved.roundSubmissions;
						}
						if (saved.allScores) {
							setAllScores(saved.allScores);
							allScoresRef.current = saved.allScores;
						}
						resetTelemetry(Date.now() - (resolvedSeconds - saved.remainingSec) * 1000);
						
						// Restore the Street View panorama for the recovered target
						if (saved.target) {
							void showRound(saved.currentRoundIndex, saved.target);
						}

						if (finalPhase === "reveal") {
							void finalizeReveal();
						}

						// Check if targets are truncated and we need to finish generating them (e.g. if reload aborted generation)
						const currentTargetsCount = localRoom.targets?.length ?? 0;
						const isHostOrSolo = localRoom.player1_id === user.uid;
						if (isHostOrSolo && currentTargetsCount < resolvedRounds && API_KEY) {
							void (async () => {
								try {
									const remainingTargets = await generateTargets(
										API_KEY,
										stableSelectedMaps,
										resolvedRounds - currentTargetsCount,
										selectedMode
									);
									const combinedTargets = [...(localRoom.targets || []), ...remainingTargets];
									
									await updateRoom(localRoom.id, {
										targets: combinedTargets,
									});
									
									setLocalRoom(prev => prev ? { ...prev, targets: combinedTargets } : null);
								} catch (backgroundError) {
									console.error("Failed to restore background targets on reload:", backgroundError);
								}
							})();
						}

						return; // Skip startSession!
					}
				} catch (e) {
					console.warn("Failed to restore saved progress:", e);
				}
			}

			let activeTargets: StreetViewTarget[] | undefined = undefined;
			if (isRoomMatch && localRoom && (!localRoom.targets || localRoom.targets.length === 0)) {
				let attempts = 0;
				let latestRoom = null;
				while (attempts < 5) {
					latestRoom = await fetchRoom(localRoom.id);
					if (latestRoom && latestRoom.targets && latestRoom.targets.length > 0) {
						setLocalRoom(latestRoom);
						activeTargets = latestRoom.targets;
						break;
					}
					attempts++;
					await new Promise(resolve => setTimeout(resolve, 1000));
				}
				if (!latestRoom || !latestRoom.targets || latestRoom.targets.length === 0) {
					toast.error("Failed to load match targets from server.");
					setPhase("finished");
					return;
				}
			}
			void startSession(selectedMode, activeTargets);
		};
		void init();

		return () => clearTimers();
	}, [clearTimers, selectedMode, startSession, user?.uid, isRoomMatch, localRoom, resetTelemetry, getResolvedRoundSeconds, stableSelectedMaps, finalizeReveal]);

	useEffect(() => {
		if (phase !== "playing" || streetViewLoading) return;

		const timer = window.setInterval(() => {
			setRemainingSec(prev => Math.max(0, prev - 1));
		}, 1000);

		return () => window.clearInterval(timer);
	}, [phase, streetViewLoading]);

	useEffect(() => {
		if (phase === "playing" && remainingSec <= 0 && !isSubmittingRef.current) {
			void submitGuess(true);
		}
	}, [phase, remainingSec, submitGuess]);

	useEffect(() => {
		if (phase !== "playing" || !target || streetViewLoading) return;

		setShowHint(true);

		if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current);

		hintTimerRef.current = window.setTimeout(() => setShowHint(false), 3000);

		return () => {
			if (hintTimerRef.current) {
				window.clearTimeout(hintTimerRef.current);
				hintTimerRef.current = null;
			}
		};
	}, [currentRoundIndex, phase, streetViewLoading, target]);

	const handleModeSelect = (nextMode: GameModeId) => {
		if (nextMode !== selectedMode) onModeChange?.(nextMode);
	};

	const restartCurrentMode = async () => {
		if (selectedMode === "chaos") {
			setPhase("finished");
			return;
		}

		if (selectedMode === "headToHead") {
			onFindNewH2HMatch?.();
			return;
		}

		if (isRoomMatch && localRoom && selectedMode !== "classic") {
			if (h2hIsHost && API_KEY) {
				if (selectedMode === "creatorRoom") {
					if (channelRef.current) {
						broadcastToRoom(channelRef.current, { type: "reset_match" });
					}
					const resetPayload = {
						player1_score: 0,
						player2_score: 0,
						scores: {},
						ready_states: {},
						status: "waiting" as const,
						winner_id: null,
						current_round: 0,
						targets: [],
					};
					await updateRoom(localRoom.id, resetPayload);
					onRoomUpdate?.({
						...localRoom,
						...resetPayload,
					} as MatchRoom);

					setIsInvalidMatch(false);
					creatorPresenceSyncedRef.current = false;
					creatorPresenceObservedRef.current = false;
					creatorPresenceSyncCountRef.current = 0;
					invalidMatchHandledRef.current = false;
					onRoomReset?.();
					return;
				}
				const newTargets = await generateTargets(
					API_KEY,
					stableSelectedMaps,
					getResolvedRoundCount(selectedMode),
					selectedMode
				);

				if (channelRef.current) {
					broadcastToRoom(channelRef.current, {
						type: "reset_match",
						targets: newTargets,
					});
				}
				await updateRoom(localRoom.id, {
					player1_score: 0,
					player2_score: 0,
					scores: {},
					status: "waiting",
					winner_id: null,
					current_round: 0,
					targets: newTargets as any,
				});

				// Update local object so startSession has latest
				setLocalRoom(prev => (prev ? { ...prev, targets: newTargets } : null));
			} else if (!h2hIsHost) {
				// Just wait for host to re-seed and trigger start in the background.
				// Actually, the channel broadcast 'reset_match' handles letting the client know.
				return;
			}
		}

		setPhase("loading");
		setTarget(null);
		setCurrentResult(null);
		setGuess(null);
		setLocationName("");

		await startSession(selectedMode);
	};

	// Audio hook triggers for game phases
	useEffect(() => {
		if (phase === "reveal" && currentResult) {
			audioManager.playSfx("reveal", currentResult.score);
		} else if (phase === "finished") {
			audioManager.playSfx("gameOver");
		}
	}, [phase, currentResult]);

	useEffect(() => {
		if (phase === "playing" && remainingSec <= 10 && remainingSec > 0) {
			audioManager.playSfx("tick");
		}
	}, [phase, remainingSec]);

	const shouldShowStreetView =
		phase === "playing" || phase === "reveal" || phase === "waiting_for_others";

	const shouldShowLoadingOverlay =
		phase === "loading" || (phase === "playing" && streetViewLoading);

	if (!user) {
		return (
			<div className="absolute inset-0 flex items-center justify-center bg-[var(--color-app-bg)] text-white p-6">
				<div className="max-w-md text-center">
					<h2 className="text-2xl font-bold tracking-tight">Login Required</h2>
					<p className="text-[var(--color-app-text-muted)] mt-3">
						You must be logged in to play a match.
					</p>
				</div>
			</div>
		);
	}

	if (!API_KEY) {
		return (
			<div className="absolute inset-0 flex items-center justify-center bg-[var(--color-app-bg)] text-white p-6">
				<div className="max-w-md text-center rounded-3xl border border-white/10 bg-white/5 p-8">
					<h2 className="text-2xl font-bold tracking-tight">
						Google Maps Key Required
					</h2>
					<p className="text-[var(--color-app-text-muted)] mt-3">
						Add{" "}
						<code className="text-white">VITE_GOOGLE_MAPS_PLATFORM_KEY</code> in
						your environment to load Street View.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="absolute inset-0 bg-[#080B14] text-[var(--color-app-text)] font-sans">
			<div className="relative flex h-full w-full overflow-hidden">
				<div className="relative min-w-0 flex-1 w-full">
					<div
						ref={containerARef}
						className={cn(
							"absolute inset-0 bg-[#070B12] transition-opacity duration-300",
							shouldShowStreetView && activeSlot === "A" ?
								"z-[1] opacity-100"
							:	"z-0 opacity-0 pointer-events-none",
						)}
					/>

					<div
						ref={containerBRef}
						className={cn(
							"absolute inset-0 bg-[#070B12] transition-opacity duration-300",
							shouldShowStreetView && activeSlot === "B" ?
								"z-[1] opacity-100"
							:	"z-0 opacity-0 pointer-events-none",
						)}
					/>

					{shouldShowLoadingOverlay && (
						<MatchLoadingOverlay
							title={
								phase === "loading" ? "Preparing Match" : (
									"Preparing Street View"
								)
							}
							subtitle={
								phase === "loading" ?
									"Generating locations and warming up Street View."
								:	"Loading the next panorama for a smoother round."
							}
							onExit={handleQuitClick}
						/>
					)}

					<MatchHud
						currentRoundIndex={currentRoundIndex}
						roundCount={roundCount}
						remainingSec={remainingSec}
						totalScore={totalScore}
						opponentScore={opponentScore}
						phase={phase}
						selectedMode={selectedMode}
						streetViewLoading={streetViewLoading}
						heading={heading}
						showHint={showHint}
						onQuit={handleQuitClick}
						onReport={() => setIsReportModalOpen(true)}
						isRoomMatch={isRoomMatch}
					/>

					{phase === "reveal" && currentResult && target && (
						<MatchRevealOverlay
							currentRoundIndex={currentRoundIndex}
							currentResult={currentResult}
							guess={guess}
							target={target}
							isGoogleLoaded={isGoogleLoaded}
							selectedMaps={stableSelectedMaps}
							mapType={user?.mapPreference || "roadmap"}
							userAvatar={user?.avatarUrl || user?.photoURL}
							distanceMetric={user?.distanceMetric || "km"}
							locationName={locationName}
							onNext={handleNextRoundSkip}
							mode={selectedMode}
							totalRounds={roundCount}
							standings={revealStandings}
							opponentResults={Object.entries(
								roundSubmissions[currentRoundIndex] || {},
							)
								.filter(
									([uid, data]: [string, any]) =>
										uid !== user?.uid && data.guess,
								)
								.map(([uid, data]: [string, any], idx) => ({
									guess: data.guess!,
									target: target!,
									userId: uid,
									playerIndex: idx,
									round: currentRoundIndex,
								}))}
						/>
					)}
				</div>

				{phase !== "finished" && (
					<MatchSidebar
						mode={selectedMode}
						currentRoundIndex={currentRoundIndex}
						roundCount={roundCount}
						roundSeconds={roundSeconds}
						remainingSec={remainingSec}
						totalScore={totalScore}
						playerTotals={playerTotals}
						allScores={allScores}
						roundScores={Object.fromEntries(
							Object.entries(roundSubmissions[currentRoundIndex] || {}).map(
								([uid, d]: [string, any]) => [uid, d.score],
							),
						)}
						history={history}
						phase={phase}
						target={target}
						guess={guess}
						onGuess={setGuess}
						onSubmit={() => submitGuess(false)}
						onNext={goToNextRound}
						onRestart={restartCurrentMode}
						onSelectMode={handleModeSelect}
						onStartCreatorRoom={() => onModeChange?.("creatorRoom")}
						customRounds={customRounds}
						setCustomRounds={() => {}}
						customSeconds={customSeconds}
						setCustomSeconds={() => {}}
						showTips={showTips}
						setShowTips={setShowTips}
						winnerText={winnerText}
						activePlayerLabel={activePlayerLabel}
						sidebarOpen={true}
						isMapLoaded={isGoogleLoaded}
						selectedMaps={stableSelectedMaps}
						distanceMetric={user?.distanceMetric || "km"}
						mapPreference={user?.mapPreference || "roadmap"}
						userAvatar={user?.avatarUrl || user?.photoURL}
						streetViewLoading={streetViewLoading}
						isSubmitting={isSubmitting}
						room={localRoom}
						isHost={h2hIsHost}
						activeParticipants={activeParticipants}
						participantNames={participantNames}
					/>
				)}
			</div>

			{phase === "finished" && (
				<MatchFinishedOverlay
					displayName={user?.displayName}
					totalScore={totalScore}
					history={history}
					distanceMetric={user?.distanceMetric || "km"}
					isGoogleLoaded={isGoogleLoaded}
					selectedMaps={stableSelectedMaps}
					mapType={user?.mapPreference || "roadmap"}
					userAvatar={user?.avatarUrl || user?.photoURL}
					onRestart={restartCurrentMode}
					onBackToDashboard={onBackToDashboard}
					isRoomMatch={isRoomMatch && selectedMode !== "classic"}
					winnerId={localRoom?.winner_id}
					userId={user?.uid}
					matchEndedReason={matchEndedReason}
					standings={revealStandings}
					roundSubmissions={roundSubmissions}
					isHost={h2hIsHost}
					isCreatorRoom={selectedMode === "creatorRoom"}
					room={localRoom}
				/>
			)}

			<ReportModal
				isOpen={isReportModalOpen}
				onClose={() => setIsReportModalOpen(false)}
				target={target}
			/>

			{phase === "playing" && remainingSec <= 10 && remainingSec > 0 && (
				<div className="fixed inset-0 pointer-events-none z-[100] border-8 border-red-500/40 animate-pulse shadow-[inset_0_0_40px_rgba(239,68,68,0.7)]" />
			)}

			{showQuitConfirm && (
				<div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
					<div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-2xl backdrop-blur-md">
						<h3 className="text-xl font-bold text-white mb-2">Leave Match?</h3>
						<p className="text-slate-300 mb-6 text-sm leading-relaxed">
							Are you sure you want to quit? You will forfeit the match and lose
							any progress.
						</p>
						<div className="flex justify-end gap-3">
							<button
								onClick={() => setShowQuitConfirm(false)}
								className="px-4 py-2 rounded-lg border border-white/10 text-slate-300 hover:bg-white/5 transition-all text-sm font-semibold cursor-pointer">
								Cancel
							</button>
							<button
								onClick={() => {
									setShowQuitConfirm(false);
									if (user?.uid) {
										localStorage.removeItem(`geozora_match_progress_${user.uid}`);
									}
									if (selectedMode === "classic" && backingRoomId) {
										void supabase
											.from("match_rooms")
											.delete()
											.eq("id", backingRoomId);
									} else if (selectedMode === "headToHead" && backingRoomId) {
										if (channelRef.current) {
											broadcastToRoom(channelRef.current, {
												type: "game_over",
												player1Score: totalScoreRef.current,
												player2Score: opponentScoreRef.current,
												winnerId: h2hOpponentId,
												reason: "Opponent disconnected.",
											} as any);
										}
										const finalScoresMap = { ...allScoresRef.current };
										if (user?.uid) finalScoresMap[user.uid] = -1;
										void updateRoom(backingRoomId, {
											status: "completed",
											winner_id: h2hOpponentId,
											scores: finalScoresMap,
										});
									}
									onBackToDashboard?.();
								}}
								className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-all text-sm font-semibold shadow-lg shadow-red-600/20 cursor-pointer">
								Confirm Leave
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
