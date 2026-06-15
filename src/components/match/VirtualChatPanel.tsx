import React, { useState, useEffect, useRef, useCallback } from "react";
import {
	Send,
	X,
	MessageCircle,
	ChevronRight,
	ChevronLeft,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useAuth } from "../../lib/AuthContext";
import { type RoomMessage, type EmojiType, EMOJI_REACTIONS } from "../../lib/chatTypes";

interface VirtualChatPanelProps {
	messages: RoomMessage[];
	onSendMessage: (content: string) => void;
	phase?: string;
	variant?: "embedded" | "floating" | "sidebar";
	isExpanded?: boolean;
	setIsExpanded?: (val: boolean) => void;
	onUnreadCountChange?: (count: number) => void;
}

export default function VirtualChatPanel({
	messages,
	onSendMessage,
	phase = "playing",
	variant = "floating",
	isExpanded: propIsExpanded,
	setIsExpanded: propSetIsExpanded,
	onUnreadCountChange,
}: VirtualChatPanelProps) {
	const { user } = useAuth();
	const [inputValue, setInputValue] = useState("");
	const [localExpanded, setLocalExpanded] = useState(false);
	const [unreadCount, setUnreadCount] = useState(0);
	const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);

	const isExpanded = variant === "sidebar" ? (propIsExpanded ?? false) : localExpanded;
	const setIsExpanded = variant === "sidebar" ? (propSetIsExpanded ?? (() => {})) : setLocalExpanded;

	const messagesEndRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement | null>(null);

	const isFloating = variant === "floating";
	const isCollapsible = variant === "floating" || variant === "sidebar";
	const isFinished = phase === "finished";

	const scrollToBottom = useCallback(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, []);

	// Scroll to bottom on new messages or when expanded
	useEffect(() => {
		if (isExpanded) {
			scrollToBottom();
		}
	}, [messages.length, isExpanded, scrollToBottom]);

	// Unread counts logic
	const prevMessageCountRef = useRef(messages.length);
	useEffect(() => {
		if (!isExpanded && messages.length > prevMessageCountRef.current) {
			const diff = messages.length - prevMessageCountRef.current;
			// Only count messages that are NOT from the current player
			const newUnread = messages.slice(-diff).filter(m => m.user_id !== user?.uid).length;
			if (newUnread > 0) {
				setUnreadCount(c => {
					const next = c + newUnread;
					onUnreadCountChange?.(next);
					return next;
				});
			}
		}
		prevMessageCountRef.current = messages.length;
	}, [messages, isExpanded, user?.uid, onUnreadCountChange]);

	const handleSend = () => {
		const trimmed = inputValue.trim();
		if (!trimmed) return;
		onSendMessage(trimmed);
		setInputValue("");
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			handleSend();
		}
	};

	const closePanel = () => {
		setIsExpanded(false);
		setUnreadCount(0);
		onUnreadCountChange?.(0);
	};

	const handleExpand = () => {
		setIsExpanded(true);
		setUnreadCount(0);
		onUnreadCountChange?.(0);
		scrollToBottom();
	};

	// Close on outside click
	useEffect(() => {
		const onDocClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (target.closest(".toggle-chat-btn") || target.closest(".emoji-picker-btn") || target.closest(".emoji-reaction-btn")) return;

			const el = panelRef.current;
			if (!el) return;
			if (!el.contains(e.target as Node)) {
				if (isExpanded && isFloating) {
					closePanel();
				}
			}
		};

		document.addEventListener("mousedown", onDocClick);
		return () => {
			document.removeEventListener("mousedown", onDocClick);
		};
	}, [isExpanded, isFloating]);

	if (isFloating && !isExpanded) {
		return (
			<button
				onClick={handleExpand}
				className={cn(
					"toggle-chat-btn fixed z-[250] min-w-28 flex items-center gap-2 rounded-full bg-[var(--color-app-blue)] text-white px-4 py-3 border border-[var(--color-app-border-light)] hover:bg-blue-500 transition-all shadow-xl shadow-blue-500/10",
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
			
			{/* Header */}
			{(isFloating || variant === "sidebar") && (
				<div className="px-4 py-3 border-b border-[var(--color-app-border-light)] flex items-center justify-between">
					<h3 className="text-xs font-black uppercase tracking-widest text-[var(--color-app-text-muted)] flex items-center gap-2">
						<MessageCircle className="w-4 h-4 text-blue-400" />
						Chat
					</h3>
					<button
						onClick={closePanel}
						className="p-1 hover:bg-white/5 rounded transition-colors cursor-pointer"
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

			{/* Message list */}
			<div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-3">
				{messages.length === 0 ?
					<div className="flex items-center justify-center h-full">
						<div className="text-[var(--color-app-text-muted)] text-xs text-center">
							No messages yet. Be the first to chat!
						</div>
					</div>
				:	messages.map(message => (
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
											<div className="w-6 h-6 rounded-full flex items-center justify-center bg-slate-800 text-xs shrink-0 select-none border border-white/10">
												{message.user_id === "bot" ? "🤖" : "👤"}
											</div>
											<div className="flex-1 min-w-0">
												<div className="flex items-baseline gap-1.5 flex-wrap">
													<span className="font-bold text-[var(--color-app-text)] truncate text-xs">
														{message.username}
													</span>
													<span className="text-[9px] text-[var(--color-app-text-muted)]">
														{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
													</span>
												</div>
												<p className="text-xs text-[var(--color-app-text)] font-medium mt-1 whitespace-pre-wrap break-words">
													{message.content}
												</p>
											</div>
										</div>
									</div>
								</div>
							}
						</div>
					))
				}
				<div ref={messagesEndRef} />
			</div>

			{/* Input footer */}
			<div className="p-3 border-t border-[var(--color-app-border-light)] bg-[var(--color-app-panel)] flex items-center gap-2">
				<input
					type="text"
					value={inputValue}
					onChange={e => setInputValue(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="Type a message..."
					className="flex-1 h-9 rounded-xl bg-[var(--color-app-bg)]/60 border border-[var(--color-app-border-light)] px-3 text-xs text-[var(--color-app-text)] placeholder:text-[var(--color-app-text-muted)] outline-none focus:border-[var(--color-app-blue)] transition-colors"
				/>
				<button
					onClick={handleSend}
					disabled={!inputValue.trim()}
					className="w-9 h-9 rounded-xl flex items-center justify-center bg-[var(--color-app-blue)] hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-md cursor-pointer transition-colors">
					<Send className="w-4 h-4" />
				</button>
			</div>
		</div>
	);
}
