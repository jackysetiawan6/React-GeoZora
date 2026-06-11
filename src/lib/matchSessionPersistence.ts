export type MatchSessionTab = "RoomLobby" | "Match";

export type MatchSessionMode = "headToHead" | "creatorRoom" | "classic";

export interface MatchSessionSnapshot {
	userId: string;
	roomId: string;
	mode: MatchSessionMode;
	tab: MatchSessionTab;
	isHost: boolean;
	opponentId?: string | null;
	opponentElo?: number | null;
	lastUpdatedAt: string;
}

const SESSION_KEY = "geozora_active_match_session";

const VALID_MODES = new Set<MatchSessionMode>(["headToHead", "creatorRoom", "classic"]);
const VALID_TABS = new Set<MatchSessionTab>(["RoomLobby", "Match"]);

function canUseStorage(): boolean {
	return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/**
 * Validate that a parsed object has the expected shape of MatchSessionSnapshot.
 * Guards against corrupted or tampered localStorage data.
 */
function isValidMatchSession(data: unknown): data is MatchSessionSnapshot {
	if (!data || typeof data !== "object") return false;
	const d = data as Record<string, unknown>;
	return (
		typeof d.userId === "string" && d.userId.length > 0 &&
		typeof d.roomId === "string" && d.roomId.length > 0 &&
		typeof d.mode === "string" && VALID_MODES.has(d.mode as MatchSessionMode) &&
		typeof d.tab === "string" && VALID_TABS.has(d.tab as MatchSessionTab) &&
		typeof d.isHost === "boolean" &&
		typeof d.lastUpdatedAt === "string"
	);
}

export function saveMatchSession(
	snapshot: Omit<MatchSessionSnapshot, "lastUpdatedAt">,
): void {
	if (!canUseStorage()) return;

	const payload: MatchSessionSnapshot = {
		...snapshot,
		lastUpdatedAt: new Date().toISOString(),
	};

	try {
		localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
	} catch (e) {
		console.warn("Failed to save match session to localStorage:", e);
	}
}

export function loadMatchSession(): MatchSessionSnapshot | null {
	if (!canUseStorage()) return null;

	const raw = localStorage.getItem(SESSION_KEY);
	if (!raw) return null;

	try {
		const parsed: unknown = JSON.parse(raw);
		if (!isValidMatchSession(parsed)) {
			console.warn("Match session data is invalid or corrupted — clearing.");
			localStorage.removeItem(SESSION_KEY);
			return null;
		}
		return parsed;
	} catch {
		localStorage.removeItem(SESSION_KEY);
		return null;
	}
}

export function clearMatchSession(): void {
	if (!canUseStorage()) return;
	localStorage.removeItem(SESSION_KEY);
}
