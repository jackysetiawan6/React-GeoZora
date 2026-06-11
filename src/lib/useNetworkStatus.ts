import { useState, useEffect } from 'react';

export type ConnectionStatus = 'online' | 'offline' | 'checking';

interface UseNetworkStatusReturn {
  isOnline: boolean;
  status: ConnectionStatus;
  ping: number | null;
}

/**
 * Custom hook for tracking network connectivity status and latency (ping).
 * 
 * Returns:
 * - isOnline: boolean indicating if user has active connection
 * - status: 'online' | 'offline' | 'checking' for UI state
 * - ping: round-trip latency in ms or null if unavailable/offline
 */
export function useNetworkStatus(): UseNetworkStatusReturn {
  const [status, setStatus] = useState<ConnectionStatus>('checking');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [ping, setPing] = useState<number | null>(null);

  useEffect(() => {
    // Set initial status based on navigator.onLine
    setIsOnline(navigator.onLine);
    setStatus(navigator.onLine ? 'online' : 'offline');

    // Handle online event
    const handleOnline = () => {
      setIsOnline(true);
      setStatus('online');
    };

    // Handle offline event
    const handleOffline = () => {
      setIsOnline(false);
      setStatus('offline');
      setPing(null);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (status !== 'online') {
      setPing(null);
      return;
    }

    let intervalId: number | undefined;

    const pingServer = async () => {
      if (document.visibilityState !== 'visible') return;
      const startTime = performance.now();
      try {
        // Fetch application origin with cache-busting to bypass browser caches
        await fetch(`${window.location.origin}/index.html?t=${Date.now()}`, {
          method: 'HEAD',
          cache: 'no-store',
        });
        const duration = Math.round(performance.now() - startTime);
        setPing(duration);
      } catch (err) {
        console.warn('Ping failed:', err);
        setPing(null);
      }
    };

    // Run initial ping check
    pingServer();

    // Check ping every 10 seconds to minimize overhead
    intervalId = window.setInterval(pingServer, 10000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        pingServer();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (intervalId) window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [status]);

  return { isOnline, status, ping };
}
