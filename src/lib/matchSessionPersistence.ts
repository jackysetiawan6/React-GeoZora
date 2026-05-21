export type MatchSessionTab = "RoomLobby" | "Match";

export type MatchSessionMode = "headToHead" | "creatorRoom";

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

function canUseStorage(): boolean {
	return typeof window !== "undefined" && typeof localStorage !== "undefined";
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
		return JSON.parse(raw) as MatchSessionSnapshot;
	} catch {
		localStorage.removeItem(SESSION_KEY);
		return null;
	}
}

export function clearMatchSession(): void {
	if (!canUseStorage()) return;
	localStorage.removeItem(SESSION_KEY);
}
