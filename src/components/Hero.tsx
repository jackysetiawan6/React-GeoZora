import React, { useMemo } from 'react';
import { ArrowRight, CopyPlus, MapPin, Play, Users, Zap } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useEffect, useState } from 'react';
import LoginModal from './LoginModal';
import { supabase } from '../lib/supabase';
import { MAPS } from '../lib/MapRegions';

interface HeroProps {
  onPlayClick: () => void;
  onQuickMatchClick: () => void;
}

function StatBadge({
  icon,
  bgClass,
  ping,
  value,
  label,
}: {
  icon: React.ReactNode;
  bgClass: string;
  ping?: boolean;
  value: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-6 h-6 rounded-full ${bgClass} flex items-center justify-center relative`}
      >
        {ping && (
          <div className="absolute inset-0 rounded-full border border-green-500/40 animate-ping" />
        )}
        {icon}
      </div>
      <span className="font-semibold text-[var(--color-app-text)]">
        {value}{' '}
        <span className="text-[var(--color-app-text-muted)] font-normal">
          {label}
        </span>
      </span>
    </div>
  );
}

export default function Hero({ onPlayClick, onQuickMatchClick }: HeroProps) {
  const { user } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activePlayersCount, setActivePlayersCount] = useState<number>(0);

  // Count enabled maps excluding 'world' — MAPS is already populated
  // by loadMapRegions() in App.tsx before any child renders.
  const playableMapCount = useMemo(() => {
    return Object.keys(MAPS).filter((id) => id !== 'world').length;
  }, []);

  useEffect(() => {
    const fetchActivePlayers = async () => {
      try {
        const { data: count, error } = await supabase.rpc('get_active_players_count');

        if (!error && count !== null) {
          setActivePlayersCount(count);
        }
      } catch (err) {
        console.error('Failed to fetch active players count', err);
      }
    };

    fetchActivePlayers();
    const interval = setInterval(fetchActivePlayers, 30000);
    return () => clearInterval(interval);
  }, []);

  const handlePlayClick = () => {
    if (!user) {
      setShowLoginModal(true);
    } else {
      onPlayClick();
    }
  };

  const handleQuickMatchClick = () => {
    if (!user) {
      setShowLoginModal(true);
    } else {
      onQuickMatchClick();
    }
  };

  return (
    <div className="flex flex-col justify-end z-10 w-full max-w-lg h-full pb-8">
      <h1 className="text-5xl xl:text-6xl font-bold leading-tight tracking-tight mb-4 mt-6">
        <span className="text-[var(--color-app-blue)]">Explore</span>{' '}
        <span className="text-[var(--color-app-text)]">the World.</span>
        <br />
        <span className="text-[var(--color-app-text)]">Test Your Geography.</span>
      </h1>

      <p className="text-[var(--color-app-text-muted)] text-base mb-8 max-w-md leading-relaxed">
        Drop anywhere on the map, analyze your surroundings, and guess the
        location. How well do you know the world?
      </p>

      <div className="flex items-center gap-4 mb-10">
        <button
          onClick={handlePlayClick}
          className="flex items-center gap-2 bg-[var(--color-app-blue)] hover:opacity-90 text-white px-8 py-3.5 rounded-xl font-semibold transition-all shadow-[0_0_20px_rgba(59,130,246,0.4)]"
        >
          <Play className="w-5 h-5 fill-white" />
          Play Now
          <ArrowRight className="w-5 h-5 ml-2" />
        </button>

        <button
          onClick={handleQuickMatchClick}
          className="flex items-center gap-2 bg-transparent border border-[var(--color-app-border)] hover:bg-[var(--color-app-hover)] text-[var(--color-app-text)] px-8 py-3.5 rounded-xl font-semibold transition-all"
        >
          <CopyPlus className="w-5 h-5" />
          Quick Match
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-4 xl:gap-6 text-xs xl:text-sm">
        <StatBadge
          icon={<Users className="w-3.5 h-3.5 text-green-500" />}
          bgClass="bg-green-500/20"
          ping={activePlayersCount > 0}
          value={activePlayersCount === 0 ? 'No' : activePlayersCount.toLocaleString()}
          label={activePlayersCount > 1 ? 'Active Players' : 'Active Player'}
        />

        <div className="w-px h-5 bg-[var(--color-app-border)] hidden sm:block" />

        <StatBadge
          icon={<MapPin className="w-3.5 h-3.5 text-[var(--color-app-blue)]" />}
          bgClass="bg-blue-500/20"
          value={playableMapCount.toString()}
          label={playableMapCount === 1 ? 'Country' : 'Countries'}
        />

        <div className="w-px h-5 bg-[var(--color-app-border)] hidden sm:block" />

        <StatBadge
          icon={<Zap className="w-3.5 h-3.5 text-orange-500" />}
          bgClass="bg-orange-500/20"
          value="Real"
          label="Street View"
        />
      </div>

      {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} />}
    </div>
  );
}