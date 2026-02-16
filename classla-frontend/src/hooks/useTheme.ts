import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "classla-theme";
const THEME_CHANGE_EVENT = "theme-change";

export function useTheme() {
  const [isDark, setIsDark] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "dark"
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    localStorage.setItem(STORAGE_KEY, isDark ? "dark" : "light");

    // Dispatch custom event so other components can react to theme changes
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { isDark } }));
  }, [isDark]);

  // Listen for theme changes from other components
  useEffect(() => {
    const handleThemeChange = (event: CustomEvent) => {
      setIsDark(event.detail.isDark);
    };

    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange as EventListener);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange as EventListener);
    };
  }, []);

  const toggle = useCallback(() => setIsDark((prev) => !prev), []);

  return { isDark, toggle };
}
