import { useEffect, useState } from "react";

/**
 * Read-only resolved theme observer.
 *
 * Watches the `dark` class on `<html>` (managed by next-themes) and re-renders
 * consumers when it flips. Use this for visual decisions that need to react to
 * the current rendered theme — e.g. picking glow palette colors.
 *
 * For reading or changing the user's preference (`light` / `dark` / `system`),
 * use `useTheme` from `next-themes` instead.
 */
export function useThemeValue(): "light" | "dark" {
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setResolved(document.documentElement.classList.contains("dark") ? "dark" : "light");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return resolved;
}
