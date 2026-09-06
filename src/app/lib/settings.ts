// Client-only preferences (localStorage). The assistant channel used to be a radio on the 投递
// page; it now lives on 设置 and is read here when a task is started.
export type Channel = "user_chrome" | "headless";
export type Theme = "light" | "dark" | "system";

const CHANNEL_KEY = "sortie.channel";
const THEME_KEY = "sortie.theme";

function read(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private mode etc.) — preference simply doesn't persist
  }
}

export function getChannel(): Channel {
  return read(CHANNEL_KEY) === "headless" ? "headless" : "user_chrome";
}

export function setChannel(c: Channel): void {
  write(CHANNEL_KEY, c);
}

export function getTheme(): Theme {
  const t = read(THEME_KEY);
  return t === "light" || t === "dark" ? t : "system";
}

export function setTheme(t: Theme): void {
  write(THEME_KEY, t);
  applyTheme(t);
}

export function applyTheme(t: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
}
