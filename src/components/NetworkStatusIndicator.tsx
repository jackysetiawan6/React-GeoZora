import { Loader2, Wifi, WifiOff } from 'lucide-react';
import { cn } from '../lib/utils';
import { useNetworkStatus } from '../lib/useNetworkStatus';

export default function NetworkStatusIndicator() {
  const { isOnline, status } = useNetworkStatus();

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all',
        status === 'online'
          ? 'text-green-400 bg-green-500/10 border border-green-500/20'
          : status === 'offline'
            ? 'text-red-400 bg-red-500/10 border border-red-500/20'
            : 'text-yellow-400 bg-yellow-500/10 border border-yellow-500/20'
      )}
      title={
        status === 'online'
          ? 'Connected'
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
        {status === 'online' && 'Online'}
        {status === 'offline' && 'Offline'}
        {status === 'checking' && 'Connecting...'}
      </span>
    </div>
  );
}
