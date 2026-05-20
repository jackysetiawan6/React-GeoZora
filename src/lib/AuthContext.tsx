import { ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';

export type UserType = { 
  uid: string; 
  displayName: string; 
  photoURL: string | null;
  avatarUrl: string | null;
  isAnonymous: boolean; 
  email: string | null;
  isAdmin: boolean;
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
  updateSettings: (settings: { distanceMetric?: string; mapPreference?: string }) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({ 
  user: null, 
  loading: true, 
  signInAsGuest: async () => {}, 
  signOut: async () => {},
  logActivity: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserType>(null);
  const [loading, setLoading] = useState(true);

  const logActivity = async (action: string, details: any = {}) => {
    if (user && !user.isAnonymous) {
      try {
        await supabase.from('activity_logs').insert({
          user_id: user.uid,
          action,
          details
        });
      } catch (err) {
        console.error("Failed to log activity", err);
      }
    }
  };

  const refreshUser = async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from('profiles')
        .select('display_name, is_admin, distance_metric, map_preference, avatar_url')
        .eq('id', user.uid)
        .single();
      
      if (data) {
        setUser(prev => prev ? {
          ...prev,
          displayName: data.display_name || prev.displayName,
          isAdmin: data.is_admin || false,
          distanceMetric: data.distance_metric || 'km',
          mapPreference: data.map_preference || 'roadmap',
          avatarUrl: data.avatar_url || null
        } : null);
      }
    } catch (err) {
      console.error("Failed to refresh user", err);
    }
  };

  const updateAvatar = async (url: string | null) => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: url })
        .eq('id', user.uid);
      
      if (error) throw error;
      await refreshUser();
    } catch (err) {
      console.error("Failed to update avatar", err);
      throw err;
    }
  };

  const updateSettings = async (settings: { distanceMetric?: string, mapPreference?: string }) => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          distance_metric: settings.distanceMetric,
          map_preference: settings.mapPreference
        })
        .eq('id', user.uid);
      
      if (error) throw error;
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
        const isAnon = supaUser.is_anonymous || supaUser.app_metadata?.provider === 'anonymous';
        
        const userObj: UserType = {
          uid: supaUser.id,
          email: supaUser.email || null,
          displayName: supaUser.user_metadata?.full_name || supaUser.user_metadata?.name || supaUser.email?.split('@')[0] || "Guest",
          photoURL: supaUser.user_metadata?.avatar_url || supaUser.user_metadata?.picture || null,
          avatarUrl: null,
          isAnonymous: isAnon,
          isAdmin: false,
          distanceMetric: 'km',
          mapPreference: 'roadmap'
        };

        // Keep profile sync on the table path so startup does not depend on RPC availability.
        try {
          const { error: profileError } = await supabase
            .from('profiles')
            .upsert({
              id: supaUser.id,
              email: supaUser.email || null,
              display_name: userObj.displayName,
              avatar_url: userObj.photoURL,
              last_seen: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });

          if (profileError) {
            console.error('Failed to upsert profile row:', profileError);
          }

          // Fetch full profile info including custom fields
          const { data: profile } = await supabase
            .from('profiles')
            .select('display_name, is_admin, distance_metric, map_preference, avatar_url')
            .eq('id', supaUser.id)
            .single();

          if (profile) {
            userObj.displayName = profile.display_name || userObj.displayName;
            userObj.isAdmin = profile.is_admin || false;
            userObj.distanceMetric = profile.distance_metric || 'km';
            userObj.mapPreference = profile.map_preference || 'roadmap';
            userObj.avatarUrl = profile.avatar_url || null;
          }

          setUser({ ...userObj });

          if (!userObj.isAnonymous) {
            await supabase.from('activity_logs').insert({
              user_id: supaUser.id,
              action: 'login',
              details: { provider: supaUser.app_metadata?.provider || 'password' }
            });
          }
        } catch (err) {
          console.error("Failed to sync profile with Supabase:", err);
          setUser({ ...userObj }); // Still set the basic user obj
        }

      } else {
        setUser(null);
      }
      setLoading(false);
    };

    // Initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      handleAuthChange(session);
    });

    // Cleanup old guest accounts (stale > 10m)
    // Guest cleanup is intentionally not part of startup anymore.
    // The app should remain usable even when the backend RPC surface is unavailable.

    // Listeners
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handleAuthChange(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let presenceInterval: number;

    const updatePresence = async () => {
      if (user) {
        try {
          await supabase.from('profiles').update({
            online_status: true,
            last_seen: new Date().toISOString()
          }).eq('id', user.uid);
        } catch (err) {
          // ignore
        }
      }
    };

    const setOffline = async () => {
      if (user) {
        try {
          // For guests, we might want to just delete immediately on window close if they chose so
          // But for now just set offline
          await supabase.from('profiles').update({
            online_status: false,
            last_seen: new Date().toISOString()
          }).eq('id', user.uid);
        } catch (err) {}
      }
    };

    if (user) {
      updatePresence();
      presenceInterval = window.setInterval(updatePresence, 2 * 60 * 1000); // More frequent (2 mins) to keep last_seen fresh
      window.addEventListener('beforeunload', setOffline);
    }

    return () => {
      if (presenceInterval) clearInterval(presenceInterval);
      window.removeEventListener('beforeunload', setOffline);
    };
  }, [user]);

  useEffect(() => {
    let channel: any = null;
    if (user) {
      channel = supabase
        .channel(`auth_context_${user.uid}`)
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'profiles', filter: `id=eq.${user.uid}` },
          () => {
            // Profile was deleted (likely due to inactivity cleanup), force logout
            supabase.auth.signOut();
          }
        )
        .subscribe();
    }
    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [user]);

  const signInAsGuest = async () => {
    try {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
    } catch (err) {
      console.error("Guest login failed:", err);
    }
  };

  const signOutUser = async () => {
    if (user) {
      if (user.isAnonymous) {
        // Delete guest profile from DB on logout via secure RPC
        try {
          await supabase.rpc('delete_guest_profile', { p_user_id: user.uid });
        } catch (err) {
          console.error("Failed to cleanup guest profile on logout", err);
        }
      } else {
        await Promise.all([
          logActivity('logout'),
          supabase.from('profiles').update({
            online_status: false,
            last_seen: new Date().toISOString()
          }).eq('id', user.uid).then()
        ]);
      }
      await supabase.auth.signOut();
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signInAsGuest, signOut: signOutUser, logActivity, refreshUser, updateAvatar, updateSettings }}>
      {loading ? (
        <div className="h-screen w-screen bg-[var(--color-app-bg)] flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-4 border-[var(--color-app-blue)] border-t-transparent rounded-full animate-spin"></div>
            <p className="text-[var(--color-app-text-muted)] text-sm font-medium">Syncing profile data...</p>
          </div>
        </div>
      ) : children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
