import { supabase } from "./supabase";

export interface ConnectionStats {
	isConnected: boolean;
	lastHealthCheck: number;
	reconnectAttempts: number;
	averageLatency: number;
	failureRate: number;
	uptime: number; // milliseconds
}

interface HealthCheckResult {
	timestamp: number;
	latency: number;
	success: boolean;
}

/**
 * Monitors real-time connection health and provides reconnection strategies
 * Prevents cascading failures and ensures graceful degradation
 */
export class ConnectionHealthMonitor {
	private isConnected: boolean = true;
	private reconnectAttempts: number = 0;
	private healthChecks: HealthCheckResult[] = [];
	private maxHealthChecks: number = 50;
	private healthCheckInterval: NodeJS.Timeout | null = null;
	private lastHealthCheck: number = 0;
	private startTime: number = Date.now();
	// Mutable callback holder — allows updating without recreating the monitor (important for HMR)
	private onStatusChange: (connected: boolean) => void;
	private maxReconnectAttempts: number = 5;
	private reconnectDelay: number = 1000; // Start at 1s
	private maxReconnectDelay: number = 30000; // Cap at 30s

	constructor(onStatusChange: (connected: boolean) => void) {
		this.onStatusChange = onStatusChange;
	}

	/**
	 * Update the status change callback (e.g. after HMR without recreating the monitor)
	 */
	public updateCallback(onStatusChange: (connected: boolean) => void): void {
		this.onStatusChange = onStatusChange;
	}

	/**
	 * Start monitoring connection health
	 */
	public start(): void {
		// Initial health check
		this.performHealthCheck();

		// Periodic health checks every 10 seconds
		this.healthCheckInterval = setInterval(() => {
			this.performHealthCheck();
		}, 10000);
	}

	/**
	 * Stop monitoring and reset the singleton so the next call to
	 * initializeHealthMonitor creates a fresh instance.
	 */
	public stop(): void {
		if (this.healthCheckInterval) {
			clearInterval(this.healthCheckInterval);
			this.healthCheckInterval = null;
		}
		// Reset module-level singleton so re-initialization works correctly (fixes HMR leak)
		healthMonitor = null;
	}

	/**
	 * Perform a health check by querying auth session
	 */
	private async performHealthCheck(): Promise<void> {
		const checkStart = Date.now();

		try {
			const { error } = await supabase.auth.getSession();

			const latency = Date.now() - checkStart;
			const success = !error;

			this.recordHealthCheck({
				timestamp: Date.now(),
				latency,
				success,
			});

			if (success && !this.isConnected) {
				// Connection restored
				this.isConnected = true;
				this.reconnectAttempts = 0;
				this.reconnectDelay = 1000;
				this.onStatusChange(true);
			} else if (!success && this.isConnected) {
				// Connection lost
				this.isConnected = false;
				this.onStatusChange(false);
				this.attemptReconnect();
			}
		} catch (err) {
			console.error("Health check failed:", err);
			if (this.isConnected) {
				this.isConnected = false;
				this.onStatusChange(false);
				this.attemptReconnect();
			}
		}
	}

	/**
	 * Attempt to reconnect with exponential backoff
	 */
	private attemptReconnect(): void {
		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			console.error(
				"Max reconnection attempts reached. Connection may be unavailable.",
			);
			return;
		}

		this.reconnectAttempts++;
		const delay = Math.min(
			this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
			this.maxReconnectDelay,
		);

		console.log(
			`Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`,
		);

		setTimeout(() => {
			this.performHealthCheck();
		}, delay);
	}

	/**
	 * Record health check result
	 */
	private recordHealthCheck(result: HealthCheckResult): void {
		this.healthChecks.push(result);
		if (this.healthChecks.length > this.maxHealthChecks) {
			this.healthChecks.shift();
		}
		this.lastHealthCheck = result.timestamp;
	}

	/**
	 * Get current connection statistics
	 */
	public getStats(): ConnectionStats {
		const failureCount = this.healthChecks.filter(
			check => !check.success,
		).length;
		const failureRate =
			this.healthChecks.length > 0 ?
				failureCount / this.healthChecks.length
			:	0;

		const avgLatency =
			this.healthChecks.length > 0 ?
				this.healthChecks.reduce((sum, check) => sum + check.latency, 0) /
				this.healthChecks.length
			:	0;

		return {
			isConnected: this.isConnected,
			lastHealthCheck: this.lastHealthCheck,
			reconnectAttempts: this.reconnectAttempts,
			averageLatency: avgLatency,
			failureRate,
			uptime: Date.now() - this.startTime,
		};
	}

	/**
	 * Check if connection is healthy
	 */
	public isHealthy(): boolean {
		const stats = this.getStats();
		return (
			stats.isConnected &&
			stats.failureRate < 0.1 && // Less than 10% failure rate
			stats.averageLatency < 2000 // Less than 2 second latency
		);
	}
}

// Singleton instance — exported so stop() can reset it
export let healthMonitor: ConnectionHealthMonitor | null = null;

export function initializeHealthMonitor(
	onStatusChange: (connected: boolean) => void,
): ConnectionHealthMonitor {
	if (healthMonitor) {
		// Update the callback in-place so HMR doesn't leave a stale reference
		healthMonitor.updateCallback(onStatusChange);
		return healthMonitor;
	}
	healthMonitor = new ConnectionHealthMonitor(onStatusChange);
	healthMonitor.start();
	return healthMonitor;
}

export function getHealthMonitor(): ConnectionHealthMonitor | null {
	return healthMonitor;
}
