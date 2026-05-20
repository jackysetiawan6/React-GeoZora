import { supabase } from "./supabase";

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
	private channel: ReturnType<typeof supabase.channel> | null = null;
	private participants: Map<string, ParticipantPresence> = new Map();
	private timeoutMs: number;
	private checkIntervalMs: number;
	private checkInterval: NodeJS.Timeout | null = null;
	private onDisconnect: (event: DisconnectionEvent) => void;
	private isActive: boolean = false;
	private firedDisconnects: Set<string> = new Set(); // Track already-fired disconnects

	constructor(
		roomId: string,
		onDisconnect: (event: DisconnectionEvent) => void,
		timeoutMs: number = 30000, // 30 seconds
		checkIntervalMs: number = 15000, // check every 15 seconds (reduced from 5s for optimization)
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
		this.channel = supabase.channel(`room_presence_monitor_${this.roomId}`, {
			config: {
				presence: {
					key: `monitor_${Math.random().toString(36).slice(2, 8)}`,
				},
			},
		});

		this.channel
			.on("presence", { event: "sync" }, () => {
				this.onPresenceSync();
			})
			.on("presence", { event: "join" }, ({ key, newPresences }) => {
				newPresences.forEach((presence: any) => {
					this.participants.set(presence.id, {
						id: presence.id,
						lastSeen: Date.now(),
						isActive: true,
					});
					// Clear from fired disconnects if rejoining
					this.firedDisconnects.delete(presence.id);
				});
			})
			.on("presence", { event: "leave" }, ({ key, leftPresences }) => {
				// Optimization: Immediately fire disconnect on presence leave event
				// This eliminates the need to wait for polling timeout (up to 15s faster)
				leftPresences.forEach((presence: any) => {
					const participant = this.participants.get(presence.id);
					if (participant && !this.firedDisconnects.has(presence.id)) {
						participant.isActive = false;
						this.firedDisconnects.add(presence.id);
						this.onDisconnect({
							userId: presence.id,
							wasActive: true,
						});
					}
				});
			})
			.subscribe(status => {
				if (status === "SUBSCRIBED") {
					this.startTimeoutCheck();
				}
			});
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

		if (this.channel) {
			supabase.removeChannel(this.channel);
			this.channel = null;
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
	 * Get presence state from channel
	 */
	public getPresenceState(): Record<string, any> {
		if (!this.channel) return {};
		return this.channel.presenceState() || {};
	}

	/**
	 * Manually update last seen time for a participant
	 */
	public updateLastSeen(userId: string): void {
		const participant = this.participants.get(userId);
		if (participant) {
			participant.lastSeen = Date.now();
			participant.isActive = true;
		}
	}

	/**
	 * Handle presence sync event
	 */
	private onPresenceSync(): void {
		const state = this.getPresenceState();
		const now = Date.now();

		// Update last seen times for synced participants
		Object.keys(state).forEach(key => {
			const presenceElements = state[key] as any[];
			if (presenceElements && presenceElements.length > 0) {
				const presence = presenceElements[0];
				const participant = this.participants.get(presence.id);

				if (participant) {
					participant.lastSeen = now;
					participant.isActive = true;
				} else {
					this.participants.set(presence.id, {
						id: presence.id,
						lastSeen: now,
						isActive: true,
					});
				}
			}
		});
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
	 * Check for participants that have timed out (backup to presence leave event)
	 */
	private checkForTimeouts(): void {
		const now = Date.now();

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
