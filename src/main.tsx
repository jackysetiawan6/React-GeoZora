import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './lib/AuthContext';
import { ThemeProvider } from './lib/ThemeContext';
import { Toaster } from 'sonner';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <ThemeProvider>
        <App />
        <Toaster position="top-center" theme="dark" richColors />
        <Analytics mode={import.meta.env.PROD ? 'production' : 'development'} />
        <SpeedInsights debug={false} />
      </ThemeProvider>
    </AuthProvider>
  </StrictMode>,
);
