import { supabase } from "./supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface ChannelConfig {
	type: "broadcast" | "presence" | "postgres_changes";
	name: string;
	params?: Record<string, any>;
}

export interface Subscription {
	id: string;
	callback: (payload: any) => void;
	config: ChannelConfig;
}

/**
 * Unified subscription manager to prevent duplicate channels and manage lifecycle
 * Ensures clean cleanup and prevents connection leaks
 */
export class SubscriptionManager {
	private channels: Map<string, RealtimeChannel> = new Map();
	private subscriptions: Map<string, Subscription[]> = new Map();
	private pendingSubscriptions: Set<string> = new Set();
	private retryQueue: Map<string, number> = new Map(); // Track retry attempts
	private maxRetries: number = 3;

	/**
	 * Get or create a channel
	 */
	private getChannel(channelName: string): RealtimeChannel {
		if (this.channels.has(channelName)) {
			return this.channels.get(channelName)!;
		}

		const channel = supabase.channel(channelName, {
			config: {
				broadcast: { ack: true }, // Require acknowledgment for reliability
				presence: { key: `user_${Math.random().toString(36).slice(2, 8)}` },
			},
		});

		this.channels.set(channelName, channel);
		return channel;
	}

	/**
	 * Subscribe to channel events
	 */
	public subscribe(
		channelName: string,
		eventType: "broadcast" | "postgres_changes" | "presence",
		filter: Record<string, any> | undefined,
		callback: (payload: any) => void,
	): string {
		const subscriptionId = `${channelName}_${eventType}_${Math.random().toString(36).slice(2, 8)}`;

		const channel = this.getChannel(channelName);

		// Store subscription for tracking
		if (!this.subscriptions.has(channelName)) {
			this.subscriptions.set(channelName, []);
		}

		const subscription: Subscription = {
			id: subscriptionId,
			callback,
			config: {
				type: eventType,
				name: channelName,
				params: filter,
			},
		};

		this.subscriptions.get(channelName)!.push(subscription);

		// Attach listener
		if (eventType === "postgres_changes") {
			channel.on(
				"postgres_changes" as any,
				filter || { event: "*", schema: "public" },
				payload => {
					try {
						callback(payload);
					} catch (err) {
						console.error(`Error in subscription ${subscriptionId}:`, err);
					}
				},
			);
		} else if (eventType === "broadcast") {
			const eventName = filter?.event || "*";
			channel.on("broadcast", { event: eventName }, payload => {
				try {
					callback(payload);
				} catch (err) {
					console.error(`Error in subscription ${subscriptionId}:`, err);
				}
			});
		} else if (eventType === "presence") {
			const presenceEvent = filter?.event || "sync";
			channel.on("presence", { event: presenceEvent }, payload => {
				try {
					callback(payload);
				} catch (err) {
					console.error(`Error in subscription ${subscriptionId}:`, err);
				}
			});
		}

		// Subscribe channel if not already subscribed
		if (!this.pendingSubscriptions.has(channelName)) {
			this.pendingSubscriptions.add(channelName);
			this.subscribeChannel(channel, channelName);
		}

		return subscriptionId;
	}

	/**
	 * Subscribe channel with retry logic
	 */
	private subscribeChannel(
		channel: RealtimeChannel,
		channelName: string,
	): void {
		channel.subscribe(async status => {
			if (status === "SUBSCRIBED") {
				console.log(`Channel subscribed: ${channelName}`);
				this.retryQueue.delete(channelName);
			} else if (status === "CHANNEL_ERROR") {
				this.handleChannelError(channel, channelName);
			} else if (status === "TIMED_OUT") {
				this.handleChannelTimeout(channel, channelName);
			}
		});
	}

	/**
	 * Handle channel errors with retry
	 */
	private handleChannelError(
		channel: RealtimeChannel,
		channelName: string,
	): void {
		const retries = this.retryQueue.get(channelName) || 0;

		if (retries < this.maxRetries) {
			const delay = Math.pow(2, retries) * 1000; // Exponential backoff
			console.warn(
				`Channel error for ${channelName}, retrying in ${delay}ms (attempt ${retries + 1}/${this.maxRetries})`,
			);

			this.retryQueue.set(channelName, retries + 1);
			setTimeout(() => {
				this.subscribeChannel(channel, channelName);
			}, delay);
		} else {
			console.error(
				`Channel ${channelName} failed after ${this.maxRetries} attempts`,
			);
		}
	}

	/**
	 * Handle channel timeout
	 */
	private handleChannelTimeout(
		channel: RealtimeChannel,
		channelName: string,
	): void {
		const retries = this.retryQueue.get(channelName) || 0;

		if (retries < this.maxRetries) {
			const delay = Math.pow(2, retries) * 1000;
			console.warn(
				`Channel timeout for ${channelName}, reconnecting in ${delay}ms`,
			);

			this.retryQueue.set(channelName, retries + 1);
			setTimeout(() => {
				this.subscribeChannel(channel, channelName);
			}, delay);
		}
	}

	/**
	 * Unsubscribe from a specific subscription
	 */
	public unsubscribe(subscriptionId: string): void {
		for (const [channelName, subs] of this.subscriptions.entries()) {
			const index = subs.findIndex(sub => sub.id === subscriptionId);
			if (index !== -1) {
				subs.splice(index, 1);

				// If no more subscriptions on this channel, unsubscribe the channel
				if (subs.length === 0) {
					const channel = this.channels.get(channelName);
					if (channel) {
						supabase.removeChannel(channel);
						this.channels.delete(channelName);
						this.subscriptions.delete(channelName);
						this.pendingSubscriptions.delete(channelName);
					}
				}
				break;
			}
		}
	}

	/**
	 * Unsubscribe from all subscriptions on a channel
	 */
	public unsubscribeChannel(channelName: string): void {
		const channel = this.channels.get(channelName);
		if (channel) {
			supabase.removeChannel(channel);
			this.channels.delete(channelName);
			this.subscriptions.delete(channelName);
			this.pendingSubscriptions.delete(channelName);
		}
	}

	/**
	 * Get all active subscriptions
	 */
	public getActiveSubscriptions(): string[] {
		return Array.from(this.channels.keys());
	}

	/**
	 * Clean up all subscriptions
	 */
	public cleanup(): void {
		for (const channel of this.channels.values()) {
			supabase.removeChannel(channel);
		}
		this.channels.clear();
		this.subscriptions.clear();
		this.pendingSubscriptions.clear();
		this.retryQueue.clear();
	}

	/**
	 * Get statistics
	 */
	public getStats(): { totalChannels: number; totalSubscriptions: number } {
		let totalSubscriptions = 0;
		for (const subs of this.subscriptions.values()) {
			totalSubscriptions += subs.length;
		}

		return {
			totalChannels: this.channels.size,
			totalSubscriptions,
		};
	}
}

// Singleton instance
let subscriptionManager: SubscriptionManager | null = null;

export function initializeSubscriptionManager(): SubscriptionManager {
	if (!subscriptionManager) {
		subscriptionManager = new SubscriptionManager();
	}
	return subscriptionManager;
}

export function getSubscriptionManager(): SubscriptionManager | null {
	return subscriptionManager;
}
