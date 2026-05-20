import { useState, useEffect, useRef, useCallback } from "react";
import { Trash2, Edit2, Send, Smile, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../lib/utils";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { type MatchRoom } from "../lib/Matchmaking";
import { MessageBatcher, batchUpdateReactions } from "../lib/MessageBatcher";
import {
	type RoomMessage,
	type EmojiType,
	EMOJI_REACTIONS,
} from "../lib/chatTypes";
import {
	formatTimeAgo,
	validateMessage,
	getReactionCounts,
	userHasReacted,
	toggleReaction,
	filterVisibleMessages,
} from "../lib/chatUtils";

interface RoomChatProps {
	room: MatchRoom;
	isHost: boolean;
}

export default function RoomChat({ room, isHost }: RoomChatProps) {
	const { user } = useAuth();
	const [messages, setMessages] = useState<RoomMessage[]>([]);
	const [inputValue, setInputValue] = useState("");
	const [loading, setLoading] = useState(true);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editValue, setEditValue] = useState("");
	const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);
	const [isSending, setIsSending] = useState(false);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const chatChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(
		null,
	);
	const batcherRef = useRef<MessageBatcher | null>(null);

	// Initialize message batcher for reaction batching
	useEffect(() => {
		batcherRef.current = new MessageBatcher(room.id, reactions =>
			batchUpdateReactions(room.id, reactions),
		);
		return () => {
			batcherRef.current?.stop();
		};
	}, [room.id]);

	const scrollToBottom = useCallback(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, []);

	// Load initial messages
	useEffect(() => {
		const loadMessages = async () => {
			try {
				const { data, error } = await supabase
					.from("room_messages")
					.select("*")
					.eq("room_id", room.id)
					.order("created_at", { ascending: true })
					.limit(50);

				if (error) throw error;

				setMessages(data || []);
				scrollToBottom();
			} catch (err) {
				console.error("Failed to load messages:", err);
				toast.error("Failed to load chat history");
			} finally {
				setLoading(false);
			}
		};

		loadMessages();
	}, [room.id, scrollToBottom]);

	// Real-time subscriptions
	useEffect(() => {
		const channel = supabase.channel(`room:${room.id}:chat`);
		chatChannelRef.current = channel;

		channel
			.on("broadcast", { event: "message" }, payload => {
				const newMessage = payload.payload as RoomMessage;
				setMessages(prev => {
					if (!prev.some(m => m.id === newMessage.id)) {
						return [...prev, newMessage];
					}
					return prev;
				});
				scrollToBottom();
			})
			.on("broadcast", { event: "reaction" }, payload => {
				const { messageId, reactions } = payload.payload;
				setMessages(prev =>
					prev.map(m => (m.id === messageId ? { ...m, reactions } : m)),
				);
			})
			// Optimized: Removed postgres_changes INSERT listener
			// Messages are persisted via DB-first pattern, broadcast handles near-real-time delivery
			.on(
				"postgres_changes",
				{
					event: "UPDATE",
					schema: "public",
					table: "room_messages",
					filter: `room_id=eq.${room.id}`,
				},
				payload => {
					const updated = payload.new as RoomMessage;
					setMessages(prev =>
						prev.map(m => (m.id === updated.id ? updated : m)),
					);
				},
			)
			.on(
				"postgres_changes",
				{
					event: "INSERT",
					schema: "public",
					table: "room_messages",
					filter: `room_id=eq.${room.id}`,
				},
				payload => {
					const inserted = payload.new as RoomMessage;
					setMessages(prev => {
						if (!prev.some(m => m.id === inserted.id)) {
							return [...prev, inserted];
						}
						return prev;
					});
					scrollToBottom();
				},
			)
			.subscribe();

		return () => {
			chatChannelRef.current = null;
			supabase.removeChannel(channel);
		};
	}, [room.id, scrollToBottom]);

	const sendMessage = async () => {
		const validation = validateMessage(inputValue);
		if (!validation.valid) {
			toast.error(validation.error);
			return;
		}

		setIsSending(true);
		const inputValueSnapshot = inputValue;
		try {
			const userId = user?.uid || "guest";
			const avatar =
				user?.avatarUrl ||
				user?.photoURL ||
				`https://ui-avatars.com/api/?name=${user?.displayName || "Guest"}&background=random`;

			const message: RoomMessage = {
				id: crypto.randomUUID(),
				room_id: room.id,
				user_id: userId,
				username: user?.displayName || "Guest",
				avatar_url: avatar,
				content: inputValueSnapshot,
				is_system: false,
				message_type: "text",
				created_at: new Date().toISOString(),
				edited_at: null,
				is_deleted: false,
				reactions: {},
				metadata: {},
			};

			// Persist to database FIRST (source of truth)
			const { error: insertError } = await supabase
				.from("room_messages")
				.insert([message]);

			if (insertError) {
				toast.error("Failed to send message");
				throw insertError;
			}

			// Clear input field immediately on success
			setInputValue("");

			// Optimistic UI update (after DB success)
			setMessages(prev => {
				if (!prev.some(m => m.id === message.id)) {
					return [...prev, message];
				}
				return prev;
			});
			scrollToBottom();

			// Broadcast to others (after DB success to ensure consistency)
			const channel = chatChannelRef.current;
			if (channel) {
				try {
					await channel.send({
						type: "broadcast",
						event: "message",
						payload: message,
					});
				} catch (broadcastErr) {
					console.warn("Broadcast failed but message was saved:", broadcastErr);
					// Message is already in DB, broadcast failure is non-critical
				}
			}
		} catch (err) {
			console.error("Send message error:", err);
			toast.error("Failed to send message");
		} finally {
			setIsSending(false);
		}
	};

	const deleteMessage = async (messageId: string) => {
		try {
			const { error } = await supabase
				.from("room_messages")
				.update({ is_deleted: true })
				.eq("id", messageId);

			if (error) throw error;
			toast.success("Message deleted");
		} catch (err) {
			console.error("Delete error:", err);
			toast.error("Failed to delete message");
		}
	};

	const handleReaction = async (messageId: string, emoji: EmojiType) => {
		try {
			const message = messages.find(m => m.id === messageId);
			if (!message) return;

			const userId = user?.uid || "guest";
			const newReactions = toggleReaction(message.reactions, userId, emoji);

			// Optimistic UI update
			setMessages(prev =>
				prev.map(m =>
					m.id === messageId ? { ...m, reactions: newReactions } : m,
				),
			);

			// Broadcast reaction update
			const channel = chatChannelRef.current;
			if (!channel) throw new Error("Chat channel is not ready yet");
			await channel.send({
				type: "broadcast",
				event: "reaction",
				payload: { messageId, reactions: newReactions },
			});

			// Queue reaction for batched database update (not immediate)
			if (batcherRef.current) {
				batcherRef.current.queueReaction(messageId, newReactions);
			}

			setShowEmojiPicker(null);
		} catch (err) {
			console.error("Reaction error:", err);
			toast.error("Failed to add reaction");
		}
	};

	const visibleMessages = filterVisibleMessages(messages);
	const userId = user?.uid || "guest";

	return (
		<div className="flex flex-col h-full overflow-hidden">
			{/* Messages List */}
			<div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-3">
				{loading ?
					<div className="flex items-center justify-center h-full">
						<div className="text-[var(--color-app-text-muted)] text-sm">
							Loading chat...
						</div>
					</div>
				: visibleMessages.length === 0 ?
					<div className="flex items-center justify-center h-full">
						<div className="text-[var(--color-app-text-muted)] text-sm">
							No messages yet. Be the first to chat!
						</div>
					</div>
				:	visibleMessages.map(message => (
						<div
							key={message.id}
							className={cn(
								"group",
								message.is_system && "flex justify-center",
							)}>
							{message.is_system ?
								<div className="text-[11px] text-[var(--color-app-text-muted)] italic text-center px-2 py-1">
									{message.content}
								</div>
							:	<div className="bg-[var(--color-app-bg)]/40 rounded-lg p-3 space-y-2 hover:bg-[var(--color-app-bg)]/60 transition-colors">
									<div className="flex items-start justify-between gap-2">
										<div className="flex items-start gap-2 flex-1 min-w-0">
											<img
												src={
													message.avatar_url ||
													`https://ui-avatars.com/api/?name=${message.username}`
												}
												alt={message.username}
												className="w-6 h-6 rounded-full object-cover shrink-0"
											/>
											<div className="flex-1 min-w-0">
												<div className="flex items-baseline gap-2 flex-wrap">
													<span className="font-bold text-sm text-white truncate">
														{message.username}
													</span>
													<span className="text-[10px] text-[var(--color-app-text-muted)]">
														{formatTimeAgo(message.created_at)}
													</span>
													{message.edited_at && (
														<span className="text-[9px] text-[var(--color-app-text-muted)] italic">
															(edited)
														</span>
													)}
												</div>
												<p className="text-sm text-white/90 break-words mt-1">
													{message.is_deleted ?
														<span className="italic text-[var(--color-app-text-muted)]">
															(deleted)
														</span>
													:	message.content}
												</p>
											</div>
										</div>

										{/* Actions (delete for own/host) */}
										{!message.is_deleted &&
											(userId === message.user_id || isHost) && (
												<button
													onClick={() => deleteMessage(message.id)}
													className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-500/20 rounded text-red-400 shrink-0"
													title="Delete message">
													<Trash2 className="w-3 h-3" />
												</button>
											)}
									</div>

									{/* Reactions */}
									{!message.is_deleted &&
										Object.keys(message.reactions).length > 0 && (
											<div className="flex flex-wrap gap-1 pt-1">
												{getReactionCounts(message.reactions).map(
													([emoji, count]) => (
														<button
															key={emoji}
															onClick={() => handleReaction(message.id, emoji)}
															className={cn(
																"px-2 py-0.5 rounded-full text-xs font-medium transition-colors",
																(
																	userHasReacted(
																		message.reactions,
																		userId,
																		emoji,
																	)
																) ?
																	"bg-[var(--color-app-blue)]/30 border border-[var(--color-app-blue)]/50 text-white"
																:	"bg-white/5 border border-white/10 text-white/70 hover:bg-white/10",
															)}>
															{emoji} {count}
														</button>
													),
												)}
											</div>
										)}

									{/* Emoji Picker */}
									{!message.is_deleted && showEmojiPicker === message.id && (
										<div className="flex flex-wrap gap-1 pt-1 bg-white/5 p-2 rounded">
											{EMOJI_REACTIONS.map(emoji => (
												<button
													key={emoji}
													onClick={() => handleReaction(message.id, emoji)}
													className="text-lg hover:scale-125 transition-transform">
													{emoji}
												</button>
											))}
										</div>
									)}

									{/* Reaction Toggle */}
									{!message.is_deleted && (
										<button
											onClick={() =>
												setShowEmojiPicker(
													showEmojiPicker === message.id ? null : message.id,
												)
											}
											className="text-[10px] text-[var(--color-app-blue)] hover:text-blue-400 font-bold uppercase">
											{showEmojiPicker === message.id ? "Close" : "React"}
										</button>
									)}
								</div>
							}
						</div>
					))
				}
				<div ref={messagesEndRef} />
			</div>

			{/* Input */}
			<div className="px-4 py-3 border-t border-[var(--color-app-border-light)] bg-[var(--color-app-bg)]/20">
				<div className="flex gap-2">
					<input
						type="text"
						value={inputValue}
						onChange={e => setInputValue(e.target.value)}
						onKeyPress={e => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								sendMessage();
							}
						}}
						placeholder="Type a message..."
						className="flex-1 bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-lg px-3 py-2 text-sm text-white placeholder-[var(--color-app-text-muted)] focus:outline-none focus:border-[var(--color-app-blue)]"
						disabled={isSending}
					/>
					<button
						onClick={sendMessage}
						disabled={isSending || !inputValue.trim()}
						className="bg-[var(--color-app-blue)] text-white px-3 py-2 rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors flex items-center gap-1">
						<Send className="w-4 h-4" />
					</button>
				</div>
			</div>
		</div>
	);
}
