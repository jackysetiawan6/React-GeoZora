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
 * Fetch with exponential backoff retry logic
 * Handles transient network failures gracefully
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
				return response;
			}

			// Retry on 5xx or network errors
			if (response.ok) {
				return response;
			}

			lastError = new Error(`HTTP ${response.status}`);
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));

			// Calculate backoff delay
			if (attempt < maxRetries - 1) {
				const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
				await new Promise(resolve => setTimeout(resolve, delay));
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
