import { Loader2 } from 'lucide-react';

type MatchLoadingOverlayProps = {
  title?: string;
  subtitle?: string;
};

export default function MatchLoadingOverlay({
  title = 'Preparing Street View',
  subtitle = 'Generating locations and loading the next panorama.',
}: MatchLoadingOverlayProps) {
  return (
    <div className="absolute inset-0 z-[100] bg-[var(--color-app-bg)] text-[var(--color-app-text)] flex items-center justify-center font-sans overflow-hidden">
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