export type CachedUserPreferences = {
	distanceMetric?: string;
	mapPreference?: string;
};

const USER_SETTINGS_PREFIX = "geozora_user_settings";
const GUEST_SETTINGS_KEY = "geozora_guest_settings";

function canUseStorage(): boolean {
	return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function userKey(userId: string): string {
	return `${USER_SETTINGS_PREFIX}:${userId}`;
}

function readKey(key: string): CachedUserPreferences | null {
	if (!canUseStorage()) return null;

	const raw = localStorage.getItem(key);
	if (!raw) return null;

	try {
		return JSON.parse(raw) as CachedUserPreferences;
	} catch {
		return null;
	}
}

function writeKey(key: string, value: CachedUserPreferences): void {
	if (!canUseStorage()) return;

	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch (err) {
		console.warn("Failed to save cached user preferences:", err);
	}
}

export function loadCachedUserPreferences(
	userId: string | null | undefined,
	isAnonymous = false,
): CachedUserPreferences | null {
	if (!userId && !isAnonymous) return null;

	const direct = userId ? readKey(userKey(userId)) : null;
	if (direct) return direct;

	if (isAnonymous) {
		return readKey(GUEST_SETTINGS_KEY);
	}

	return null;
}

export function saveCachedUserPreferences(
	userId: string | null | undefined,
	preferences: CachedUserPreferences,
	isAnonymous = false,
): void {
	if (!userId && !isAnonymous) return;

	if (userId) {
		writeKey(userKey(userId), preferences);
	}

	if (isAnonymous || !userId) {
		writeKey(GUEST_SETTINGS_KEY, preferences);
	}
}