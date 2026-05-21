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
	type MatchRoom,
	type H2HMessage,
} from "../lib/Matchmaking";
import {
	createRoomPresenceMonitor,
	type RoomPresenceMonitor,
} from "../lib/RoomPresenceMonitor";
import { supabase } from "../lib/supabase";
import { toast } from "sonner";
import {
	clearMatchSession,
	saveMatchSession,
} from "../lib/matchSessionPersistence";

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
	onFindNewH2HMatch,
	h2hRoom = null,
	h2hOpponentId = null,
	h2hOpponentElo = 1300,
	h2hIsHost = false,
}: MatchProps) {
	const { user } = useAuth();

	const [phase, setPhase] = useState<GamePhase>("loading");
	const [currentRoundIndex, setCurrentRoundIndex] = useState(0);

	const [localRoom, setLocalRoom] = useState<MatchRoom | null | undefined>(h2hRoom);
	useEffect(() => {
		setLocalRoom(h2hRoom);
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
	const [opponentScore, setOpponentScore] = useState(0);
	const [opponentRoundDone, setOpponentRoundDone] = useState(false);
	const [statsSaved, setStatsSaved] = useState(false);

	const [matchEndedReason, setMatchEndedReason] = useState<string | null>(null);

	const [activeParticipants, setActiveParticipants] = useState<Set<string>>(
		new Set(),
	);

	type SubmissionsMap = Record<
		number,
		Record<
			string,
			{ score: number; guess: { lat: number; lng: number } | null }
		>
	>;
	const [roundSubmissions, setRoundSubmissions] = useState<SubmissionsMap>({});
	const roundSubmissionsRef = useRef<SubmissionsMap>({});

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
		void goToNextRound();
	};

	const isH2H = selectedMode === "headToHead" && localRoom !== null;
	const isCreator = selectedMode === "creatorRoom" && localRoom !== null;
	const isRoomMatch = isH2H || isCreator;

	const selectedMapsKey = useMemo(() => selectedMaps.join("|"), [selectedMaps]);

	const stableSelectedMaps = useMemo(() => {
		return selectedMaps;
	}, [selectedMapsKey]);

	const roomTargets = useMemo(() => {
		return localRoom?.targets ?? [];
	}, [localRoom?.targets]);

	const {
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
		[isRoomMatch, localRoom?.no_moving, localRoom?.no_panning, localRoom?.no_zooming],
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
	});

	// Note: Anti-cheat keyboard shortcut and right-click blocks have been removed
	// to respect user control and standard browser accessibility.

	useEffect(() => {
		activeParticipantsRef.current = activeParticipants;
	}, [activeParticipants]);

	useEffect(() => {
		phaseRef.current = phase;
	}, [phase]);

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

		saveMatchSession({
			userId: user.uid,
			roomId: localRoom.id,
			mode: isCreator ? "creatorRoom" : "headToHead",
			tab: "Match",
			isHost: h2hIsHost,
			opponentId: h2hOpponentId,
			opponentElo: h2hOpponentElo,
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
		if (selectedMode === "creatorRoom")
			return "Configure the room and start your match.";
		if (selectedMode === "chaos") return "Chaos Mode is coming soon.";

		return "";
	}, [history.length, isRoomMatch, playerTotals, selectedMode, totalScore]);

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
			!user?.uid ||
			history.length === 0
		) {
			return;
		}

		setStatsSaved(true);

		const saveStats = async () => {
			if (!user) return;
			const realDuration = matchStartTimeRef.current ?
				Math.round((Date.now() - matchStartTimeRef.current) / 1000)
			:	null;

			if (isH2H && localRoom && h2hOpponentId) {
				const result: "win" | "loss" | "draw" =
					totalScore > opponentScore ? "win"
					: totalScore < opponentScore ? "loss"
					: "draw";

				// Fetch player ELO before update
				const playerStats = await fetchPlayerStats(user.uid);
				const playerElo = playerStats?.elo ?? 1300;

				await updateStatsAfterH2H(
					user.uid,
					h2hOpponentElo,
					totalScore,
					history.length,
					result,
				);

				const isPlayer1 = localRoom.player1_id === user.uid;
				const eloChange = calculateEloChange(
					playerElo,
					h2hOpponentElo,
					result,
				);

				const playerExpGain = calculateExpGain(
					"headToHead",
					totalScore,
					result,
				);
				const opponentExpGain = calculateExpGain(
					"headToHead",
					opponentScore,
					result === "win" ? "loss"
					: result === "loss" ? "win"
					: "draw",
				);

				await saveMatchHistory(
					localRoom.player1_id || user.uid,
					localRoom.player2_id || h2hOpponentId,
					user.displayName || "Player",
					"Opponent",
					isPlayer1 ? totalScore : opponentScore,
					isPlayer1 ? opponentScore : totalScore,
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
			} else if (selectedMode === "classic") {
				const expGain = calculateExpGain("classic", totalScore);
				await updateStatsAfterClassic(user.uid, totalScore, history.length);

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
			}
		};

		void saveStats();
	}, [
		h2hOpponentElo,
		history.length,
		isH2H,
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

		isSubmittingRef.current = false;
		setIsSubmitting(false);

		resetQueue();
		resetBuffers();
	}, [clearTimers, resetBuffers, resetQueue]);

	const startSession = useCallback(
		async (mode: GameModeId) => {
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
				await seedInitialTargets(mode, resolvedRounds, 3);

				if (requestIdRef.current !== requestId) return;

				const firstTarget = await getTargetForRound(1, mode, resolvedRounds);
				const secondTarget = await getTargetForRound(2, mode, resolvedRounds);

				if (!firstTarget) {
					setPhase("finished");
					return;
				}

				if (requestIdRef.current !== requestId) return;

				setTarget(firstTarget);
				setCurrentRoundIndex(1);
				setRemainingSec(resolvedSeconds);
				setCurrentResult(null);
				setLocationName("");
				setGuess(null);
				isSubmittingRef.current = false;
				setIsSubmitting(false);

				await initFirstRound({
					round: 1,
					target: firstTarget,
					nextTarget: secondTarget,
				});

				if (requestIdRef.current !== requestId) return;

				setPhase("playing");
				matchStartTimeRef.current = Date.now();

				void ensureTargetsAhead(1, mode, resolvedRounds, 3);
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

	useEffect(() => {
		if (!isRoomMatch || !localRoom) return;

		// Create and start presence monitor for detecting disconnections
		const monitorRef = createRoomPresenceMonitor(
			localRoom.id,
			event => {
				// Disconnection detected
				if (selectedMode === "headToHead" && event.userId === h2hOpponentId) {
					const isMidMatch =
						phaseRef.current === "playing" ||
						phaseRef.current === "reveal" ||
						phaseRef.current === "waiting_for_others";

					if (isMidMatch && event.wasActive) {
						// Opponent was active and now disconnected
						if (channelRef.current) {
							broadcastToRoom(channelRef.current, {
								type: "game_over",
								player1Score: totalScoreRef.current,
								player2Score: opponentScoreRef.current,
								winnerId: user?.uid ?? null,
								reason: "Opponent disconnected.",
							} as any);

							const finalScoresMap: Record<string, number> = {
								...allScoresRef.current,
							};
							if (user?.uid) finalScoresMap[user.uid] = totalScoreRef.current;
							finalScoresMap[h2hOpponentId] = -1;

							void updateRoom(localRoom.id, {
								status: "completed",
								winner_id: user?.uid ?? null,
								scores: finalScoresMap,
							});
						}
						setMatchEndedReason("Opponent disconnected.");
						setPhase("finished");
					}
				} else if (selectedMode === "creatorRoom" && event.wasActive) {
					// In creator room, notify about participant disconnect
					const isMidMatch =
						phaseRef.current === "playing" ||
						phaseRef.current === "reveal" ||
						phaseRef.current === "waiting_for_others";

					if (isMidMatch) {
						toast.info(`Participant ${event.userId} disconnected.`);
					}
				}
			},
			30000, // 30-second timeout
			15000, // Check every 15 seconds (optimized from 5s, reduced CPU polling)
		);

		presenceMonitorRef.current = monitorRef;

		// Presence channel for tracking active users during the match
		const presenceCh = supabase.channel(`match_presence_${localRoom.id}`, {
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
				Object.keys(state).forEach(k => {
					const presenceElements = state[k] as any[];
					if (presenceElements && presenceElements.length > 0) {
						actives.add(presenceElements[0].id || k);
					}
				});
				setActiveParticipants(actives);
				activeParticipantsRef.current = actives;

				// Update monitor with active participants
				actives.forEach(id => {
					monitorRef.updateLastSeen(id);
				});

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

				if (selectedMode === "headToHead" && localRoom && h2hOpponentId) {
					const isMidMatch =
						phaseRef.current === "playing" ||
						phaseRef.current === "reveal" ||
						phaseRef.current === "waiting_for_others";
					if (
						isMidMatch &&
						!actives.has(h2hOpponentId) &&
						actives.has(user?.uid || "")
					) {
						if (channelRef.current) {
							broadcastToRoom(channelRef.current, {
								type: "game_over",
								player1Score: totalScoreRef.current,
								player2Score: opponentScoreRef.current,
								winnerId: user?.uid ?? null,
								reason: "Opponent disconnected.",
							} as any);

							const finalScoresMap: Record<string, number> = {
								...allScoresRef.current,
							};
							if (user?.uid) finalScoresMap[user.uid] = totalScoreRef.current;
							finalScoresMap[h2hOpponentId] = -1;

							void updateRoom(localRoom.id, {
								status: "completed",
								winner_id: user?.uid ?? null,
								scores: finalScoresMap,
							});
						}
						setMatchEndedReason("Opponent disconnected.");
						setPhase("finished");
					}
				}
			})
			.subscribe(async status => {
				if (status === "SUBSCRIBED") {
					await presenceCh.track({ isPlaying: true });
				}
			});

		const ch = subscribeToRoom(localRoom.id, (msg: H2HMessage) => {
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
				setPhase("finished");
			}

			if (msg.type === "reset_match") {
				if (selectedMode === "creatorRoom") {
					onRoomReset?.();
				} else {
					// Attempt to just reload
					if (msg.targets && localRoom) {
						setLocalRoom(prev => prev ? { ...prev, targets: msg.targets as StreetViewTarget[] } : null);
					}
					setPhase("loading");
					resetMatchState();
					void startSession(selectedMode);
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
		localRoom,
		isRoomMatch,
		user?.uid,
		selectedMode,
		h2hOpponentId,
		onRoomReset,
		startSession,
	]);

	const loadRound = useCallback(
		async (roundNumber: number) => {
			const requestId = ++requestIdRef.current;
			const resolvedSeconds = getResolvedRoundSeconds(selectedMode);

			clearTimers();
			geocodeTokenRef.current += 1;

			setGuess(null);
			setCurrentResult(null);
			setLocationName("");
			setOpponentRoundDone(false);
			setShowHint(false);
			isSubmittingRef.current = false;
			setIsSubmitting(false);

			const nextTarget = await getTargetForRound(
				roundNumber,
				selectedMode,
				roundCount,
			);

			if (!nextTarget || requestIdRef.current !== requestId) return;

			setTarget(nextTarget);
			setCurrentRoundIndex(roundNumber);
			setRemainingSec(resolvedSeconds);
			setPhase("playing");

			await showRound(roundNumber, nextTarget);

			if (requestIdRef.current !== requestId) return;

			const nextPreloadTarget = await getTargetForRound(
				roundNumber + 1,
				selectedMode,
				roundCount,
			);

			if (nextPreloadTarget) {
				void preloadRound(roundNumber + 1, nextPreloadTarget).catch(() => {});
			}

			void ensureTargetsAhead(roundNumber, selectedMode, roundCount, 3);
		},
		[
			clearTimers,
			ensureTargetsAhead,
			getResolvedRoundSeconds,
			getTargetForRound,
			preloadRound,
			roundCount,
			selectedMode,
			showRound,
		],
	);

	const goToNextRound = useCallback(async () => {
		const nextRound = currentRoundIndex + 1;

		if (nextRound > roundCount) {
			setPhase("finished");
			return;
		}

		await loadRound(nextRound);
	}, [currentRoundIndex, loadRound, roundCount]);

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
				selectedMode,
				roundCount,
			);
			if (nextTarget) {
				void preloadRound(nextRoundNumber, nextTarget).catch(() => {});
			}
			void ensureTargetsAhead(currentRoundIndex, selectedMode, roundCount, 3);
		}

		nextRoundTimerRef.current = window.setTimeout(() => {
			if (currentRoundIndex >= roundCount) {
				if (isRoomMatch && channelRef.current && localRoom) {
					const p1Final = totalScoreRef.current;
					const p2Final = opponentScoreRef.current;

					const winnerId =
						p1Final > p2Final ? (user?.uid ?? null)
						: p1Final < p2Final ? h2hOpponentId
						: null;

					broadcastToRoom(channelRef.current, {
						type: "game_over",
						player1Score: p1Final,
						player2Score: p2Final,
						winnerId,
					});

					const finalScoresMap: Record<string, number> = {
						...allScoresRef.current,
					};

					if (user?.uid) finalScoresMap[user.uid] = p1Final;
					if (h2hOpponentId) finalScoresMap[h2hOpponentId] = p2Final;

					void updateRoom(localRoom.id, {
						player1_score: h2hIsHost ? p1Final : p2Final,
						player2_score: h2hIsHost ? p2Final : p1Final,
						scores: finalScoresMap,
						status: "completed",
						winner_id: winnerId,
					});
				}

				setPhase("finished");
				return;
			}

			void goToNextRound();
		}, 7000);
	}, [
		clearTimers,
		currentRoundIndex,
		ensureTargetsAhead,
		getTargetForRound,
		goToNextRound,
		h2hIsHost,
		h2hOpponentId,
		localRoom,
		isRoomMatch,
		preloadRound,
		roundCount,
		selectedMode,
		target,
		user?.uid,
	]);

	const submitGuess = useCallback(
		async (forcedTimeout = false) => {
			if (phase !== "playing" && phase !== "waiting_for_others") return;
			if (!target || isSubmittingRef.current) return;

			isSubmittingRef.current = true;
			setIsSubmitting(true);

			const usedGuess = guess;
			const distanceKm = usedGuess ? haversineKm(usedGuess, target) : 20000;
			const score =
				forcedTimeout || !usedGuess ? 0 : (
					calculateScore(distanceKm, remainingSec, roundSeconds)
				);

			const result: RoundResult = {
				round: currentRoundIndex,
				player: 1,
				guess: usedGuess,
				target: {
					lat: target.lat,
					lng: target.lng,
				},
				distanceKm,
				score,
				timeLeft: remainingSec,
			};

			const nextTotalScore = totalScoreRef.current + score;
			totalScoreRef.current = nextTotalScore;

			setCurrentResult(result);
			setHistory(prev => [...prev, result]);
			setTotalScore(nextTotalScore);
			setLocationName("");

			if (isRoomMatch && channelRef.current) {
				broadcastToRoom(channelRef.current, {
					type: "guess_submitted",
					userId: user?.uid ?? "",
					round: currentRoundIndex,
					score,
					distanceKm,
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
							[user.uid]: { score, guess: usedGuess },
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
		if (!user?.uid) return;

		void startSession(selectedMode);

		return () => clearTimers();
	}, [clearTimers, selectedMode, startSession, user?.uid]);

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

		if (isRoomMatch && localRoom) {
			if (h2hIsHost && API_KEY) {
				if (selectedMode === "creatorRoom") {
					if (channelRef.current) {
						broadcastToRoom(channelRef.current, { type: "reset_match" });
					}
					await updateRoom(localRoom.id, {
						player1_score: 0,
						player2_score: 0,
						scores: {},
						status: "waiting",
						winner_id: null,
						current_round: 0,
						targets: [],
					});
					onRoomReset?.();
					return;
				}

				const { generateTargets } = await import("../lib/Matchmaking");
				const newTargets = await generateTargets(
					API_KEY,
					stableSelectedMaps,
					getResolvedRoundCount(selectedMode),
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
				setLocalRoom(prev => prev ? { ...prev, targets: newTargets } : null);
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
				/>

				{isRoomMatch && localRoom && (
					<ChatPanel room={localRoom} isHost={h2hIsHost} phase={phase} />
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
					isRoomMatch={isRoomMatch}
					winnerId={localRoom?.winner_id}
					userId={user?.uid}
					matchEndedReason={matchEndedReason}
					roundSubmissions={roundSubmissions}
				/>
			)}

			<ReportModal
				isOpen={isReportModalOpen}
				onClose={() => setIsReportModalOpen(false)}
				target={target}
			/>

			{showQuitConfirm && (
				<div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
					<div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-2xl backdrop-blur-md">
						<h3 className="text-xl font-bold text-white mb-2">Leave Match?</h3>
						<p className="text-slate-300 mb-6 text-sm leading-relaxed">
							Are you sure you want to quit? You will forfeit the match and lose any progress.
						</p>
						<div className="flex justify-end gap-3">
							<button
								onClick={() => setShowQuitConfirm(false)}
								className="px-4 py-2 rounded-lg border border-white/10 text-slate-300 hover:bg-white/5 transition-all text-sm font-semibold cursor-pointer"
							>
								Cancel
							</button>
							<button
								onClick={() => {
									setShowQuitConfirm(false);
									onBackToDashboard?.();
								}}
								className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-all text-sm font-semibold shadow-lg shadow-red-600/20 cursor-pointer"
							>
								Confirm Leave
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
