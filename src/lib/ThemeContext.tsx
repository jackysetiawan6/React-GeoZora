import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from './supabase';

type Theme = 'dark' | 'light';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({ theme: 'dark', toggleTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');
  const { user } = useAuth();
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const initTheme = async () => {
      let savedTheme = localStorage.getItem('theme') as Theme | null;
      
      if (user && !user.isAnonymous) {
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('theme_preference')
            .eq('id', user.uid)
            .single();
            
          if (!error && data && data.theme_preference) {
            savedTheme = data.theme_preference as Theme;
            try {
              localStorage.setItem('theme', savedTheme);
            } catch (e) {
              console.warn("Failed to save theme to localStorage:", e);
            }
          }
        } catch (err) {
          console.error("Error fetching theme from Supabase:", err);
        }
      }

      if (savedTheme) {
        setTheme(savedTheme);
        document.documentElement.classList.toggle('light-theme', savedTheme === 'light');
      }
      setIsInitialized(true);
    };

    initTheme();
  }, [user]);

  const toggleTheme = async () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    try {
      localStorage.setItem('theme', newTheme);
    } catch (e) {
      console.warn("Failed to save theme to localStorage:", e);
    }
    document.documentElement.classList.toggle('light-theme', newTheme === 'light');

    if (user && !user.isAnonymous) {
        try {
            await supabase.from('profiles').upsert({
                id: user.uid,
                theme_preference: newTheme,
                updated_at: new Date().toISOString()
            });
        } catch (err) {
            console.error("Error saving theme to Supabase:", err);
        }
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {isInitialized ? children : null}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
