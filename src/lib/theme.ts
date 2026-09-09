import { useCallback, useEffect, useState } from "react";

/**
 * Light/dark theme for the whole app.
 *
 * The active theme is a `dark` class on <html> (plus `color-scheme`), and the
 * palette swap lives in src/index.css under the `.dark` selector — so every
 * screen picks it up without per-component rewrites. Preference persists in
 * localStorage and defaults to the operating-system scheme on first visit.
 */

export type Theme = "light" | "dark";

const STORAGE_KEY = "jiwdah-theme";

function darkMediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia("(prefers-color-scheme: dark)");
}

export function systemTheme(): Theme {
  return darkMediaQuery()?.matches ? "dark" : "light";
}

export function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode: theme still applies for the session */
  }
}

export function resolveTheme(): Theme {
  return storedTheme() ?? systemTheme();
}

/** Toggle that initializes from storage/system and keeps instances in sync. */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(resolveTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Follow OS changes while the user has not picked an explicit theme.
  useEffect(() => {
    if (storedTheme()) return;
    const media = darkMediaQuery();
    if (!media) return;
    const onChange = () => setTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggleTheme };
}
