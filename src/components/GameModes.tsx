import { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import LoginModal from './LoginModal';
import { Lock, ArrowRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { MODE_CONFIGS, type GameModeId } from '../lib/MatchGame';

interface GameModesProps {
  selectedMode: GameModeId;
  onModeSelect: (mode: GameModeId) => void;
  onQuickMatchClick: () => void;
}

export default function GameModes({ onModeSelect, onQuickMatchClick }: GameModesProps) {
  const { user } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);

  const handleCardClick = (mode: GameModeId, enabled: boolean) => {
    if (!enabled) return;

    if (!user) {
      setShowLoginModal(true);
      return;
    }

    onModeSelect(mode);
  };

  return (
    <div className="flex flex-col justify-start gap-3 w-full h-full pt-8">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-slate-500 dark:text-[var(--color-app-text-muted)] font-bold uppercase tracking-widest text-xs">
          Game Modes
        </h3>
      </div>

      {Object.values(MODE_CONFIGS).map((card) => {
        const disabled = !card.enabled;

        return (
          <button
            key={card.id}
            type="button"
            disabled={disabled}
            onClick={() => handleCardClick(card.id, card.enabled)}
            className={cn(
              'relative w-full h-[104px] xl:h-[122px] rounded-2xl overflow-hidden flex-shrink-0 border text-left transition-all duration-300 group',
              'border-slate-200/80 dark:border-white/10',
              'shadow-[0_14px_34px_rgba(15,23,42,0.12)] dark:shadow-[0_14px_34px_rgba(0,0,0,0.22)]',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-transparent',
              !disabled && 'cursor-pointer hover:border-slate-300 dark:hover:border-white/25 hover:shadow-[0_18px_48px_rgba(15,23,42,0.18)] dark:hover:shadow-[0_18px_48px_rgba(0,0,0,0.32)] hover:-translate-y-0.5',
              disabled && 'cursor-not-allowed opacity-70 dark:opacity-65 grayscale-[0.45] dark:grayscale-[0.55]'
            )}
          >
            <div className="absolute inset-0">
              <img src={card.bgImg} alt={card.label} className={cn('w-full h-full object-cover transition-transform duration-700', !disabled && 'group-hover:scale-110', disabled && 'scale-105')} />
              <div className={cn('absolute inset-0', disabled ? 'bg-white/78 dark:bg-black/72' : 'bg-gradient-to-r from-white/92 via-white/72 to-white/28 dark:from-black/85 dark:via-black/55 dark:to-black/20')} />
              <div className="absolute inset-0 bg-gradient-to-t from-white/75 via-transparent to-white/15 dark:from-black/70 dark:via-transparent dark:to-white/5" />
              {disabled && <div className="absolute inset-0 backdrop-blur-[1.5px]" />}
            </div>

            <div className="relative z-10 h-full flex items-center justify-between p-5">
              <div className="flex items-center gap-4 min-w-0">
                <div className={cn('w-11 h-11 rounded-2xl flex items-center justify-center border transition-all duration-300', 'bg-slate-900/80 border-slate-900/10 dark:bg-white/10 dark:border-white/15 [&>svg]:w-6 [&>svg]:h-6 [&>svg]:text-white [&>svg]:dark:text-white [&>svg]:drop-shadow-lg', !disabled && 'group-hover:scale-105 group-hover:bg-slate-900/90 dark:group-hover:bg-white/15', disabled && 'opacity-60')}>
                  {card.icon}
                </div>
                <div className="min-w-0 text-slate-950 dark:text-white drop-shadow-none dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className={cn('font-bold text-base truncate', disabled && 'text-slate-500 dark:text-white/70')}>{card.label}</h3>
                    {disabled && (
                      <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.16em] text-slate-500 dark:text-white/55 bg-slate-900/5 dark:bg-white/8 border border-slate-900/10 dark:border-white/10 px-2 py-0.5 rounded-full">
                        <Lock className="w-3 h-3" /> Soon
                      </span>
                    )}
                  </div>
                  <p className={cn('text-[10px] xl:text-xs line-clamp-2 max-w-[215px]', disabled ? 'text-slate-400 dark:text-white/45' : 'text-slate-600 dark:text-white/78')}>{card.description}</p>
                </div>
              </div>

              <div className={cn('w-9 h-9 rounded-full backdrop-blur-sm flex items-center justify-center border transition-all duration-300', disabled ? 'bg-slate-900/5 border-slate-900/10 opacity-45 dark:bg-white/5 dark:border-white/10' : 'bg-white/70 border-slate-900/10 text-slate-900 opacity-0 translate-x-4 group-hover:opacity-100 group-hover:translate-x-0 dark:bg-black/35 dark:border-white/20 dark:text-white')}>
                {disabled ? <Lock className="w-4 h-4 text-slate-500 dark:text-white/55" /> : <ArrowRight className="w-4 h-4 text-slate-900 dark:text-white" />}
              </div>
            </div>

            <div className="absolute bottom-0 left-0 right-0 h-px bg-slate-900/10 dark:bg-white/10" />
          </button>
        );
      })}

      {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} />}
    </div>
  );
}