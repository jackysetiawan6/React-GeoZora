import {
	ReactNode,
	createContext,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { supabase, logSystemError } from "./supabase";
import { toast } from "sonner";
import {
	loadCachedUserPreferences,
	saveCachedUserPreferences,
} from "./userPreferencesCache";

export type UserType = {
	uid: string;
	displayName: string;
	photoURL: string | null;
	avatarUrl: string | null;
	isAnonymous: boolean;
	email: string | null;
	isAdmin: boolean;
	isBanned: boolean;
	banReason: string | null;
	distanceMetric: string;
	mapPreference: string;
} | null;

interface AuthContextType {
	user: UserType;
	loading: boolean;
	signInAsGuest: () => Promise<void>;
	signOut: () => Promise<void>;
	logActivity: (action: string, details?: any) => Promise<void>;
	refreshUser: () => Promise<void>;
	updateAvatar: (url: string | null) => Promise<void>;
	updateSettings: (settings: {
		displayName?: string;
		distanceMetric?: string;
		mapPreference?: string;
	}) => Promise<void>;
}

type AuthOperation = "signing-in" | "signing-out" | null;

const AuthContext = createContext<AuthContextType>({
	user: null,
	loading: true,
	signInAsGuest: async () => {},
	signOut: async () => {},
	logActivity: async () => {},
	refreshUser: async () => {},
	updateAvatar: async () => {},
	updateSettings: async () => {},
});

const DEFAULT_DISTANCE_METRIC = "km";
const DEFAULT_MAP_PREFERENCE = "roadmap";

function getResolvedPreferences({
	profileDistanceMetric,
	profileMapPreference,
	cachedPreferences,
}: {
	profileDistanceMetric?: string | null;
	profileMapPreference?: string | null;
	cachedPreferences?: {
		distanceMetric?: string;
		mapPreference?: string;
	} | null;
}) {
	return {
		distanceMetric:
			profileDistanceMetric || cachedPreferences?.distanceMetric || DEFAULT_DISTANCE_METRIC,
		mapPreference:
			profileMapPreference || cachedPreferences?.mapPreference || DEFAULT_MAP_PREFERENCE,
	};
}

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<UserType>(null);
	const [loading, setLoading] = useState(true);
	const [authOperation, setAuthOperation] = useState<AuthOperation>(null);
	const loggedLoginKeyRef = useRef<string | null>(null);
	const pendingLoginKeyRef = useRef<string | null>(null);
	const authOperationRef = useRef<AuthOperation>(null);

	useEffect(() => {
		authOperationRef.current = authOperation;
	}, [authOperation]);

	const logActivity = async (action: string, details: any = {}) => {
		if (!user) return;

		try {
			await supabase.from("activity_logs").insert({
				user_id: user.uid,
				action,
				details,
			});
		} catch (err) {
			console.error("Failed to log activity", err);
		}
	};

	const refreshUser = async () => {
		if (!user) return;
		try {
			const cachedPreferences = loadCachedUserPreferences(user.uid, user.isAnonymous);
			const { data } = await supabase
				.from("profiles")
				.select(
					"display_name, is_admin, is_banned, ban_reason, distance_metric, map_preference, avatar_url",
				)
				.eq("id", user.uid)
				.single();

			if (data) {
				if (data.is_banned) {
					toast.error(`Access Denied: This account has been banned.\nReason: ${data.ban_reason || "No reason provided."}`);
					await supabase.auth.signOut();
					setUser(null);
					return;
				}
				setUser(prev =>
					prev ?
						{
							...prev,
							displayName: data.display_name || prev.displayName,
							isAdmin: data.is_admin || false,
							isBanned: false,
							banReason: null,
							...getResolvedPreferences({
								profileDistanceMetric: data.distance_metric,
								profileMapPreference: data.map_preference,
								cachedPreferences,
							}),
							avatarUrl: data.avatar_url || null,
						}
					:	null,
				);
				saveCachedUserPreferences(
					user.uid,
					{
						distanceMetric:
							data.distance_metric || cachedPreferences?.distanceMetric || DEFAULT_DISTANCE_METRIC,
						mapPreference:
							data.map_preference || cachedPreferences?.mapPreference || DEFAULT_MAP_PREFERENCE,
					},
					user.isAnonymous,
				);
			}
		} catch (err) {
			console.error("Failed to refresh user", err);
		}
	};

	const updateAvatar = async (url: string | null) => {
		if (!user) return;
		try {
			// Use secure RPC to update avatar to avoid RLS/401 problems
			const res = await supabase.rpc('update_profile_safe', {
				p_id: user.uid,
				p_display_name: null,
				p_avatar_url: url,
				p_distance_metric: null,
				p_map_preference: null,
			});

			if (res?.error) throw res.error;
			if (res?.data && (res.data as any).status === 'error') {
				throw new Error((res.data as any).message || 'update_failed');
			}
			await refreshUser();
		} catch (err) {
			console.error("Failed to update avatar", err);
			throw err;
		}
	};

	const updateSettings = async (settings: {
		displayName?: string;
		distanceMetric?: string;
		mapPreference?: string;
	}) => {
		if (!user) return;
		try {
			const nextDistanceMetric = settings.distanceMetric || user.distanceMetric || DEFAULT_DISTANCE_METRIC;
			const nextMapPreference = settings.mapPreference || user.mapPreference || DEFAULT_MAP_PREFERENCE;
			const res = await supabase.rpc('update_profile_safe', {
				p_id: user.uid,
				p_display_name: settings.displayName || null,
				p_avatar_url: null,
				p_distance_metric: settings.distanceMetric || null,
				p_map_preference: settings.mapPreference || null,
			});

			if (res?.error) throw res.error;
			if (res?.data && (res.data as any).status === 'error') {
				throw new Error((res.data as any).message || 'update_failed');
			}
			setUser(prev =>
				prev ?
					{
						...prev,
						displayName: settings.displayName || prev.displayName,
						distanceMetric: nextDistanceMetric,
						mapPreference: nextMapPreference,
					}
				: null,
			);
			saveCachedUserPreferences(
				user.uid,
				{
					distanceMetric: nextDistanceMetric,
					mapPreference: nextMapPreference,
				},
				user.isAnonymous,
			);
			await refreshUser();
		} catch (err) {
			console.error("Failed to update settings", err);
			throw err;
		}
	};

	useEffect(() => {
		const handleAuthChange = async (session: any) => {
			if (session?.user) {
				const supaUser = session.user;
				const isAnon =
					supaUser.is_anonymous ||
					supaUser.app_metadata?.provider === "anonymous";
				const cachedPreferences = loadCachedUserPreferences(supaUser.id, isAnon);

				const userObj: UserType = {
					uid: supaUser.id,
					email: supaUser.email || null,
					displayName:
						supaUser.user_metadata?.full_name ||
						supaUser.user_metadata?.name ||
						supaUser.email?.split("@")[0] ||
						"Guest",
					photoURL:
						supaUser.user_metadata?.avatar_url ||
						supaUser.user_metadata?.picture ||
						null,
					avatarUrl: null,
					isAnonymous: isAnon,
					isAdmin: false,
					isBanned: false,
					banReason: null,
					...getResolvedPreferences({ cachedPreferences }),
				};

				try {
					const { data: syncResult, error: syncError } = await supabase.rpc('sync_profile', {
						p_user_id: supaUser.id,
						p_email: supaUser.email || null,
						p_display_name: isAnon ? null : userObj.displayName,
					});

					if (syncError) {
						console.error('Failed to sync profile via RPC:', syncError);
					}

					const syncedDisplayName =
						(syncResult as any)?.display_name || userObj.displayName;
					userObj.displayName = syncedDisplayName;

					// Fetch existing profile first to avoid overwriting a custom avatar with null
					const { data: existingProfile } = await supabase
						.from("profiles")
						.select("avatar_url")
						.eq("id", supaUser.id)
						.maybeSingle();

					const resolvedAvatarUrl = existingProfile?.avatar_url || userObj.photoURL;

					const { error: profileError } = await supabase
						.from("profiles")
						.update({
							email: supaUser.email || null,
							avatar_url: resolvedAvatarUrl,
							last_seen: new Date().toISOString(),
							updated_at: new Date().toISOString(),
						})
						.eq("id", supaUser.id);

					if (profileError) {
						console.error("Failed to upsert profile row:", profileError);
					}

					// Fetch full profile info including custom fields
					const { data: profile } = await supabase
						.from("profiles")
						.select(
							"display_name, is_admin, is_banned, ban_reason, distance_metric, map_preference, avatar_url",
						)
						.eq("id", supaUser.id)
						.single();

					if (profile) {
						if (profile.is_banned) {
							toast.error(`Access Denied: This account has been banned.\nReason: ${profile.ban_reason || "No reason provided."}`);
							await supabase.auth.signOut();
							setUser(null);
							setLoading(false);
							return;
						}
						userObj.displayName = profile.display_name || syncedDisplayName;
						userObj.isAdmin = profile.is_admin || false;
						userObj.isBanned = false;
						userObj.banReason = null;
						userObj.distanceMetric = profile.distance_metric || userObj.distanceMetric;
						userObj.mapPreference = profile.map_preference || userObj.mapPreference;
						userObj.avatarUrl = profile.avatar_url || null;
					}

					setUser({ ...userObj });
					saveCachedUserPreferences(
						supaUser.id,
						{
							distanceMetric: userObj.distanceMetric,
							mapPreference: userObj.mapPreference,
						},
						isAnon,
					);

						const loginKey = `${supaUser.id}:${supaUser.last_sign_in_at || supaUser.created_at || "session"}`;
						if (
							loggedLoginKeyRef.current !== loginKey &&
							pendingLoginKeyRef.current !== loginKey
						) {
							pendingLoginKeyRef.current = loginKey;
							try {
								await supabase.from("activity_logs").insert({
									user_id: supaUser.id,
									action: "login",
									details: {
										provider: supaUser.app_metadata?.provider || "password",
									},
								});
								loggedLoginKeyRef.current = loginKey;
							} catch (err) {
								console.error("Failed to log login activity", err);
							} finally {
								if (pendingLoginKeyRef.current === loginKey) {
									pendingLoginKeyRef.current = null;
								}
							}
						}
				} catch (err) {
					console.error("Failed to sync profile with Supabase:", err);
					setUser({ ...userObj }); // Still set the basic user obj
					saveCachedUserPreferences(
						supaUser.id,
						{
							distanceMetric: userObj.distanceMetric,
							mapPreference: userObj.mapPreference,
						},
						isAnon,
					);
				}
			} else {
					loggedLoginKeyRef.current = null;
					pendingLoginKeyRef.current = null;
				setUser(null);
			}
				if (authOperationRef.current) {
					setAuthOperation(null);
				}
			setLoading(false);
		};

		// Initial session
		supabase.auth.getSession().then(({ data: { session } }) => {
			handleAuthChange(session);
		});

		// Listeners
		const {
			data: { subscription },
		} = supabase.auth.onAuthStateChange((_event, session) => {
			handleAuthChange(session);
		});

		return () => subscription.unsubscribe();
	}, []);

	useEffect(() => {
		// Global listener for unauthorized events (emitted by supabase fetch wrapper)
		const onUnauthorized = async () => {
			toast.error('Session expired. Please sign in again.');
			try {
				await supabase.auth.signOut();
			} catch (e) {
				console.error('Failed to sign out after unauthorized event:', e);
			}
			setUser(null);
		};
		window.addEventListener('supabase:unauthorized', onUnauthorized as EventListener);

		let presenceInterval: number;

		const updatePresence = async () => {
			if (user) {
				try {
					await supabase
						.from("profiles")
						.update({
							online_status: true,
							last_seen: new Date().toISOString(),
						})
						.eq("id", user.uid);
				} catch (err) {
					// Presence update failures are non-critical; log at debug level
					console.debug("Presence update failed (non-critical):", err);
				}
			}
		};

		const setOffline = async () => {
			if (user) {
				try {
					await supabase
						.from("profiles")
						.update({
							online_status: false,
							last_seen: new Date().toISOString(),
						})
						.eq("id", user.uid);
				} catch (err) {
					console.debug("Set offline failed (non-critical):", err);
				}
			}
		};

		if (user) {
			updatePresence();
			presenceInterval = window.setInterval(updatePresence, 2 * 60 * 1000); // Every 2 mins to keep last_seen fresh

			window.addEventListener("pagehide", setOffline);
			window.addEventListener("beforeunload", setOffline);
		}

		return () => {
			if (presenceInterval) clearInterval(presenceInterval);
			window.removeEventListener("beforeunload", setOffline);
			window.removeEventListener("pagehide", setOffline);
			window.removeEventListener('supabase:unauthorized', onUnauthorized as EventListener);
		};
	}, [user]);


	useEffect(() => {
		let notifChannel: any = null;
		let authChannel: any = null;

		if (user) {
			// Subscribe to targeted user notifications (admin broadcasts)
			notifChannel = supabase.channel(`user_notifications_${user.uid}`);
			notifChannel.on('broadcast', { event: 'ban' }, (payload: any) => {
				const reason = payload?.payload?.reason || "No reason provided.";
				toast.error(`Access Denied: This account has been banned.\nReason: ${reason}`);
				supabase.auth.signOut();
				setUser(null);
			});
			notifChannel.subscribe();

			authChannel = supabase
				.channel(`auth_context_${user.uid}`)
				.on(
					"postgres_changes",
					{
						event: "DELETE",
						schema: "public",
						table: "profiles",
						filter: `id=eq.${user.uid}`,
					},
					() => {
						// Profile was deleted (likely due to inactivity cleanup), force logout
						supabase.auth.signOut();
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
					async (payload) => {
						if (payload.new && (payload.new as any).is_banned) {
							toast.error(`Access Denied: This account has been banned.\nReason: ${(payload.new as any).ban_reason || "No reason provided."}`);
							await supabase.auth.signOut();
							setUser(null);
						}
					},
				)
				.subscribe();
		}

		return () => {
			if (notifChannel) {
				supabase.removeChannel(notifChannel);
			}
			if (authChannel) {
				supabase.removeChannel(authChannel);
			}
		};
	}, [user]);

	// Periodic refresh is intentionally removed.
	// The postgres_changes realtime subscription (below) already pushes profile/ban
	// changes in real-time, making the 45-second polling redundant and wasteful.


	const signInAsGuest = async () => {
		try {
			setAuthOperation("signing-in");
			const { error } = await supabase.auth.signInAnonymously();
			if (error) throw error;
		} catch (err) {
			console.error("Guest login failed:", err);
			setAuthOperation(null);
			toast.error("Failed to sign in as guest. Please check your internet connection.");
			void logSystemError("Guest login failure", { error: err instanceof Error ? err.message : String(err) });
		}
	};

	const signOutUser = async () => {
		if (user) {
			setAuthOperation("signing-out");
			if (user.isAnonymous) {
				// Delete guest profile from DB on logout via secure RPC
				try {
					await supabase.rpc("delete_guest_profile", { p_user_id: user.uid });
				} catch (err) {
					console.error("Failed to cleanup guest profile on logout", err);
				}
			} else {
				await Promise.all([
					logActivity("logout"),
					supabase
						.from("profiles")
						.update({
							online_status: false,
							last_seen: new Date().toISOString(),
						})
						.eq("id", user.uid)
						.then(),
				]);
			}
			await supabase.auth.signOut();
			setAuthOperation(null);
		}
	};

	const isBlocking = loading || authOperation !== null;
	const blockingMessage =
		authOperation === "signing-in" ? "Signing you in..."
		: authOperation === "signing-out" ? "Signing you out..."
		: "Syncing profile data...";

	return (
		<AuthContext.Provider
			value={{
				user,
				loading,
				signInAsGuest,
				signOut: signOutUser,
				logActivity,
				refreshUser,
				updateAvatar,
				updateSettings,
			}}>
			{!loading && children}
			{isBlocking && (
				<div className="fixed inset-0 z-[1000] bg-[var(--color-app-bg)] text-[var(--color-app-text)] flex items-center justify-center font-sans overflow-hidden">
					<div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600/20 blur-[120px] rounded-full pointer-events-none" />
					<div className="absolute top-[20%] right-[-10%] w-[40%] h-[40%] bg-indigo-600/10 blur-[120px] rounded-full pointer-events-none" />
					<div className="flex flex-col items-center gap-6 z-10">
						<div className="w-12 h-12 border-4 border-[var(--color-app-blue)] border-t-transparent rounded-full animate-spin" />
						<div className="flex flex-col items-center gap-2 text-center px-6">
							<h2 className="text-xl font-medium tracking-tight">
								{blockingMessage}
							</h2>
							<p className="text-[var(--color-app-text-muted)] text-sm">
								Please wait while GeoZora updates your session.
							</p>
						</div>
					</div>
				</div>
			)}
		</AuthContext.Provider>
	);
}

export const useAuth = () => useContext(AuthContext);
