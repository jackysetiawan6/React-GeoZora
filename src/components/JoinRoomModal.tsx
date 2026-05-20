import { X, Hash, ChevronRight } from 'lucide-react';
import React, { useState } from 'react';
import { cn } from '../lib/utils';

interface JoinRoomModalProps {
  onClose: () => void;
  onJoin: (code: string) => void;
}

export default function JoinRoomModal({ onClose, onJoin }: JoinRoomModalProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setError('Please enter a room code');
      return;
    }
    onJoin(code.trim().toUpperCase());
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
        onClick={onClose}
      />
      
      {/* Content */}
      <div className="relative w-full max-w-md bg-[var(--color-app-panel)] border border-[var(--color-app-border)] rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-300">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              Join Creator Room
            </h2>
            <button 
              onClick={onClose}
              className="text-[var(--color-app-text-muted)] hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <p className="text-sm text-[var(--color-app-text-muted)] mb-6">
            Enter the 6-character room code shared by the creator to join their custom match.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="relative">
              <input
                autoFocus
                type="text"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setError(null);
                }}
                placeholder="Ex: AB12CD"
                maxLength={6}
                className={cn(
                  "w-full bg-[var(--color-app-bg)]/60 border h-14 rounded-xl px-4 text-center text-2xl font-mono font-bold tracking-[0.5em] text-white outline-none transition-all placeholder:text-gray-700 placeholder:tracking-normal",
                  error ? "border-red-500 focus:border-red-500" : "border-[var(--color-app-border-light)] focus:border-[var(--color-app-blue)]"
                )}
              />
              {error && (
                <p className="text-xs text-red-500 mt-2 text-center font-medium animate-in slide-in-from-top-1">
                  {error}
                </p>
              )}
            </div>

            <button
              type="submit"
              className="w-full h-12 bg-[var(--color-app-blue)] hover:bg-blue-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 group mt-2"
            >
              Join Match
              <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </form>
        </div>
        
        <div className="bg-[var(--color-app-bg)] p-4 border-t border-[var(--color-app-border-light)] text-center">
          <p className="text-[10px] text-[var(--color-app-text-muted)] uppercase tracking-widest font-black">
            Ensure you have a stable internet connection
          </p>
        </div>
      </div>
    </div>
  );
}
