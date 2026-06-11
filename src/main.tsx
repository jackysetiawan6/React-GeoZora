import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './lib/AuthContext';
import { ThemeProvider } from './lib/ThemeContext';
import { Toaster } from 'sonner';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { toast } from 'sonner';
import Maintenance from './components/Maintenance.tsx';

// Global handler to catch RangeError and unhandled promise rejections for debugging
window.addEventListener('error', (ev) => {
  try {
    const err = (ev as any).error;
    if (err && err instanceof RangeError) {
      console.error('Captured RangeError:', err);
      toast.error('An internal error occurred. Please reload the page.');
    }
  } catch (e) {}
});

window.addEventListener('unhandledrejection', (ev) => {
  try {
    const reason = (ev as any).reason;
    console.error('Unhandled rejection:', reason);
  } catch (e) {}
});

const IS_MAINTENANCE = import.meta.env.VITE_IS_MAINTENANCE_MODE === "true";

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {IS_MAINTENANCE ? (
      <ThemeProvider>
        <ErrorBoundary>
          <Maintenance />
          <Toaster position="top-center" theme="dark" richColors />
        </ErrorBoundary>
      </ThemeProvider>
    ) : (
      <AuthProvider>
        <ThemeProvider>
          <ErrorBoundary>
            <App />
            <Toaster position="top-center" theme="dark" richColors />
          </ErrorBoundary>
        </ThemeProvider>
      </AuthProvider>
    )}
  </StrictMode>,
);

