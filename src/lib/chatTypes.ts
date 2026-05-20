export interface RoomMessage {
	id: string;
	room_id: string;
	user_id: string | null;
	username: string;
	avatar_url: string | null;
	content: string;
	is_system: boolean;
	message_type: "text" | "emoji" | "system";
	created_at: string;
	edited_at: string | null;
	is_deleted: boolean;
	reactions: Record<string, string[]>;
	metadata: Record<string, unknown>;
}

export interface MessageInput {
	content: string;
	room_id: string;
}

export type EmojiType =
	| "😂"
	| "❤️"
	| "👍"
	| "🎉"
	| "😍"
	| "🔥"
	| "😢"
	| "😡"
	| "🤔";

export const EMOJI_REACTIONS: EmojiType[] = [
	"😂",
	"❤️",
	"👍",
	"🎉",
	"😍",
	"🔥",
	"😢",
	"😡",
	"🤔",
];

export interface ReactionData {
	emoji: EmojiType;
	users: string[];
	count: number;
}

export interface MessageReactions {
	[emoji: string]: string[];
}
