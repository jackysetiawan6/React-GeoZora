import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import { cn, getRankTitle, getRankColor } from '../lib/utils';
import { 
  User as UserIcon, 
  Mail, 
  Shield, 
  Settings as SettingsIcon, 
  Save, 
  Trophy, 
  Target, 
  TrendingUp,
  Map as MapIcon,
  CheckCircle2,
  AlertCircle,
  X,
  Camera,
  Award,
  Star,
  Globe,
  Crosshair,
  Medal,
  RefreshCcw,
  Info
} from 'lucide-react';
import { fetchPlayerStats, PlayerStats, getLevel, getExpInCurrentLevel, getExpRequiredForLevel, getExpToNextLevel } from '../lib/PlayerStats';
import { toast } from 'sonner';

// Avatar samples using DiceBear API
const AVATAR_STYLES = ['avataaars', 'pixel-art', 'bottts', 'adventurer'];
const AVATAR_SAMPLES = Array.from({ length: 40 }, (_, i) => {
  const style = AVATAR_STYLES[i % AVATAR_STYLES.length];
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${i + 137}`;
});

interface Badge {
  id: string;
  name: string;
  description: string;
  icon: any;
  color: string;
  condition: (stats: PlayerStats | null, level: number) => boolean;
}

const BADGES: Badge[] = [
  { id: 'rookie', name: 'Rookie Explorer', description: 'Play your first match', icon: MapIcon, color: 'text-blue-400', condition: (s) => (s?.games_played || 0) >= 1 },
  { id: 'sniper', name: 'Elite Sniper', description: 'Avg score over 4500', icon: Crosshair, color: 'text-rose-400', condition: (s) => (s?.last_avg_score || 0) >= 4500 },
  { id: 'veteran', name: 'Seasoned Veteran', description: 'Reach Level 5', icon: Trophy, color: 'text-amber-400', condition: (_, l) => l >= 5 },
  { id: 'traveler', name: 'World Traveler', description: 'Play 10+ matches', icon: Globe, color: 'text-emerald-400', condition: (s) => (s?.games_played || 0) >= 10 },
  { id: 'pro', name: 'Pro Competitor', description: 'Reach 1500 ELO', icon: Medal, color: 'text-purple-400', condition: (s) => (s?.elo || 1300) >= 1500 },
  { id: 'legend', name: 'Living Legend', description: 'Reach Level 10', icon: Star, color: 'text-orange-500', condition: (_, l) => l >= 10 },
];

export default function Profile() {
  const { user, refreshUser, updateAvatar, updateSettings, signOut } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [distanceMetric, setDistanceMetric] = useState(user?.distanceMetric || 'km');
  const [mapPreference, setMapPreference] = useState(user?.mapPreference || 'roadmap');
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const [tempAvatar, setTempAvatar] = useState<string | null>(null);
  const [infoPopup, setInfoPopup] = useState<'elo' | 'rank' | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteText, setDeleteText] = useState('');

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setDistanceMetric(user.distanceMetric);
      setMapPreference(user.mapPreference || 'roadmap');
      
      const loadStats = async () => {
        const playerStats = await fetchPlayerStats(user.uid);
        setStats(playerStats);
      };
      loadStats();
    }
  }, [user]);

  const handleSave = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e && 'preventDefault' in e) e.preventDefault();
    if (!user) return;

    setLoading(true);
    setMessage(null);

    try {
      // If the user changed their display name, ensure it's available
      if (displayName && displayName !== user.displayName) {
        try {
          const { data: existing, error: checkErr } = await supabase
            .from('profiles')
            .select('id')
            .eq('display_name', displayName)
            .neq('id', user.uid)
            .limit(1);

          if (checkErr) throw checkErr;
          if (existing && (existing as any).length > 0) {
            setMessage({ type: 'error', text: 'Display name is already taken. Please choose another.' });
            return;
          }
        } catch (err) {
          console.error('Display name check failed:', err);
          // allow save to proceed if check fails due to transient error
        }
      }

        await updateSettings({
          displayName,
          distanceMetric,
          mapPreference,
        });

      await refreshUser();
      setMessage({ type: 'success', text: 'Profile updated successfully!' });
    } catch (err) {
      console.error('Update failed:', err);
      const status = (err as any)?.status;
      const errMsg = (err as any)?.message;
      if (status === 401) {
        toast.error('Session expired. Please sign in again.');
        try { await supabase.auth.signOut(); } catch (e) {}
      } else if (errMsg === 'display_name_taken') {
        setMessage({ type: 'error', text: 'Display name is already taken. Please choose another.' });
      } else {
        setMessage({ type: 'error', text: 'Failed to update profile. Please try again.' });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarSelect = async (url: string | null) => {
    try {
      await updateAvatar(url);
      setIsAvatarModalOpen(false);
      setTempAvatar(null);
      setMessage({ type: 'success', text: 'Profile picture updated!' });
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to update profile picture.' });
    }
  };
  const handleDeleteAccount = async () => {
    if (!user || deleteText !== 'DELETE') return;
    try {
      await supabase.from('profiles').delete().eq('id', user.uid);
      await signOut();
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to delete account. Please try again.' });
      setDeleteConfirmOpen(false);
    }
  };

  if (!user) return null;

  const currentExp = stats?.exp || 0;
  const level = getLevel(currentExp);
  const expInCurrentLevel = getExpInCurrentLevel(currentExp);
  const expForThisLevel = getExpRequiredForLevel(level);
  const expPercent = Math.min(100, Math.round((expInCurrentLevel / expForThisLevel) * 100));
  const nextLevelExp = getExpToNextLevel(currentExp);

  const defaultAvatar = user.photoURL || `https://ui-avatars.com/api/?name=${(user.displayName || 'User').replace(/ /g, '+')}&background=3B82F6&color=fff&size=128`;
  const currentAvatar = user.avatarUrl || defaultAvatar;

  return (
    <div className="w-full animate-in fade-in duration-700">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Column: Summary & Achievements */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          {/* Profile Basic Card */}
          <div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-3xl p-8 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--color-app-blue)]/10 rounded-full -mr-16 -mt-16 blur-3xl opacity-50" />
            
            <div className="flex flex-col items-center gap-6 relative z-10">
              <div className="relative group">
                <div className="w-28 h-28 rounded-full border-4 border-[var(--color-app-bg)] shadow-2xl overflow-hidden bg-[var(--color-app-bg)]">
                  <img 
                    src={currentAvatar}
                    alt="Profile"
                    className="w-full h-full object-cover"
                  />
                </div>
                <button 
                  onClick={() => setIsAvatarModalOpen(true)}
                  className="absolute bottom-0 right-0 bg-[var(--color-app-blue)] p-2.5 rounded-full border-2 border-[var(--color-app-panel)] text-white shadow-lg transform hover:scale-110 transition-all active:scale-95"
                >
                  <Camera className="w-4 h-4" />
                </button>
              </div>

              <div className="text-center">
                <h1 className="text-2xl font-black text-[var(--color-app-text)] mb-1 truncate max-w-[200px]">
                  {user.displayName}
                </h1>
                <button 
                  onClick={() => setInfoPopup('rank')}
                  className="text-[var(--color-app-text-muted)] text-[10px] uppercase font-black tracking-widest bg-[var(--color-app-hover)] py-1 px-3 rounded-full border border-[var(--color-app-border-light)] hover:bg-[var(--color-app-hover)]/80 transition-colors flex items-center gap-2 mx-auto cursor-pointer"
                >
                  <span className={cn("font-black", getRankColor(level))}>{getRankTitle(level)}</span> Level {level}
                  <Info className="w-2.5 h-2.5" />
                </button>
              </div>

              <div className="w-full space-y-2">
                <div className="flex justify-between text-[10px] font-black uppercase tracking-wider text-[var(--color-app-text-muted)]">
                  <span>Level {level}</span>
                  <span>{expInCurrentLevel.toLocaleString()}/{expForThisLevel.toLocaleString()} XP</span>
                </div>
                <div className="w-full h-2.5 bg-[var(--color-app-bg)] rounded-full border border-[var(--color-app-border-light)] p-0.5">
                  <div 
                    className="h-full bg-[var(--color-app-blue)] rounded-full shadow-[0_0_10px_rgba(59,130,246,0.3)] transition-all duration-1000"
                    style={{ width: `${expPercent}%` }}
                  />
                </div>
                <p className="text-[10px] text-[var(--color-app-text-muted)] text-center italic">
                  Gain {nextLevelExp} XP to level up
                </p>
              </div>

              <div className="w-full grid grid-cols-2 gap-4">
                <div 
                  className="bg-[var(--color-app-bg)]/50 p-3 rounded-2xl border border-[var(--color-app-border-light)]/50 text-center flex flex-col justify-center items-center"
                >
                  <div className="text-[10px] font-black uppercase text-[var(--color-app-text-muted)] tracking-wider mb-1">
                    Elo Rating
                  </div>
                  <div className="text-xl font-black text-amber-500">{stats?.elo || 1300}</div>
                </div>
                <div className="bg-[var(--color-app-bg)]/50 p-3 rounded-2xl border border-[var(--color-app-border-light)]/50 text-center flex flex-col justify-center">
                  <div className="text-[10px] font-black uppercase text-[var(--color-app-text-muted)] tracking-wider mb-1">Games</div>
                  <div className="text-xl font-black text-[var(--color-app-blue)]">{stats?.games_played || 0}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Badges Card */}
          <div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-3xl p-6 shadow-xl">
            <h3 className="text-xs font-black uppercase tracking-widest text-[var(--color-app-text-muted)] flex items-center gap-2 mb-6">
              <Award className="w-4 h-4 text-amber-500" /> Achievements
            </h3>
            
            <div className="grid grid-cols-3 gap-3">
              {BADGES.map((badge) => {
                const unlocked = badge.condition(stats, level);
                const Icon = badge.icon;
                return (
                  <div 
                    key={badge.id}
                    title={`${badge.name}: ${badge.description}`}
                    className={cn(
                      "aspect-square rounded-2xl flex flex-col items-center justify-center gap-1 border transition-all cursor-help group",
                      unlocked 
                        ? cn("bg-[var(--color-app-bg)]/50 border-white/10", badge.color)
                        : "bg-black/20 border-white/5 opacity-30 grayscale"
                    )}
                  >
                    <Icon className={cn("w-6 h-6 transform transition-transform group-hover:scale-110", unlocked && "drop-shadow-md")} />
                  </div>
                );
              })}
            </div>
            
            <p className="mt-6 text-[10px] text-center text-[var(--color-app-text-muted)] leading-relaxed">
              Earn badges by playing matches, leveling up, and achieving high scores.
            </p>
          </div>
        </div>

        {/* Right Column: Edit Profile & Advanced Info */}
        <div className="lg:col-span-9 flex flex-col gap-6">
          <div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-3xl overflow-hidden shadow-xl">
            <div className="p-6 sm:p-8 border-b border-[var(--color-app-border-light)] bg-[var(--color-app-hover)]/30">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[var(--color-app-blue)]/10 flex items-center justify-center text-[var(--color-app-blue)]">
                    <UserIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-[var(--color-app-text)]">Account Settings</h2>
                    <p className="text-sm text-[var(--color-app-text-muted)]">Manage your identity and preferences</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setInfoPopup('elo')}
                    className="hidden sm:flex bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-1.5 items-center gap-2 hover:bg-amber-500/20 transition-colors"
                  >
                    <Info className="w-4 h-4 text-amber-500" />
                    <span className="text-xs font-bold text-amber-600">ELO Rating System</span>
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={loading}
                    className="bg-[var(--color-app-blue)] hover:bg-blue-600 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl font-bold uppercase tracking-widest text-xs transition-all shadow-lg flex items-center gap-2 transform active:scale-95"
                  >
                    {loading ? (
                      <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</>
                    ) : (
                      <><Save className="w-4 h-4" /> Save Changes</>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <form onSubmit={handleSave} className="p-6 sm:p-8 flex flex-col gap-8">
              {message && (
                <div className={cn(
                  "p-4 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300",
                  message.type === 'success' ? "bg-green-500/10 text-green-500 border border-green-500/20" : "bg-red-500/10 text-red-500 border border-red-500/20"
                )}>
                  {message.type === 'success' ? <CheckCircle2 className="w-5 h-5 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 flex-shrink-0" />}
                  <p className="text-sm font-medium">{message.text}</p>
                </div>
              )}

              {/* Profile Details */}
              <div className="flex flex-col gap-6">
                <h3 className="text-xs font-black uppercase tracking-widest text-[var(--color-app-text-muted)] flex items-center gap-2">
                  <span className="w-1 h-3 bg-[var(--color-app-blue)] rounded-full" />
                  Personal Information
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="flex flex-col gap-2">
                    <label htmlFor="displayName" className="text-sm font-bold text-[var(--color-app-text)] ml-1">
                      Display Name
                    </label>
                    <div className="relative">
                      <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-app-text-muted)]" />
                      <input
                        type="text"
                        id="displayName"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Your explorer name"
                        className="w-full bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-2xl py-3 pl-11 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-app-blue)]/50 transition-all text-[var(--color-app-text)] lg:text-base font-medium"
                        required
                        maxLength={20}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-bold text-[var(--color-app-text)] ml-1">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-app-text-muted)]" />
                      <input
                        type="email"
                        value={user.email || 'Anonymous Account'}
                        disabled
                        className="w-full bg-[var(--color-app-bg)]/50 border border-[var(--color-app-border-light)] rounded-2xl py-3 pl-11 pr-4 text-sm text-[var(--color-app-text-muted)] cursor-not-allowed italic font-medium lg:text-base"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats Overview */}
              <div className="flex flex-col gap-6">
                <h3 className="text-xs font-black uppercase tracking-widest text-[var(--color-app-text-muted)] flex items-center gap-2">
                  <span className="w-1 h-3 bg-purple-500 rounded-full" />
                  Season Progress
                </h3>
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-[var(--color-app-hover)]/20 border border-[var(--color-app-border-light)] rounded-2xl p-5 flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-[var(--color-app-text-muted)] mb-1">
                      <Target className="w-4 h-4" />
                      <span className="text-[10px] uppercase font-black tracking-widest">Accuracy</span>
                    </div>
                    <div className="text-2xl font-black text-[var(--color-app-text)]">
                      {Math.round(((stats?.last_avg_score || 0) / 5000) * 100)}% 
                      <span className="text-xs text-[var(--color-app-text-muted)] font-bold ml-1">avg</span>
                    </div>
                  </div>
                  
                  <div className="bg-[var(--color-app-hover)]/20 border border-[var(--color-app-border-light)] rounded-2xl p-5 flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-[var(--color-app-text-muted)] mb-1">
                      <Trophy className="w-4 h-4" />
                      <span className="text-[10px] uppercase font-black tracking-widest">Global Rank</span>
                    </div>
                    <div className="text-2xl font-black text-[var(--color-app-text)]">#--</div>
                  </div>

                  <div className="bg-[var(--color-app-hover)]/20 border border-[var(--color-app-border-light)] rounded-2xl p-5 flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-[var(--color-app-text-muted)] mb-1">
                      <TrendingUp className="w-4 h-4" />
                      <span className="text-[10px] uppercase font-black tracking-widest">Activity Score</span>
                    </div>
                    <div className="text-2xl font-black text-[var(--color-app-text)]">{currentExp.toLocaleString()} <span className="text-xs text-[var(--color-app-text-muted)] font-bold">XP</span></div>
                  </div>
                </div>
              </div>

              {/* Game Preferences */}
              <div className="flex flex-col gap-6">
                <h3 className="text-xs font-black uppercase tracking-widest text-[var(--color-app-text-muted)] flex items-center gap-2">
                  <span className="w-1 h-3 bg-amber-500 rounded-full" />
                  Game Preferences
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-bold text-[var(--color-app-text)] ml-1">
                      Distance Metric
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {['km', 'miles', 'ft'].map((metric) => (
                        <button
                          key={metric}
                          type="button"
                          onClick={() => setDistanceMetric(metric)}
                          className={cn(
                            "py-2.5 rounded-xl text-xs font-black uppercase tracking-wider border transition-all",
                            distanceMetric === metric
                              ? "bg-[var(--color-app-blue)] text-white border-[var(--color-app-blue)] shadow-lg shadow-blue-500/20"
                              : "bg-[var(--color-app-bg)] text-[var(--color-app-text-muted)] border-[var(--color-app-border)] hover:bg-[var(--color-app-hover)]"
                          )}
                        >
                          {metric}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-[var(--color-app-text-muted)] ml-1">
                      Preferred units for measurement during match calculations.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-bold text-[var(--color-app-text)] ml-1">
                      Map Type
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {['roadmap', 'satellite', 'hybrid', 'terrain'].map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setMapPreference(type)}
                          className={cn(
                            "py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider border transition-all",
                            mapPreference === type
                              ? "bg-[var(--color-app-blue)] text-white border-[var(--color-app-blue)] shadow-lg shadow-blue-500/20"
                              : "bg-[var(--color-app-bg)] text-[var(--color-app-text-muted)] border-[var(--color-app-border)] hover:bg-[var(--color-app-hover)]"
                          )}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-[var(--color-app-text-muted)] ml-1">
                      Choose your favorite map visualization style.
                    </p>
                  </div>

                  {user.isAdmin && (
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-bold text-[var(--color-app-text)] ml-1">
                        System Privileges
                      </label>
                      <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex items-center gap-4">
                        <Shield className="w-6 h-6 text-amber-500" />
                        <div>
                          <p className="text-xs font-black text-amber-600 uppercase tracking-widest">Administrator</p>
                          <p className="text-[10px] text-amber-700/70">Full administrative console access granted</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Danger Zone */}
              {!user.isAnonymous && (
                <div className="flex flex-col gap-4 pt-2">
                  <h3 className="text-xs font-black uppercase tracking-widest text-red-500/70 flex items-center gap-2">
                    <span className="w-1 h-3 bg-red-500 rounded-full" />
                    Danger Zone
                  </h3>
                  <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-red-400">Delete Account</p>
                      <p className="text-[11px] text-[var(--color-app-text-muted)] mt-0.5">
                        Permanently remove your account and all associated data. This cannot be undone.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setDeleteConfirmOpen(true); setDeleteText(''); }}
                      className="flex-shrink-0 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-red-500 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 transition-all"
                    >
                      Delete Account
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      </div>

      {/* Avatar Selection Modal */}
      {isAvatarModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setIsAvatarModalOpen(false)} />
          
          <div className="bg-[var(--color-app-panel)] w-full max-w-4xl rounded-[2.5rem] border border-[var(--color-app-border-light)] shadow-2xl relative z-10 flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-300 overflow-hidden">
            <div className="p-8 border-b border-[var(--color-app-border-light)] flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black text-[var(--color-app-text)]">Choose Avatar</h2>
                <p className="text-sm text-[var(--color-app-text-muted)]">Select a profile picture that represents you</p>
              </div>
              <button 
                onClick={() => setIsAvatarModalOpen(false)}
                className="w-10 h-10 rounded-xl bg-[var(--color-app-bg)] border border-[var(--color-app-border-light)] flex items-center justify-center text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 no-scrollbar">
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-8 gap-4 pb-4">
                {AVATAR_SAMPLES.map((avatar, idx) => (
                  <button
                    key={idx}
                    onClick={() => setTempAvatar(avatar)}
                    className={cn(
                      "aspect-square rounded-2xl overflow-hidden border-2 transition-all transform hover:scale-110 active:scale-95 bg-[var(--color-app-bg)] group",
                      tempAvatar === avatar ? "border-[var(--color-app-blue)] ring-4 ring-[var(--color-app-blue)]/20 scale-105" : "border-transparent hover:border-[var(--color-app-blue)]/50"
                    )}
                  >
                    <img 
                      src={avatar}
                      alt={`Avatar ${idx}`}
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    />
                  </button>
                ))}
              </div>
            </div>

            <div className="p-8 border-t border-[var(--color-app-border-light)] bg-[var(--color-app-hover)] flex flex-col sm:flex-row items-center justify-between gap-6">
              <div className="flex flex-col gap-1 text-center sm:text-left">
                <p className="text-xs text-[var(--color-app-text-muted)]">
                  Choose from mixed cute, professional, and game-style avatars.
                </p>
                {tempAvatar ? (
                  <p className="text-[10px] font-bold text-[var(--color-app-blue)] uppercase tracking-wider">New selection ready to apply</p>
                ) : (
                  <p className="text-[10px] text-[var(--color-app-text-muted)] italic">Select an icon to continue</p>
                )}
              </div>
              
              <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
                {!user.isAnonymous && !tempAvatar && (
                  <button 
                    onClick={() => handleAvatarSelect(null)}
                    className="w-full sm:w-auto flex items-center justify-center gap-2.5 px-6 py-3 rounded-2xl bg-[var(--color-app-hover)] border border-[var(--color-app-border)] text-xs font-black uppercase tracking-widest text-[var(--color-app-text)] hover:bg-[var(--color-app-hover)]/80 transition-all active:scale-95 cursor-pointer"
                  >
                    <RefreshCcw className="w-4 h-4" />
                    Reset to Google
                  </button>
                )}
                <button
                  onClick={() => handleAvatarSelect(tempAvatar)}
                  disabled={!tempAvatar}
                  className="w-full sm:w-auto flex items-center justify-center gap-2.5 px-8 py-3 rounded-2xl bg-[var(--color-app-blue)] text-xs font-black uppercase tracking-widest text-white hover:opacity-90 disabled:opacity-50 disabled:grayscale transition-all active:scale-95 shadow-lg shadow-blue-500/20"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Use Avatar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Info Popups */}
      {infoPopup && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setInfoPopup(null)} />
          
          <div className="bg-[var(--color-app-panel)] w-full max-w-md rounded-[2rem] border border-[var(--color-app-border-light)] shadow-2xl relative z-10 animate-in zoom-in-95 duration-300 overflow-hidden">
            <div className="p-6 border-b border-[var(--color-app-border-light)] flex items-center justify-between">
              <h3 className="text-lg font-black text-[var(--color-app-text)] flex items-center gap-3">
                {infoPopup === 'elo' ? (
                  <><TrendingUp className="w-5 h-5 text-amber-500" /> ELO Rating System</>
                ) : (
                  <><Award className="w-5 h-5 text-[var(--color-app-blue)]" /> Explorer Rank & Titles</>
                )}
              </h3>
              <button 
                onClick={() => setInfoPopup(null)}
                className="w-8 h-8 rounded-lg bg-[var(--color-app-bg)] border border-[var(--color-app-border-light)] flex items-center justify-center text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-8 text-sm text-[var(--color-app-text-muted)] leading-relaxed space-y-4">
              {infoPopup === 'elo' ? (
                <>
                  <p>The <span className="text-[var(--color-app-text)] font-bold">ELO Rating system</span> measures your relative skill level compared to other players.</p>
                  <div className="bg-[var(--color-app-bg)] p-4 rounded-xl border border-[var(--color-app-border-light)] space-y-2">
                    <p>• Winning increases your rating.</p>
                    <p>• Losing decreases your rating.</p>
                    <p>• Beating higher-rated players gives more points.</p>
                  </div>
                  <p>It is the most accurate reflection of your competitive performance in GeoZora.</p>
                </>
              ) : (
                <>
                  <p>Your <span className="text-[var(--color-app-text)] font-bold">Explorer Rank</span> is earned through experience (XP). Accumulate XP by playing matches, finding exact locations, and completing achievements.</p>
                  <div className="bg-[var(--color-app-bg)] p-4 rounded-xl border border-[var(--color-app-border-light)] space-y-3">
                    <div>
                      <p className="text-[var(--color-app-text)] font-bold text-xs uppercase">Level 1-4: Rookie</p>
                      <p className="text-[10px]">Just starting the journey.</p>
                    </div>
                    <div>
                      <p className="text-[var(--color-app-blue)] font-bold text-xs uppercase">Level 5-9: Explorer</p>
                      <p className="text-[10px]">A seasoned traveler with good knowledge.</p>
                    </div>
                    <div>
                      <p className="text-amber-500 font-bold text-xs uppercase">Level 10+: Veteran</p>
                      <p className="text-[10px]">A master of the world's geography.</p>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="p-6 bg-[var(--color-app-hover)] flex justify-end">
              <button 
                onClick={() => setInfoPopup(null)}
                className="px-6 py-2 rounded-xl bg-[var(--color-app-blue)] text-white text-xs font-black uppercase tracking-widest hover:opacity-90 transition-all"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Delete Account Confirmation Modal */}
      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setDeleteConfirmOpen(false)} />
          <div className="bg-[var(--color-app-panel)] w-full max-w-md rounded-[2rem] border border-red-500/30 shadow-2xl relative z-10 animate-in zoom-in-95 duration-300 overflow-hidden">
            <div className="p-6 border-b border-red-500/20 flex items-center justify-between">
              <h3 className="text-lg font-black text-red-400">Delete Account</h3>
              <button onClick={() => setDeleteConfirmOpen(false)} className="w-8 h-8 rounded-lg bg-[var(--color-app-bg)] border border-[var(--color-app-border-light)] flex items-center justify-center text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 flex flex-col gap-4">
              <p className="text-sm text-[var(--color-app-text-muted)] leading-relaxed">
                This will permanently delete your account, profile, stats, and all associated data. <span className="text-[var(--color-app-text)] font-bold">This action cannot be undone.</span>
              </p>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-black uppercase tracking-widest text-[var(--color-app-text-muted)]">
                  Type <span className="text-red-400 font-mono">DELETE</span> to confirm
                </label>
                <input
                  type="text"
                  value={deleteText}
                  onChange={(e) => setDeleteText(e.target.value)}
                  placeholder="DELETE"
                  className="w-full bg-[var(--color-app-bg)] border border-red-500/30 rounded-xl py-2.5 px-4 text-sm text-red-400 font-mono focus:outline-none focus:ring-2 focus:ring-red-500/40"
                />
              </div>
            </div>
            <div className="p-6 bg-red-500/5 border-t border-red-500/20 flex items-center justify-end gap-3">
              <button onClick={() => setDeleteConfirmOpen(false)} className="px-5 py-2 rounded-xl text-sm font-bold text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors cursor-pointer">
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteText !== 'DELETE'}
                className="px-5 py-2 rounded-xl text-sm font-black uppercase tracking-wider bg-red-500 text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Delete My Account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
