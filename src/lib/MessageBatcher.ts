import { supabase } from "./supabase";

export interface BatchedReaction {
	messageId: string;
	reactions: Record<string, string[]>;
}

/**
 * Batches message reactions to reduce network overhead
 * Queues reactions and sends them in batches every 500ms
 */
export class MessageBatcher {
	private reactionQueue: Map<string, Record<string, string[]>> = new Map();
	private batchTimer: NodeJS.Timeout | null = null;
	private batchInterval: number = 500; // 500ms batching window
	private roomId: string;
	private onBatch: (reactions: BatchedReaction[]) => Promise<void>;

	constructor(
		roomId: string,
		onBatch: (reactions: BatchedReaction[]) => Promise<void>,
	) {
		this.roomId = roomId;
		this.onBatch = onBatch;
	}

	/**
	 * Queue a reaction update
	 */
	public queueReaction(
		messageId: string,
		reactions: Record<string, string[]>,
	): void {
		// Add to queue
		this.reactionQueue.set(messageId, reactions);

		// Start batch timer if not already running
		if (!this.batchTimer) {
			this.batchTimer = setTimeout(() => {
				this.flush();
			}, this.batchInterval);
		}
	}

	/**
	 * Flush all queued reactions
	 */
	public async flush(): Promise<void> {
		if (this.batchTimer) {
			clearTimeout(this.batchTimer);
			this.batchTimer = null;
		}

		if (this.reactionQueue.size === 0) {
			return;
		}

		const batched: BatchedReaction[] = Array.from(
			this.reactionQueue.entries(),
		).map(([messageId, reactions]) => ({
			messageId,
			reactions,
		}));

		// Clear queue before sending
		this.reactionQueue.clear();

		try {
			await this.onBatch(batched);
		} catch (err) {
			console.error("Failed to batch reactions:", err);
			// Re-queue failed reactions
			for (const reaction of batched) {
				this.reactionQueue.set(reaction.messageId, reaction.reactions);
			}
		}
	}

	/**
	 * Get queue size
	 */
	public getQueueSize(): number {
		return this.reactionQueue.size;
	}

	/**
	 * Stop batching and clear queue
	 */
	public stop(): void {
		if (this.batchTimer) {
			clearTimeout(this.batchTimer);
			this.batchTimer = null;
		}
		this.reactionQueue.clear();
	}
}

/**
 * Batch update reactions in the database
 */
export async function batchUpdateReactions(
	roomId: string,
	reactions: BatchedReaction[],
): Promise<void> {
	if (reactions.length === 0) return;

	// Batch reactions into single database operations
	const updates = reactions.map(reaction =>
		supabase
			.from("room_messages")
			.update({ reactions: reaction.reactions })
			.eq("id", reaction.messageId),
	);

	const results = await Promise.allSettled(updates);

	// Log any failures
	results.forEach((result, index) => {
		if (result.status === "rejected") {
			console.error(
				`Failed to update reaction for message ${reactions[index].messageId}:`,
				result.reason,
			);
		}
	});
}
