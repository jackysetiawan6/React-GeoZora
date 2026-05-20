import { RoomMessage, EmojiType, EMOJI_REACTIONS } from "./chatTypes";

export function formatTimeAgo(dateString: string): string {
	const date = new Date(dateString);
	const now = new Date();
	const secondsAgo = Math.floor((now.getTime() - date.getTime()) / 1000);

	if (secondsAgo < 60) return "now";
	if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
	if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}h ago`;
	if (secondsAgo < 604800) return `${Math.floor(secondsAgo / 86400)}d ago`;

	return date.toLocaleDateString();
}

export function formatTime(dateString: string): string {
	const date = new Date(dateString);
	return date.toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function validateMessage(content: string): {
	valid: boolean;
	error?: string;
} {
	const trimmed = content.trim();

	if (trimmed.length === 0) {
		return { valid: false, error: "Message cannot be empty" };
	}

	if (trimmed.length > 500) {
		return { valid: false, error: "Message must be 500 characters or less" };
	}

	return { valid: true };
}

export function getReactionCounts(
	reactions: Record<string, string[]>,
): Array<[EmojiType, number]> {
	return Object.entries(reactions)
		.map(
			([emoji, users]) =>
				[emoji as EmojiType, users.length] as [EmojiType, number],
		)
		.sort((a, b) => b[1] - a[1]);
}

export function userHasReacted(
	reactions: Record<string, string[]>,
	userId: string,
	emoji: EmojiType,
): boolean {
	return reactions[emoji]?.includes(userId) ?? false;
}

export function toggleReaction(
	reactions: Record<string, string[]>,
	userId: string,
	emoji: EmojiType,
): Record<string, string[]> {
	const newReactions = { ...reactions };

	// Remove any existing reaction from this user
	Object.keys(newReactions).forEach(e => {
		newReactions[e] = newReactions[e].filter(uid => uid !== userId);
		if (newReactions[e].length === 0) delete newReactions[e];
	});

	// Add new reaction if it's different from what they had
	if (!userHasReacted(reactions, userId, emoji)) {
		if (!newReactions[emoji]) newReactions[emoji] = [];
		newReactions[emoji].push(userId);
	}

	return newReactions;
}

export function isSystemMessage(message: RoomMessage): boolean {
	return message.is_system;
}

export function getMessageDisplayTime(
	message: RoomMessage,
	showFull = false,
): string {
	if (showFull) {
		return formatTime(message.created_at);
	}
	return formatTimeAgo(message.created_at);
}

export function filterVisibleMessages(messages: RoomMessage[]): RoomMessage[] {
	return messages.filter(m => !m.is_deleted);
}

export function isValidEmoji(emoji: string): emoji is EmojiType {
	return EMOJI_REACTIONS.includes(emoji as EmojiType);
}
