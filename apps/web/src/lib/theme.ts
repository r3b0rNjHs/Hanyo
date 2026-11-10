export type Theme = "dark" | "light" | "system";

const KEY = "hanyo.theme";

export function currentTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "system" ? t : "dark";
  } catch {
    return "dark";
  }
}

/** Switch theme now and remember it (app.html re-applies it before first paint). */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Not persisted in private mode; still applied for this session.
  }
  document.documentElement.dataset.theme = theme;
  const light = theme === "light" || (theme === "system" && matchMedia("(prefers-color-scheme: light)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#f5f5f9" : "#0b0b10");
}
