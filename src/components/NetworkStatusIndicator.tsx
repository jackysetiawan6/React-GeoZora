import { Loader2, Wifi, WifiOff } from 'lucide-react';
import { cn } from '../lib/utils';
import { useNetworkStatus } from '../lib/useNetworkStatus';

export default function NetworkStatusIndicator() {
  const { status, ping } = useNetworkStatus();

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all',
        status === 'online'
          ? ping !== null && ping > 300
            ? 'text-orange-400 bg-orange-500/10 border border-orange-500/20'
            : ping !== null && ping > 100
              ? 'text-yellow-400 bg-yellow-500/10 border border-yellow-500/20'
              : 'text-green-400 bg-green-500/10 border border-green-500/20'
          : status === 'offline'
            ? 'text-red-400 bg-red-500/10 border border-red-500/20'
            : 'text-yellow-400 bg-yellow-500/10 border border-yellow-500/20'
      )}
      title={
        status === 'online'
          ? `Connected${ping !== null ? ` (Ping: ${ping}ms)` : ''}`
          : status === 'offline'
            ? 'No connection'
            : 'Checking connection...'
      }
    >
      {status === 'checking' && (
        <Loader2 className="w-3 h-3 animate-spin" />
      )}
      {status === 'online' && (
        <Wifi className="w-3 h-3" />
      )}
      {status === 'offline' && (
        <WifiOff className="w-3 h-3" />
      )}
      
      <span className="hidden sm:inline">
        {status === 'online' && (ping !== null ? `Online (${ping} ms)` : 'Online')}
        {status === 'offline' && 'Offline'}
        {status === 'checking' && 'Connecting...'}
      </span>

      {status === 'online' && ping !== null && (
        <span className="inline sm:hidden font-mono text-[10px] tracking-normal">
          {ping}ms
        </span>
      )}
    </div>
  );
}
