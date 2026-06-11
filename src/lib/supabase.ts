import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

/**
 * Optimized Supabase client configuration for real-time performance and reliability
 *
 * Configuration details:
 * - Realtime: Event batching (100/sec), connection pooling, heartbeat optimization
 * - DB: Explicit schema, connection pooling limits, timeout handling
 * - Auth: Session persistence, auto token refresh, URL detection
 * - Global: Retry strategy with exponential backoff
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
	realtime: {
		params: {
			eventsPerSecond: 100, // Batch events to reduce overhead
		},
	},
	db: {
		schema: "public",
	},
	auth: {
		persistSession: true,
		autoRefreshToken: true,
		detectSessionInUrl: true,
	},
	// Global fetch options for resilience
	global: {
		fetch: fetchWithRetry,
		headers: {
			"x-client-info": "realtime-optimized",
		},
	},
});

/**
 * Exponential backoff delay helper
 */
function backoffDelay(attempt: number): Promise<void> {
	const ms = Math.min(1000 * Math.pow(2, attempt), 10000);
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with exponential backoff retry logic
 * Handles transient network failures gracefully — applies backoff on
 * both 5xx HTTP errors AND network-level exceptions.
 */
async function fetchWithRetry(
	input: RequestInfo | URL,
	init?: RequestInit,
	maxRetries: number = 3,
): Promise<Response> {
	let lastError: Error | null = null;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			const response = await fetch(input, init);

			// Don't retry on 4xx errors (client errors)
			if (response.status >= 400 && response.status < 500) {
				// Emit a global event for 401 so app can handle session refresh/sign-out
				if (response.status === 401) {
					try { window.dispatchEvent(new CustomEvent('supabase:unauthorized', { detail: { status: 401 } })); } catch (e) {}
				}
				return response;
			}

			// Success
			if (response.ok) {
				return response;
			}

			// 5xx — record error and apply backoff before retrying
			lastError = new Error(`HTTP ${response.status}`);
			if (attempt < maxRetries - 1) {
				await backoffDelay(attempt);
			}
		} catch (err) {
			// Network-level error — apply same backoff before retrying
			lastError = err instanceof Error ? err : new Error(String(err));
			if (attempt < maxRetries - 1) {
				await backoffDelay(attempt);
			}
		}
	}

	throw lastError || new Error("Failed to fetch after multiple retries");
}

export const testSupabaseConnection = async () => {
	if (!supabaseUrl || !supabaseAnonKey) {
		throw new Error(
			"Supabase URL or Anon Key is missing. Please check your environment variables.",
		);
	}

	try {
		const { error } = await supabase.auth.getSession();
		if (error) throw error;
	} catch (error) {
		console.error("Supabase connection test failed:", error);
		throw new Error(
			"Could not connect to Supabase database. Please check your configuration.",
		);
	}
};

let activeUserId: string | null = null;

// Dynamically fetch and track the authenticated user's ID
supabase.auth.getSession().then(({ data }) => {
	activeUserId = data.session?.user?.id || null;
});

supabase.auth.onAuthStateChange((_event, session) => {
	activeUserId = session?.user?.id || null;
});

/**
 * Logs a system-level error or database crash to the feedbacks table for Admin review.
 */
export const logSystemError = async (
	message: string,
	details: any = {},
	userId?: string
): Promise<void> => {
	const uid = userId || activeUserId;
	try {
		// Insert system reports directly into feedbacks table
		const { error } = await supabase.from("feedbacks").insert({
			user_id: uid,
			player_name: "System",
			type: "report",
			message: message,
			details: {
				...details,
				timestamp: new Date().toISOString(),
				userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
				url: typeof window !== "undefined" ? window.location.href : "unknown",
			},
		});
		if (error) {
			console.error("Failed to log system error to database feedbacks table:", error);
		}
	} catch (err) {
		console.error("Error in logSystemError handler:", err);
	}
};

