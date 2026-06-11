import { Loader2, ArrowLeft } from 'lucide-react';

type MatchLoadingOverlayProps = {
  title?: string;
  subtitle?: string;
  onExit?: () => void;
};

export default function MatchLoadingOverlay({
  title = 'Preparing Street View',
  subtitle = 'Generating locations and loading the next panorama.',
  onExit,
}: MatchLoadingOverlayProps) {
  return (
    <div className="absolute inset-0 z-[100] bg-[var(--color-app-bg)] text-[var(--color-app-text)] flex items-center justify-center font-sans overflow-hidden">
      {onExit && (
        <button
          onClick={onExit}
          className="absolute top-6 left-6 p-3 rounded-full border border-[var(--color-app-border)] bg-[var(--color-app-panel)]/80 text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] hover:bg-[var(--color-app-hover)] transition-all shadow-md z-[110] flex items-center justify-center cursor-pointer"
          title="Exit Match"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
      )}

      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600/20 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute top-[20%] right-[-10%] w-[40%] h-[40%] bg-indigo-600/10 blur-[120px] rounded-full pointer-events-none" />

      <div className="flex flex-col items-center gap-6 z-10">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
        <div className="flex flex-col items-center gap-2">
          <h2 className="text-xl font-medium tracking-tight text-[var(--color-app-text)]">
            {title}
          </h2>
          <p className="text-[var(--color-app-text-muted)] text-sm">
            {subtitle}
          </p>
        </div>
      </div>
    </div>
  );
}