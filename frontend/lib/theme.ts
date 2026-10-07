import { applyDensity, applyMode, Density, Mode } from "@cloudscape-design/global-styles";

const KEY = "r53.theme";
export type ThemeMode = "light" | "dark";

export function getTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  try {
    return window.localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function setTheme(mode: ThemeMode) {
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    /* storage unavailable */
  }
  applyMode(mode === "dark" ? Mode.Dark : Mode.Light);
}

export function initTheme() {
  applyDensity(Density.Comfortable);
  applyMode(getTheme() === "dark" ? Mode.Dark : Mode.Light);
}
