import { useState, useEffect, useRef, useCallback } from "react";
import {
	ChevronLeft,
	ChevronRight,
	Trash2,
	Send,
	Smile,
	X,
	MessageCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "../../lib/utils";
import { supabase, logSystemError } from "../../lib/supabase";
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
	variant?: "embedded" | "floating" | "sidebar";
	isExpanded?: boolean;
	setIsExpanded?: (val: boolean) => void;
	onUnreadCountChange?: (count: number) => void;
}

export default function ChatPanel({
	room,
	isHost,
	phase = "playing",
	variant = "floating",
	isExpanded: propIsExpanded,
	setIsExpanded: propSetIsExpanded,
	onUnreadCountChange,
}: ChatPanelProps) {
	const { user } = useAuth();
	const [messages, setMessages] = useState<RoomMessage[]>([]);
	const [inputValue, setInputValue] = useState("");
	const [localExpanded, setLocalExpanded] = useState(false);

	const [reconnectTrigger, setReconnectTrigger] = useState(0);

	useEffect(() => {
		const handleOnline = () => {
			toast.info("Connection restored. Re-syncing chat messages...");
			setReconnectTrigger(prev => prev + 1);
		};
		window.addEventListener("online", handleOnline);
		return () => window.removeEventListener("online", handleOnline);
	}, []);

	const isExpanded = variant === "sidebar" ? (propIsExpanded ?? false) : localExpanded;
	const setIsExpanded = variant === "sidebar" ? (propSetIsExpanded ?? (() => {})) : setLocalExpanded;

	const [unreadCount, setUnreadCount] = useState(0);
	const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);
	const [isSending, setIsSending] = useState(false);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const channelRef = useRef<any>(null);
	const batcherRef = useRef<MessageBatcher | null>(null);
	const seenMessageIdsRef = useRef<Set<string>>(new Set());
	const panelRef = useRef<HTMLDivElement | null>(null);

	const isFloating = variant === "floating";
	const isCollapsible = variant === "floating" || variant === "sidebar";

	// Stable ref so realtime callbacks always see the latest expanded state
	// without the channel being rebuilt every time the panel opens/closes
	const isExpandedRef = useRef(isExpanded);
	isExpandedRef.current = isExpanded;
	const isFloatingRef = useRef(isFloating);
	isFloatingRef.current = isFloating;
	const isCollapsibleRef = useRef(isCollapsible);
	isCollapsibleRef.current = isCollapsible;

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
					.order("created_at", { ascending: false })
					.limit(50);

				if (error) throw error;
				const reversed = (data || []).reverse();
				setMessages(reversed);
				// populate seen ids to avoid double notification on duplicate events
				const ids = new Set<string>();
				reversed.forEach((m: any) => ids.add(m.id));
				seenMessageIdsRef.current = ids;
				scrollToBottom();
			} catch (err) {
				console.error("Failed to load messages:", err);
				toast.error("Failed to load chat messages.");
				void logSystemError("loadMessages failure", {
					roomId: room.id,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		};

		loadMessages();
	}, [room.id, scrollToBottom, reconnectTrigger]);

	// Real-time subscriptions
	useEffect(() => {
		const channelName = `room:${room.id}:chat`;
		const existingChannel = supabase.getChannels().find(
			(ch: any) => ch.name === channelName || ch.topic === `realtime:${channelName}`
		);
		if (existingChannel) {
			supabase.removeChannel(existingChannel);
		}

		const channel = supabase.channel(channelName);
		channelRef.current = channel;

		channel
				.on("broadcast", { event: "message" }, payload => {
					const newMessage = payload.payload as RoomMessage;
					// Prevent duplicate handling across realtime transports
					if (seenMessageIdsRef.current.has(newMessage.id)) {
						return;
					}
					seenMessageIdsRef.current.add(newMessage.id);
					setMessages(prev => {
						if (!prev.some(m => m.id === newMessage.id)) {
							// Use ref so the callback doesn't capture a stale isExpanded
							if (isCollapsibleRef.current && !isExpandedRef.current) {
								setUnreadCount(c => {
									const next = c + 1;
									onUnreadCountChange?.(next);
									return next;
								});
							}
							return [...prev, newMessage];
						}
						return prev;
					});
					if (!isCollapsibleRef.current || isExpandedRef.current) scrollToBottom();
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
						if (seenMessageIdsRef.current.has(inserted.id)) return;
						seenMessageIdsRef.current.add(inserted.id);
						setMessages(prev => {
							if (!prev.some(m => m.id === inserted.id)) {
								if (isCollapsibleRef.current && !isExpandedRef.current) {
									setUnreadCount(c => {
										const next = c + 1;
										onUnreadCountChange?.(next);
										return next;
									});
								}
								return [...prev, inserted];
							}
							return prev;
						});
						if (!isCollapsibleRef.current || isExpandedRef.current) scrollToBottom();
					},
				)
			.subscribe();

		return () => {
			supabase.removeChannel(channel);
		};
	}, [room.id, scrollToBottom, reconnectTrigger]);

	const handleExpand = () => {
		setIsExpanded(true);
		setUnreadCount(0);
		onUnreadCountChange?.(0);
		// Notify other panels to close
		try {
			window.dispatchEvent(new CustomEvent('app:panel-open', { detail: { panel: 'chat' } }));
		} catch {}
		scrollToBottom();
	};

	// Close on outside click and listen for other panel opens
	useEffect(() => {
		const onDocClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (target.closest('.toggle-chat-btn')) return;

			const el = panelRef.current;
			if (!el) return;
			if (!el.contains(e.target as Node)) {
				if (isExpanded) {
					setIsExpanded(false);
					try { window.dispatchEvent(new CustomEvent('app:panel-open', { detail: { panel: 'none' } })); } catch {}
				}
			}
		};

		const onPanelOpen = (ev: Event) => {
			const detail: any = (ev as CustomEvent).detail;
			if (detail?.panel && detail.panel !== 'chat') {
				setIsExpanded(false);
			}
		};

		document.addEventListener('mousedown', onDocClick);
		window.addEventListener('app:panel-open', onPanelOpen as EventListener);
		return () => {
			document.removeEventListener('mousedown', onDocClick);
			window.removeEventListener('app:panel-open', onPanelOpen as EventListener);
		};
	}, [isExpanded]);

	// Controlled expansion resets unread count and scrolls to bottom
	useEffect(() => {
		if (isExpanded) {
			setUnreadCount(0);
			onUnreadCountChange?.(0);
			scrollToBottom();
		}
	}, [isExpanded, onUnreadCountChange, scrollToBottom]);

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
				void logSystemError("sendMessage database insert failure", {
					roomId: room.id,
					userId,
					error: insertError.message,
					code: insertError.code,
				});
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
					if (channel.state === "joined") {
						await channel.send({
							type: "broadcast",
							event: "message",
							payload: message,
						});
					} else {
						console.warn("Realtime channel not joined. Broadcast skipped, message saved in DB.");
					}
				} catch (broadcastErr) {
					console.warn("Broadcast failed but message was saved:", broadcastErr);
				}
			}
		} catch (err) {
			console.error("Send message error:", err);
			toast.error("Failed to send message. Please check your network connection.");
		} finally {
			setIsSending(false);
		}
	};

	const closePanel = () => {
		setIsExpanded(false);
		try {
			window.dispatchEvent(
				new CustomEvent("app:panel-open", {
					detail: { panel: "none" },
				}),
			);
		} catch {}
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
			void logSystemError("deleteMessage failure", {
				roomId: room.id,
				messageId,
				error: err instanceof Error ? err.message : String(err),
			});
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
					if (channel.state === "joined") {
						await channel.send({
							type: "broadcast",
							event: "reaction",
							payload: { messageId, reactions: newReactions },
						});
					} else {
						console.warn("Realtime channel not joined. Broadcast reaction skipped.");
					}
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
			void logSystemError("handleReaction failure", {
				roomId: room.id,
				messageId,
				emoji,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	};

	const visibleMessages = filterVisibleMessages(messages);
	const userId = user?.uid || "guest";
	const isFinished = phase === "finished";

	// Collapsed floating chat view
	if (isFloating && !isExpanded) {
		return (
			<button
				ref={panelRef}
				onClick={handleExpand}
				className={cn(
					"fixed z-[250] min-w-28 flex items-center gap-2 rounded-full bg-[var(--color-app-blue)] text-white px-4 py-3 border border-[var(--color-app-border-light)] hover:bg-blue-500 transition-all shadow-xl shadow-blue-500/10",
					// Place chat bottom-right when match has finished; otherwise keep default left-side during play
					isFinished ? "right-6 bottom-24" : "left-6 bottom-24",
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
			ref={panelRef}
			className={cn(
				"flex flex-col overflow-hidden transition-all duration-300",
				variant === "sidebar" ?
					"pointer-events-auto w-80 rounded-2xl border border-white/10 bg-[#111622]/95 backdrop-blur-xl shadow-2xl overflow-hidden"
				: isFloating ?
					"fixed z-[250] w-80 h-[360px] bg-[var(--color-app-panel)]/90 backdrop-blur-xl border border-[var(--color-app-border-light)] shadow-2xl rounded-2xl"
				:	"w-full h-full min-h-[350px] bg-transparent",
				variant === "sidebar" ?
					(isExpanded ? "max-h-[360px] opacity-100" : "max-h-0 opacity-0 border-transparent shadow-none")
				: isFloating ?
					(isFinished ? "right-4 bottom-24" : "left-4 bottom-24")
				: ""
			)}>
			{/* Header (shown for floating or sidebar variant) */}
			{(isFloating || variant === "sidebar") && (
				<div className="px-4 py-3 border-b border-[var(--color-app-border-light)] flex items-center justify-between">
					<h3 className="text-xs font-black uppercase tracking-widest text-[var(--color-app-text-muted)] flex items-center gap-2">
						<MessageCircle className="w-4 h-4 text-blue-400" />
						Chat
					</h3>
					<button
						onClick={closePanel}
						className="p-1 hover:bg-white/5 rounded transition-colors"
						title="Minimize chat">
						{variant === "sidebar" ?
							<X className="w-4 h-4 text-[var(--color-app-text-muted)]" />
						: isFinished ?
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
											{/* Avatars */}
											{(!isCollapsible || message.avatar_url) && (
												<img
													src={
														message.avatar_url ||
														`https://ui-avatars.com/api/?name=${message.username}`
													}
													alt={message.username}
													className={cn(
														"rounded-full object-cover shrink-0",
														isCollapsible ? "w-5 h-5" : "w-6 h-6",
													)}
												/>
											)}
											<div className="flex-1 min-w-0">
												<div className="flex items-baseline gap-1.5 flex-wrap">
													<span className="font-bold text-[var(--color-app-text)] truncate text-xs">
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
												<p className="text-[var(--color-app-text)] opacity-85 break-words mt-0.5 text-xs">
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
																	"bg-[var(--color-app-blue)]/30 border border-[var(--color-app-blue)]/50 text-[var(--color-app-text)] font-semibold"
																:	"bg-[var(--color-app-hover)] border border-[var(--color-app-border-light)] text-[var(--color-app-text-muted)] hover:bg-[var(--color-app-border)]",
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
						onKeyDown={e => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								sendMessage();
							}
						}}
						placeholder={isCollapsible ? "Message..." : "Type a message..."}
						className="flex-1 bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-lg px-3 py-1.5 text-xs text-[var(--color-app-text)] placeholder-[var(--color-app-text-muted)] focus:outline-none focus:border-[var(--color-app-blue)]"
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
