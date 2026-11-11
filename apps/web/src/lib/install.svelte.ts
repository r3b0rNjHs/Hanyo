/**
 * "Install as an app": Chrome and Edge (desktop and Android) fire `beforeinstallprompt` when the
 * PWA can be installed; we keep the event so Ajustes can offer a button. Safari on iOS has no such
 * event: installing there is Compartir → Añadir a pantalla de inicio.
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export const install = $state<{ available: boolean; installed: boolean }>({ available: false, installed: false });
let deferred: InstallPromptEvent | null = null;

// Listen from the moment this module loads: Chrome may fire the event before any page mounts.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    install.available = true;
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    install.available = false;
    install.installed = true;
  });
}

export function watchInstall(): void {
  install.installed = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  install.available = false;
  return outcome === "accepted";
}

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
