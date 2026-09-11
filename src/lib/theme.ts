/**
 * Applies the chosen theme and text size to the document.
 *
 * "System" is the default: the app follows the phone's own light/dark setting
 * and keeps following it while open, so a phone that switches at sunset takes
 * the app with it.
 */
import type { Settings, Theme } from "./types";

const DARK_BG = "#0e1a16";
const LIGHT_BG = "#f5faf7";

export function prefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function resolveDark(theme: Theme): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return prefersDark();
}

export function applyTheme(settings: Pick<Settings, "theme" | "text_scale">) {
  const dark = resolveDark(settings.theme);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.setProperty("--text-scale", String(settings.text_scale ?? 1));
  root.style.colorScheme = dark ? "dark" : "light";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? DARK_BG : LIGHT_BG);
}

/** Watch the system setting; returns an unsubscribe function. */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (!query) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
