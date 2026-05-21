import {
	Bell,
	ChevronDown,
	LogOut,
	MapPin,
	Menu,
	Moon,
	Shield,
	Sun,
	User as UserIcon,
	Check,
	X,
	MessageSquare,
	Clock,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { cn, getRankTitle } from "../lib/utils";
import { useFocusTrap } from "../lib/useFocusTrap";
import type { AppTab } from "../lib/types";
import { getLevel, getExpInCurrentLevel, getExpRequiredForLevel } from "../lib/PlayerStats";
import { toast } from "sonner";
import { useAuth } from "../lib/AuthContext";
import { useTheme } from "../lib/ThemeContext";
import { supabase } from "../lib/supabase";
import LoginModal from "./LoginModal";
import JoinRoomModal from "./JoinRoomModal";
import FeedbackModal from "./FeedbackModal";
import NetworkStatusIndicator from "./NetworkStatusIndicator";
import { Hash } from "lucide-react";
import type { MatchRoom } from "../lib/Matchmaking";
import { joinRoom } from "../lib/Matchmaking";

// ─── Types ───────────────────────────────────────────────────

interface Notification {
	id: string;
	title: string;
	message: string;
	read: boolean;
}

interface HeaderProps {
	activeTab: AppTab;
	setActiveTab: (tab: AppTab) => void;
	onJoinRoom?: (room: MatchRoom) => void;
}

// ─── Nav Items ───────────────────────────────────────────────

const NAV_ITEMS: {
	label: string;
	tab: AppTab;
	matchTabs?: AppTab[];
}[] = [
		{ label: "Home", tab: "Home" },
		{ label: "Leaderboards", tab: "Leaderboards" },
		{ label: "Play", tab: "Setup", matchTabs: ["Setup", "Match"] },
	];

// ─── Helpers ─────────────────────────────────────────────────

function getAvatarUrl(user: {
	displayName?: string | null;
	photoURL?: string | null;
	avatarUrl?: string | null;
}): string {
	if (user.avatarUrl) return user.avatarUrl;
	if (user.photoURL) return user.photoURL;

	const name = (user.displayName || "User").replace(/ /g, "+");
	return `https://ui-avatars.com/api/?name=${name}&background=3B82F6&color=fff`;
}

const GUEST_NOTIFICATIONS: Notification[] = [
	{ id: "1", title: "Welcome", message: "Welcome to GeoZora!", read: false },
	{ id: "2", title: "Sign Up", message: "Create an account to save your progress.", read: false },
];

// ─── Component ───────────────────────────────────────────────

export default function Header({
	activeTab,
	setActiveTab,
	onJoinRoom,
}: HeaderProps) {
	const { user, signOut } = useAuth();
	const { theme, toggleTheme } = useTheme();

	const [openDropdown, setOpenDropdown] = useState<
		"none" | "user" | "notifications" | "mobileNav"
	>("none");
	const [showLoginModal, setShowLoginModal] = useState(false);
	const [showJoinModal, setShowJoinModal] = useState(false);
	const [showFeedbackModal, setShowFeedbackModal] = useState(false);
	const [clickCount, setClickCount] = useState(0);

	const userMenuRef = useRef<HTMLDivElement>(null);
	const notifRef = useRef<HTMLDivElement>(null);
	const mobileNavRef = useRef<HTMLDivElement>(null);

	useFocusTrap(mobileNavRef, openDropdown === "mobileNav");
	useFocusTrap(userMenuRef, openDropdown === "user");
	useFocusTrap(notifRef, openDropdown === "notifications");

	const [notifications, setNotifications] = useState<Notification[]>([]);
	const [userStats, setUserStats] = useState({ exp: 0, elo: 1300 });
	const [isSigningOut, setIsSigningOut] = useState(false);

	// ── Dropdown helpers (mutually exclusive) ──

	const toggleDropdown = useCallback(
		(dropdown: "user" | "notifications" | "mobileNav") => {
			setOpenDropdown(prev => (prev === dropdown ? "none" : dropdown));
		},
		[],
	);

	const closeAllDropdowns = useCallback(() => {
		setOpenDropdown("none");
	}, []);

	// ── Close on outside click ──

	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			const target = event.target as Node;

			if (
				userMenuRef.current &&
				!userMenuRef.current.contains(target) &&
				notifRef.current &&
				!notifRef.current.contains(target) &&
				mobileNavRef.current &&
				!mobileNavRef.current.contains(target)
			) {
				closeAllDropdowns();
			} else if (
				openDropdown === "user" &&
				userMenuRef.current &&
				!userMenuRef.current.contains(target)
			) {
				closeAllDropdowns();
			} else if (
				openDropdown === "notifications" &&
				notifRef.current &&
				!notifRef.current.contains(target)
			) {
				closeAllDropdowns();
			} else if (
				openDropdown === "mobileNav" &&
				mobileNavRef.current &&
				!mobileNavRef.current.contains(target)
			) {
				closeAllDropdowns();
			}
		}

		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [openDropdown, closeAllDropdowns]);

	// ── Close on Escape key ──

	useEffect(() => {
		function handleEscape(event: KeyboardEvent) {
			if (event.key === "Escape") {
				closeAllDropdowns();
			}
		}

		if (openDropdown !== "none") {
			document.addEventListener("keydown", handleEscape);
			return () => document.removeEventListener("keydown", handleEscape);
		}
	}, [openDropdown, closeAllDropdowns]);

	// ── Fetch user data & notifications ──

	useEffect(() => {
		if (user) {
			const fetchStats = async () => {
				const { data } = await supabase
					.from("profiles")
					.select("exp, elo")
					.eq("id", user.uid)
					.single();

				if (data) {
					setUserStats({ exp: data.exp || 0, elo: data.elo || 1300 });
				}
			};

			const fetchNotifications = async () => {
				if (user.isAnonymous) {
					setNotifications(GUEST_NOTIFICATIONS);
					return;
				}
				const { data, error } = await supabase
					.from("notifications")
					.select("*")
					.eq("user_id", user.uid)
					.order("created_at", { ascending: false });

				if (!error && data) {
					setNotifications(
						data.map(n => ({
							id: n.id,
							title: n.title || "Notification",
							message: n.message,
							read: n.is_read,
						})),
					);
				}
			};

			fetchStats();
			fetchNotifications();

			const channel = supabase
				.channel(`header_data:${user.uid}`)
				.on(
					"postgres_changes",
					{
						event: "*",
						schema: "public",
						table: "notifications",
						filter: `user_id=eq.${user.uid}`,
					},
					() => {
						fetchNotifications();
					},
				)
				.on(
					"postgres_changes",
					{
						event: "UPDATE",
						schema: "public",
						table: "profiles",
						filter: `id=eq.${user.uid}`,
					},
					payload => {
						const row = payload.new as any;
						if (row) {
							setUserStats({ exp: row.exp || 0, elo: row.elo || 1300 });
						}
					},
				)
				.subscribe();

			return () => {
				supabase.removeChannel(channel);
			};
		} else {
			setNotifications(GUEST_NOTIFICATIONS);
			setUserStats({ exp: 0, elo: 1300 });
		}
	}, [user]);

	// ── Derived ──

	const unreadCount = useMemo(
		() => notifications.filter(n => !n.read).length,
		[notifications],
	);

	const avatarUrl = useMemo(() => (user ? getAvatarUrl(user) : ""), [user]);

	const level = getLevel(userStats.exp);
	const expInLevel = getExpInCurrentLevel(userStats.exp);
	const expForThisLevel = getExpRequiredForLevel(level);
	const expPercent = Math.min(100, Math.round((expInLevel / expForThisLevel) * 100));

	// ── Actions ──

	const markAllRead = async () => {
		if (user && !user.isAnonymous) {
			await supabase
				.from("notifications")
				.update({ is_read: true })
				.eq("user_id", user.uid);
		}

		setNotifications(prev => prev.map(n => ({ ...n, read: true })));
	};

	const deleteNotif = async (id: string) => {
		if (user && !user.isAnonymous) {
			await supabase.from("notifications").delete().eq("id", id);
		}

		setNotifications(prev => prev.filter(n => n.id !== id));
	};

	// Secret admin access via logo clicks
	const handleLogoClick = () => {
		if (clickCount >= 4) {
			if (user?.isAdmin) {
				setActiveTab("Admin");
			} else {
				toast.error("Admin console is restricted.");
			}
			setClickCount(0);
		} else {
			setClickCount(prev => prev + 1);
			setTimeout(() => setClickCount(0), 1500);
		}
	};

	const handleNavClick = (tab: AppTab) => {
		const protectedTabs = ["Setup", "Match", "Profile", "Leaderboards", "History", "Admin"];
		if (protectedTabs.includes(tab) && !user) {
			setShowLoginModal(true);
			return;
		}
		setActiveTab(tab);
		closeAllDropdowns();
	};

	const handleJoinClick = () => {
		if (!user) {
			setShowLoginModal(true);
			return;
		}
		setShowJoinModal(true);
	};

	const handleJoinRoom = async (code: string) => {
		const { data, error } = await supabase
			.rpc("find_room_by_code", { p_code: code })
			.maybeSingle();

		if (error) {
			toast.error("Error finding room: " + error.message);
			return;
		}

		const room = data as any;

		if (room && onJoinRoom) {
			if (user) {
				await joinRoom(room.id, user.uid);
			}
			const formattedRoom = {
				...room,
				targets:
					typeof room.targets === "string" ?
						JSON.parse(room.targets)
						: room.targets,
				player2_id: user?.uid || room.player2_id,
			} as MatchRoom;
			onJoinRoom(formattedRoom);
			setShowJoinModal(false);
		} else {
			toast.error("Room not found or game already started.");
		}
	};

	return (
		<header className="flex items-center justify-between py-5 px-6 lg:px-10 border-b border-[var(--color-app-border-light)] relative z-[300] w-full bg-[var(--color-app-bg)]">
			{/* ── Logo ── */}
			<button
				onClick={() => {
					handleNavClick("Home");
					handleLogoClick();
				}}
				className="flex items-center gap-2 flex-shrink-0 w-fit max-w-full hover:opacity-80 transition-opacity whitespace-nowrap">
				<div className="w-8 h-8 rounded-full bg-[var(--color-app-blue)] flex items-center justify-center">
					<MapPin className="w-5 h-5 text-white" />
				</div>
				<span className="text-xl font-bold tracking-tight text-[var(--color-app-text)]">
					Geo<span className="text-[var(--color-app-blue)]">Zora</span>
				</span>
			</button>

			<div className="hidden lg:flex items-center flex-shrink-0 ml-3">
				<NetworkStatusIndicator />
			</div>

			{/* ── Desktop Nav ── */}
			<nav className="hidden lg:flex flex-1 justify-center items-center gap-2 max-w-2xl mx-auto">
				{NAV_ITEMS.map(item => {
					const isActive =
						item.matchTabs ?
							item.matchTabs.includes(activeTab)
							: activeTab === item.tab;

					return (
						<button
							key={item.label}
							onClick={() => handleNavClick(item.tab)}
							className={cn(
								"px-4 py-2 rounded-full text-sm font-medium transition-colors",
								isActive ?
									"bg-[var(--color-app-hover)] text-[var(--color-app-text)]"
									: "text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] hover:bg-[var(--color-app-hover)]",
							)}>
							{item.label}
						</button>
					);
				})}
			</nav>

			{/* ── Right Actions ── */}
			<div className="flex items-center justify-end gap-3 sm:gap-5 flex-shrink-0 w-auto lg:w-[250px]">
				{/* Mobile hamburger */}
				<div className="relative lg:hidden" ref={mobileNavRef}>
					<button
						onClick={() => toggleDropdown("mobileNav")}
						className="text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors p-1"
						aria-label="Open navigation menu"
						aria-expanded={openDropdown === "mobileNav"}>
						<Menu className="w-5 h-5" />
					</button>

					{openDropdown === "mobileNav" && (
						<div
							className="absolute right-0 mt-4 w-[200px] bg-[var(--color-app-panel)] border border-[var(--color-app-border)] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
							role="menu">
							{NAV_ITEMS.map(item => {
								const isActive =
									item.matchTabs ?
										item.matchTabs.includes(activeTab)
										: activeTab === item.tab;

								return (
									<button
										key={item.label}
										onClick={() => handleNavClick(item.tab)}
										role="menuitem"
										className={cn(
											"w-full text-left px-4 py-3 text-sm font-medium transition-colors",
											isActive ?
												"bg-[var(--color-app-hover)] text-[var(--color-app-text)]"
												: "text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] hover:bg-[var(--color-app-hover)]",
										)}>
										{item.label}
									</button>
								);
							})}
						</div>
					)}
				</div>

				{/* Join button */}
				<button
					onClick={handleJoinClick}
					className="h-9 px-4 rounded-full text-xs font-bold uppercase tracking-wider bg-[var(--color-app-blue)] text-white hover:bg-blue-500 transition-colors shadow-sm flex-shrink-0 flex items-center justify-center">
					Join
				</button>

				<button
					onClick={toggleTheme}
					className="text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors p-1 flex-shrink-0"
					aria-label={
						theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
					}>
					{theme === "dark" ?
						<Sun className="w-5 h-5" />
						: <Moon className="w-5 h-5" />}
				</button>

				{/* Notifications */}
				<div className="relative flex-shrink-0" ref={notifRef}>
					<button
						onClick={() => toggleDropdown("notifications")}
						className="relative text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors p-1"
						aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
						aria-expanded={openDropdown === "notifications"}>
						<Bell className="w-5 h-5" />
						{unreadCount > 0 && (
							<span className="absolute -top-1 -right-1 w-4 h-4 bg-[var(--color-app-blue)] rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-[var(--color-app-bg)]">
								{unreadCount}
							</span>
						)}
					</button>

					{openDropdown === "notifications" && (
						<div
							className="absolute right-0 mt-4 w-[320px] bg-[var(--color-app-panel)] border border-[var(--color-app-border)] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
							role="menu">
							<div className="p-4 border-b border-[var(--color-app-border-light)] flex items-center justify-between">
								<h3 className="font-bold text-[var(--color-app-text)]">
									Notifications
								</h3>
								{notifications.length > 0 && (
									<button
										onClick={markAllRead}
										className="text-xs text-[var(--color-app-blue)] hover:opacity-80 flex items-center gap-1">
										<Check className="w-3 h-3" /> Mark all read
									</button>
								)}
							</div>

							<div className="max-h-[300px] overflow-y-auto no-scrollbar">
								{notifications.length === 0 ?
									<div className="p-6 text-center text-[var(--color-app-text-muted)] text-sm">
										No new notifications
									</div>
									: notifications.map(n => (
										<div
											key={n.id}
											className={cn(
												"p-4 border-b border-[var(--color-app-border-light)] relative group",
												!n.read ?
													"bg-[var(--color-app-blue)]/5 text-[var(--color-app-text)]"
													: "text-[var(--color-app-text-muted)]",
											)}>
											<div className="flex justify-between gap-2">
												<div className="flex flex-col gap-0.5">
													<p className="text-sm font-bold">{n.title}</p>
													<p className="text-xs text-[var(--color-app-text-muted)]">{n.message}</p>
												</div>
												<button
													onClick={() => deleteNotif(n.id)}
													className="text-[var(--color-app-text-muted)] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
													aria-label="Delete notification">
													<X className="w-4 h-4" />
												</button>
											</div>
											{!n.read && (
												<div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--color-app-blue)]" />
											)}
										</div>
									))
								}
							</div>
						</div>
					)}
				</div>

				{/* User Auth */}
				<div className="relative ml-1" ref={userMenuRef}>
					{user ?
						<button
							onClick={() => toggleDropdown("user")}
							className="flex items-center gap-2 text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors"
							aria-label="Open user menu"
							aria-expanded={openDropdown === "user"}>
							<span className="w-8 h-8 rounded-full overflow-hidden border border-[var(--color-app-border)] ring-2 ring-transparent hover:ring-[var(--color-app-border)] transition-all flex-shrink-0 bg-[var(--color-app-bg)]">
								<img
									src={avatarUrl}
									alt=""
									className="block w-full h-full object-cover object-center"
								/>
							</span>
							<ChevronDown
								className={cn(
									"w-4 h-4 transition-transform duration-200 hidden sm:block",
									openDropdown === "user" && "rotate-180",
								)}
							/>
						</button>
						: <button
							onClick={() => setShowLoginModal(true)}
							className="h-9 px-5 bg-[var(--color-app-blue)] hover:opacity-90 text-white rounded-full text-xs font-bold uppercase tracking-wider transition-opacity whitespace-nowrap flex-shrink-0 flex items-center justify-center">
							Log in
						</button>
					}

					{openDropdown === "user" && user && (
						<div
							className="absolute right-0 mt-4 w-[340px] bg-[var(--color-app-panel)] border border-[var(--color-app-border)] rounded-2xl shadow-2xl p-5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 z-50"
							role="menu">
							{/* User info */}
							<div className="flex items-center gap-3 mb-6">
								<span className="w-12 h-12 rounded-full overflow-hidden border-[3px] border-[var(--color-app-bg)] shadow-[0_0_0_2px_var(--color-app-blue)] flex-shrink-0 bg-[var(--color-app-bg)]">
									<img
										src={avatarUrl}
										alt=""
										className="block w-full h-full object-cover object-center"
									/>
								</span>
								<div>
									<div className="text-[var(--color-app-text)] font-bold text-lg leading-tight truncate w-48">
										{user.displayName || "Guest Explorer"}
									</div>
									<div className="text-[var(--color-app-text-muted)] text-sm truncate w-48">
										{user.isAnonymous ? "Guest Session" : user.email}
									</div>
								</div>
							</div>

							{/* Stats card */}
							<div className="flex flex-col gap-3 bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-xl p-4 mb-4 shadow-inner">
								<div className="flex items-center justify-between mb-1">
									<h2 className="text-base font-bold text-[var(--color-app-text)]">
										Your Progress
									</h2>
									<span className="text-xs bg-[var(--color-app-blue)]/20 text-[var(--color-app-blue)] px-2 py-1 rounded-md font-semibold font-mono">
										Level {level}
									</span>
								</div>

								<div className="flex items-center gap-4">
									{/* XP ring */}
									<div className="relative w-14 h-14 flex items-center justify-center flex-shrink-0">
										<svg className="w-14 h-14 transform -rotate-90">
											<circle
												cx="28"
												cy="28"
												r="24"
												stroke="currentColor"
												strokeWidth="5"
												fill="transparent"
												className="text-[var(--color-app-border-light)]"
											/>
											<circle
												cx="28"
												cy="28"
												r="24"
												stroke="var(--color-app-blue)"
												strokeWidth="5"
												fill="transparent"
												strokeDasharray="150"
												strokeDashoffset={150 - (expPercent / 100) * 150}
												strokeLinecap="round"
											/>
										</svg>
										<span className="absolute text-xs font-bold text-[var(--color-app-text)]">
											{expPercent}%
										</span>
									</div>

									{/* XP text + bar */}
									<div className="flex flex-col justify-center flex-1">
										<span className="text-xs text-[var(--color-app-text-muted)] font-bold uppercase tracking-wider mb-0.5">
											{getRankTitle(level)}
										</span>
										<div className="text-base font-bold text-[var(--color-app-text)] leading-tight">
											{expInLevel}{" "}
											<span className="text-xs font-normal text-[var(--color-app-text-muted)]">
												/ {expForThisLevel.toLocaleString()} XP
											</span>
										</div>
										<div className="w-full bg-[var(--color-app-border)] h-1.5 rounded-full mt-2 overflow-hidden">
											<div
												className="bg-[var(--color-app-blue)] h-1.5 rounded-full transition-all duration-500"
												style={{ width: `${expPercent}%` }}
											/>
										</div>
									</div>
								</div>

								{/* Elo rating — was fetched but never shown */}
								<div className="flex items-center justify-between pt-2 border-t border-[var(--color-app-border-light)]">
									<span className="text-xs text-[var(--color-app-text-muted)]">
										Elo Rating
									</span>
									<span className="text-sm font-bold text-[var(--color-app-text)] font-mono">
										{userStats.elo.toLocaleString()}
									</span>
								</div>
							</div>

							{/* Menu items */}
							<div className="flex flex-col gap-1">
								{
									<button
										onClick={() => handleNavClick("Profile")}
										role="menuitem"
										className="flex items-center gap-3 w-full text-left px-3 py-2.5 text-sm text-[var(--color-app-text)] hover:bg-[var(--color-app-hover)] rounded-lg transition-colors">
										<UserIcon className="w-4 h-4 text-[var(--color-app-text-muted)]" />
										My Profile
									</button>
								}
								<button
									onClick={() => handleNavClick("History")}
									role="menuitem"
									className="flex items-center gap-3 w-full text-left px-3 py-2.5 text-sm text-[var(--color-app-text)] hover:bg-[var(--color-app-hover)] rounded-lg transition-colors">
									<Clock className="w-4 h-4 text-[var(--color-app-text-muted)]" />
									Match History
								</button>
								<button
									onClick={() => {
										setShowFeedbackModal(true);
										closeAllDropdowns();
									}}
									role="menuitem"
									className="flex items-center gap-3 w-full text-left px-3 py-2.5 text-sm text-[var(--color-app-text)] hover:bg-[var(--color-app-hover)] rounded-lg transition-colors">
									<MessageSquare className="w-4 h-4 text-[var(--color-app-text-muted)]" />
									Send Feedback
								</button>
								{user.isAdmin && (
									<button
										onClick={() => handleNavClick("Admin")}
										role="menuitem"
										className="flex items-center gap-3 w-full text-left px-3 py-2.5 text-sm text-[var(--color-app-text)] hover:bg-[var(--color-app-hover)] rounded-lg transition-colors">
										<Shield className="w-4 h-4 text-amber-500" />
										Admin Console
									</button>
								)}
								<div className="h-px w-full bg-[var(--color-app-border-light)] my-1" />
								<button
									role="menuitem"
									onClick={async () => {
										setIsSigningOut(true);
										setActiveTab("Home");
										closeAllDropdowns();
										try {
											localStorage.removeItem("geozora_creator_settings");
											await signOut();
										} finally {
											setIsSigningOut(false);
										}
									}}
									disabled={isSigningOut}
									className="flex items-center gap-3 w-full text-left px-3 py-2.5 text-sm font-medium text-red-500 hover:bg-red-500/10 rounded-lg transition-colors mt-1 disabled:opacity-60">
									{isSigningOut ?
										<>
											<div className="w-4 h-4 border-2 border-red-500/30 border-t-red-500 rounded-full animate-spin" />{" "}
											Signing out...
										</>
										: <>
											<LogOut className="w-4 h-4" /> Sign Out
										</>
									}
								</button>
							</div>
						</div>
					)}
				</div>
			</div>

			{showLoginModal && (
				<LoginModal onClose={() => setShowLoginModal(false)} />
			)}

			{showJoinModal && (
				<JoinRoomModal
					onClose={() => setShowJoinModal(false)}
					onJoin={handleJoinRoom}
				/>
			)}

			{showFeedbackModal && (
				<FeedbackModal
					isOpen={showFeedbackModal}
					onClose={() => setShowFeedbackModal(false)}
				/>
			)}
		</header>
	);
}
