import React, { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import { supabase } from "./supabase";

type Theme = "dark" | "light";

interface ThemeContextType {
	theme: Theme;
	toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
	theme: "dark",
	toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const [theme, setTheme] = useState<Theme>(() => {
		if (typeof window !== "undefined") {
			return (localStorage.getItem("theme") as Theme) || "dark";
		}
		return "dark";
	});
	const { user } = useAuth();

	// Sync document class with current theme state
	useEffect(() => {
		document.documentElement.classList.toggle(
			"light-theme",
			theme === "light",
		);
	}, [theme]);

	// Fetch database theme asynchronously on login, without blocking render
	useEffect(() => {
		const syncDbTheme = async () => {
			if (!user) return;
			try {
				const { data, error } = await supabase
					.from("profiles")
					.select("theme_preference")
					.eq("id", user.uid)
					.single();

				if (!error && data && data.theme_preference) {
					const dbTheme = data.theme_preference as Theme;
					if (dbTheme !== theme) {
						setTheme(dbTheme);
						try {
							localStorage.setItem("theme", dbTheme);
						} catch (e) {
							console.warn("Failed to save theme to localStorage:", e);
						}
					}
				}
			} catch (err) {
				console.error("Error fetching theme from Supabase:", err);
			}
		};

		syncDbTheme();
	}, [user]);

	const toggleTheme = async () => {
		const newTheme = theme === "dark" ? "light" : "dark";
		setTheme(newTheme);
		try {
			localStorage.setItem("theme", newTheme);
		} catch (e) {
			console.warn("Failed to save theme to localStorage:", e);
		}
		document.documentElement.classList.toggle(
			"light-theme",
			newTheme === "light",
		);

		if (user) {
			try {
				const { error, data } = await supabase.rpc("update_profile_safe", {
					p_id: user.uid,
					p_display_name: null,
					p_avatar_url: null,
					p_distance_metric: null,
					p_map_preference: null,
					p_theme_preference: newTheme,
				});

				if (error) throw error;
				if (data && (data as any).status === "error") {
					throw new Error((data as any).message || "update_failed");
				}
			} catch (err) {
				console.error("Error saving theme to Supabase:", err);
			}
		}
	};

	return (
		<ThemeContext.Provider value={{ theme, toggleTheme }}>
			{children}
		</ThemeContext.Provider>
	);
}

export const useTheme = () => useContext(ThemeContext);
