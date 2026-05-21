import { useState, useEffect, useRef, useCallback } from "react";
import {
	ChevronLeft,
	ChevronRight,
	Trash2,
	Send,
	Smile,
	X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "../../lib/utils";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { type MatchRoom } from "../../lib/Matchmaking";
import { MessageBatcher, batchUpdateReactions } from "../../lib/MessageBatcher";
import {
	type RoomMessage,
	type EmojiType,
	EMOJI_REACTIONS,
} from "../../lib/chatTypes";
import {
	formatTimeAgo,
	validateMessage,
	getReactionCounts,
	userHasReacted,
	toggleReaction,
	filterVisibleMessages,
} from "../../lib/chatUtils";

interface ChatPanelProps {
	room: MatchRoom;
	isHost: boolean;
	phase?: string;
	variant?: "embedded" | "floating";
}

export default function ChatPanel({
	room,
	isHost,
	phase = "playing",
	variant = "floating",
}: ChatPanelProps) {
	const { user } = useAuth();
	const [messages, setMessages] = useState<RoomMessage[]>([]);
	const [inputValue, setInputValue] = useState("");
	const [isExpanded, setIsExpanded] = useState(false);
	const [unreadCount, setUnreadCount] = useState(0);
	const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);
	const [isSending, setIsSending] = useState(false);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const channelRef = useRef<any>(null);
	const batcherRef = useRef<MessageBatcher | null>(null);

	const isFloating = variant === "floating";

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
			}
		};

		loadMessages();
	}, [room.id, scrollToBottom]);

	// Real-time subscriptions
	useEffect(() => {
		const channel = supabase.channel(`room:${room.id}:chat`);
		channelRef.current = channel;

		channel
			.on("broadcast", { event: "message" }, payload => {
				const newMessage = payload.payload as RoomMessage;
				setMessages(prev => {
					if (!prev.some(m => m.id === newMessage.id)) {
						if (isFloating && !isExpanded) setUnreadCount(c => c + 1);
						return [...prev, newMessage];
					}
					return prev;
				});
				if (!isFloating || isExpanded) scrollToBottom();
			})
			.on("broadcast", { event: "reaction" }, payload => {
				const { messageId, reactions } = payload.payload;
				setMessages(prev =>
					prev.map(m => (m.id === messageId ? { ...m, reactions } : m)),
				);
			})
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
							if (isFloating && !isExpanded) setUnreadCount(c => c + 1);
							return [...prev, inserted];
						}
						return prev;
					});
					if (!isFloating || isExpanded) scrollToBottom();
				},
			)
			.subscribe();

		return () => {
			supabase.removeChannel(channel);
		};
	}, [room.id, isExpanded, scrollToBottom, isFloating]);

	const handleExpand = () => {
		setIsExpanded(true);
		setUnreadCount(0);
		scrollToBottom();
	};

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

			// Persist to database FIRST
			const { error: insertError } = await supabase
				.from("room_messages")
				.insert([message]);

			if (insertError) {
				toast.error("Failed to send message");
				throw insertError;
			}

			setInputValue("");

			setMessages(prev => {
				if (!prev.some(m => m.id === message.id)) {
					return [...prev, message];
				}
				return prev;
			});
			scrollToBottom();

			const channel = channelRef.current;
			if (channel) {
				try {
					await channel.send({
						type: "broadcast",
						event: "message",
						payload: message,
					});
				} catch (broadcastErr) {
					console.warn("Broadcast failed but message was saved:", broadcastErr);
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

			setMessages(prev =>
				prev.map(m =>
					m.id === messageId ? { ...m, reactions: newReactions } : m,
				),
			);

			const channel = channelRef.current;
			if (channel) {
				try {
					await channel.send({
						type: "broadcast",
						event: "reaction",
						payload: { messageId, reactions: newReactions },
					});
				} catch (broadcastErr) {
					console.warn("Broadcast reaction failed:", broadcastErr);
				}
			}

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
	const isFinished = phase === "finished";

	// Collapsed floating chat view
	if (isFloating && !isExpanded) {
		return (
			<button
				onClick={handleExpand}
				className={cn(
					"fixed z-[250] min-w-28 flex items-center gap-2 rounded-full bg-[var(--color-app-blue)] text-white px-4 py-3 border border-[var(--color-app-border-light)] hover:bg-blue-500 transition-all shadow-xl shadow-blue-500/10",
					isFinished ? "right-6 top-1/2 -translate-y-1/2" : "left-6 bottom-24",
				)}
				title="Open chat">
				<ChevronRight className="w-4 h-4 shrink-0" />
				<span className="text-xs font-black uppercase tracking-wider">
					Chat
				</span>
				{unreadCount > 0 && (
					<div className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold min-w-5 h-5 px-1 rounded-full flex items-center justify-center animate-pulse">
						{unreadCount > 9 ? "9+" : unreadCount}
					</div>
				)}
			</button>
		);
	}

	return (
		<div
			className={cn(
				"flex flex-col overflow-hidden transition-all duration-300",
				isFloating ?
					"fixed z-[250] w-80 h-[360px] bg-[var(--color-app-panel)]/90 backdrop-blur-xl border border-[var(--color-app-border-light)] shadow-2xl rounded-2xl"
				:	"w-full h-full min-h-[350px] bg-transparent",
				isFloating && (isFinished ? "right-4 bottom-24" : "left-4 bottom-24"),
			)}>
			{/* Header (only shown for floating chat or if desired) */}
			{isFloating && (
				<div className="px-4 py-3 border-b border-[var(--color-app-border-light)] flex items-center justify-between">
					<h3 className="text-xs font-black uppercase tracking-widest text-[var(--color-app-text-muted)]">
						Chat
					</h3>
					<button
						onClick={() => setIsExpanded(false)}
						className="p-1 hover:bg-white/5 rounded transition-colors"
						title="Minimize chat">
						{isFinished ?
							<ChevronRight className="w-4 h-4 text-[var(--color-app-text-muted)]" />
						:	<ChevronLeft className="w-4 h-4 text-[var(--color-app-text-muted)]" />
						}
					</button>
				</div>
			)}

			{/* Messages List */}
			<div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-3">
				{visibleMessages.length === 0 ?
					<div className="flex items-center justify-center h-full">
						<div className="text-[var(--color-app-text-muted)] text-xs text-center">
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
								<div className="text-[10px] text-[var(--color-app-text-muted)] italic text-center px-2 py-1">
									{message.content}
								</div>
							:	<div className="bg-[var(--color-app-bg)]/40 rounded-lg p-2.5 space-y-1.5 hover:bg-[var(--color-app-bg)]/60 transition-colors">
									<div className="flex items-start justify-between gap-2">
										<div className="flex items-start gap-2 flex-1 min-w-0">
											{/* Avatars: always show for embedded, or option for floating */}
											{(!isFloating || message.avatar_url) && (
												<img
													src={
														message.avatar_url ||
														`https://ui-avatars.com/api/?name=${message.username}`
													}
													alt={message.username}
													className={cn(
														"rounded-full object-cover shrink-0",
														isFloating ? "w-5 h-5" : "w-6 h-6",
													)}
												/>
											)}
											<div className="flex-1 min-w-0">
												<div className="flex items-baseline gap-1.5 flex-wrap">
													<span className="font-bold text-white truncate text-xs">
														{message.username}
													</span>
													<span className="text-[9px] text-[var(--color-app-text-muted)]">
														{formatTimeAgo(message.created_at)}
													</span>
													{message.edited_at && (
														<span className="text-[9px] text-[var(--color-app-text-muted)] italic">
															(edited)
														</span>
													)}
												</div>
												<p className="text-white/80 break-words mt-0.5 text-xs">
													{message.is_deleted ?
														<span className="italic text-[var(--color-app-text-muted)]">
															(deleted)
														</span>
													:	message.content}
												</p>
											</div>
										</div>

										{!message.is_deleted &&
											(userId === message.user_id || isHost) && (
												<button
													onClick={() => deleteMessage(message.id)}
													className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-500/20 rounded text-red-400 shrink-0"
													title="Delete message"
													aria-label="Delete message">
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
																"px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors",
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

									{/* Reaction Picker */}
									{!message.is_deleted && showEmojiPicker === message.id && (
										<div className="flex flex-wrap gap-1 pt-1 bg-white/5 p-1 rounded">
											{EMOJI_REACTIONS.map(emoji => (
												<button
													key={emoji}
													onClick={() => handleReaction(message.id, emoji)}
													className="text-sm hover:scale-125 transition-transform">
													{emoji}
												</button>
											))}
										</div>
									)}

									{!message.is_deleted && (
										<button
											onClick={() =>
												setShowEmojiPicker(
													showEmojiPicker === message.id ? null : message.id,
												)
											}
											className="text-[9px] text-[var(--color-app-blue)] hover:text-blue-400 font-bold uppercase">
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
			<div className="px-3 py-2 border-t border-[var(--color-app-border-light)] bg-[var(--color-app-bg)]/20">
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
						placeholder={isFloating ? "Message..." : "Type a message..."}
						className="flex-1 bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-lg px-3 py-1.5 text-xs text-white placeholder-[var(--color-app-text-muted)] focus:outline-none focus:border-[var(--color-app-blue)]"
						disabled={isSending}
					/>
					<button
						onClick={sendMessage}
						disabled={isSending || !inputValue.trim()}
						className="bg-[var(--color-app-blue)] text-white px-3 py-1.5 rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors flex items-center justify-center">
						<Send className="w-3.5 h-3.5" />
					</button>
				</div>
			</div>
		</div>
	);
}
