import { useState, useEffect } from 'react';

export type ConnectionStatus = 'online' | 'offline' | 'checking';

interface UseNetworkStatusReturn {
  isOnline: boolean;
  status: ConnectionStatus;
}

/**
 * Custom hook for tracking network connectivity status.
 * 
 * Returns:
 * - isOnline: boolean indicating if user has active connection
 * - status: 'online' | 'offline' | 'checking' for UI state
 */
export function useNetworkStatus(): UseNetworkStatusReturn {
  const [status, setStatus] = useState<ConnectionStatus>('checking');
  const [isOnline, setIsOnline] = useState(navigator.onLine);

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
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { isOnline, status };
}
