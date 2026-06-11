interface ParticipantPresence {
	id: string;
	lastSeen: number;
	isActive: boolean;
}

export interface DisconnectionEvent {
	userId: string;
	wasActive: boolean;
}

/**
 * Monitors room presence and detects disconnections via timeout.
 * Triggers callbacks when participants disconnect.
 */
export class RoomPresenceMonitor {
	private roomId: string;
	private participants: Map<string, ParticipantPresence> = new Map();
	private timeoutMs: number;
	private checkIntervalMs: number;
	private checkInterval: NodeJS.Timeout | null = null;
	private onDisconnect: (event: DisconnectionEvent) => void;
	private isActive: boolean = false;
	private firedDisconnects: Set<string> = new Set(); // Track already-fired disconnects
	private activeIds: Set<string> = new Set();

	/**
	 * Synchronize active user IDs from presence state
	 */
	public syncActive(activeIds: Set<string> | string[]): void {
		this.activeIds = new Set(activeIds);
		this.activeIds.forEach(id => {
			this.updateLastSeen(id);
		});
	}

	constructor(
		roomId: string,
		onDisconnect: (event: DisconnectionEvent) => void,
		timeoutMs: number = 30000, // 30 seconds
		checkIntervalMs: number = 15000, // check every 15 seconds
	) {
		this.roomId = roomId;
		this.onDisconnect = onDisconnect;
		this.timeoutMs = timeoutMs;
		this.checkIntervalMs = checkIntervalMs;
	}

	/**
	 * Start monitoring room presence
	 */
	public start(): void {
		if (this.isActive) return;

		this.isActive = true;
		this.startTimeoutCheck();
	}

	/**
	 * Stop monitoring
	 */
	public stop(): void {
		if (!this.isActive) return;

		this.isActive = false;

		if (this.checkInterval) {
			clearInterval(this.checkInterval);
			this.checkInterval = null;
		}

		this.participants.clear();
		this.firedDisconnects.clear();
	}

	/**
	 * Get list of active participants
	 */
	public getActiveParticipants(): string[] {
		return Array.from(this.participants.values())
			.filter(p => p.isActive)
			.map(p => p.id);
	}

	/**
	 * Get presence state from channel (retained for interface compatibility)
	 */
	public getPresenceState(): Record<string, any> {
		return {};
	}

	/**
	 * Manually update last seen time for a participant
	 */
	public updateLastSeen(userId: string): void {
		const participant = this.participants.get(userId);
		if (participant) {
			participant.lastSeen = Date.now();
			participant.isActive = true;
		} else {
			this.participants.set(userId, {
				id: userId,
				lastSeen: Date.now(),
				isActive: true,
			});
			this.firedDisconnects.delete(userId);
		}
	}

	/**
	 * Periodically check for timeouts
	 */
	private startTimeoutCheck(): void {
		this.checkInterval = setInterval(() => {
			this.checkForTimeouts();
		}, this.checkIntervalMs);
	}

	/**
	 * Check for participants that have timed out
	 */
	private checkForTimeouts(): void {
		const now = Date.now();

		// Refresh lastSeen for all participants currently in the activeIds set
		this.activeIds.forEach(id => {
			const participant = this.participants.get(id);
			if (participant) {
				participant.lastSeen = now;
				participant.isActive = true;
			}
		});

		this.participants.forEach((participant, userId) => {
			if (participant.isActive && !this.firedDisconnects.has(userId)) {
				const timeSinceLastSeen = now - participant.lastSeen;

				if (timeSinceLastSeen > this.timeoutMs) {
					participant.isActive = false;
					this.firedDisconnects.add(userId);

					this.onDisconnect({
						userId,
						wasActive: true,
					});
				}
			}
		});
	}
}

/**
 * Create and start a room presence monitor
 */
export function createRoomPresenceMonitor(
	roomId: string,
	onDisconnect: (event: DisconnectionEvent) => void,
	timeoutMs?: number,
	checkIntervalMs?: number,
): RoomPresenceMonitor {
	const monitor = new RoomPresenceMonitor(
		roomId,
		onDisconnect,
		timeoutMs,
		checkIntervalMs,
	);
	monitor.start();
	return monitor;
}
