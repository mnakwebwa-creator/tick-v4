/**
 * Tick as an installed app: registers the service worker, offers "Install Tick",
 * and tells the teacher when an update is ready.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, PlusSquare, RefreshCw, Share, Smartphone, X } from "lucide-react";
import { Dialog } from "./ui";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallEvent | null = null;
let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

const media = (q: string) => typeof matchMedia === "function" && matchMedia(q).matches;
export const isStandalone = () =>
  media("(display-mode: standalone)") || media("(display-mode: fullscreen)") || (navigator as { standalone?: boolean }).standalone === true;
const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
export const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
const isMobile = isIOS || isAndroid || media("(pointer: coarse)");

/** Call once at start-up. */
export function startPwa() {
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as InstallEvent; emit(); });
  addEventListener("appinstalled", () => { deferred = null; emit(); });

  // Service workers need https (or localhost); on a plain LAN address the app still works, just not installable
  if (!("serviceWorker" in navigator) || !isSecureContext || import.meta.env.DEV) return;
  addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const watch = (w: ServiceWorker | null) => {
        if (!w) return;
        w.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) { waiting = w; emit(); }
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) { waiting = reg.waiting; emit(); }
      watch(reg.installing);
      reg.addEventListener("updatefound", () => watch(reg.installing));
      // Check for a new version when the app comes back to the foreground
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
      // Reload once when an update takes over (not on the very first install)
      const hadController = !!navigator.serviceWorker.controller;
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (hadController && !reloaded) { reloaded = true; location.reload(); }
      });
    } catch { /* not supported here */ }
  });
}

const snapshot = () => `${!!deferred}|${!!waiting}|${isStandalone()}`;

export function usePwa() {
  useSyncExternalStore(subscribe, snapshot);
  const installed = isStandalone();
  return {
    installed,
    /** Android/Chrome/Edge: the browser can show its own install dialog. */
    canPrompt: !!deferred,
    /** Show an install offer at all (prompt, or instructions for iPhone/other browsers). */
    canOffer: !installed && (!!deferred || isIOS || isMobile),
    updateReady: !!waiting,
    async install() {
      if (!deferred) return false;
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      emit();
      return outcome === "accepted";
    },
    update() { waiting?.postMessage("skip-waiting"); },
  };
}

/* ---------- UI ---------- */

const DISMISS = "tick.installDismissed";
const dismissedRecently = () => {
  try { return Date.now() - Number(localStorage.getItem(DISMISS) || 0) < 14 * 864e5; } catch { return false; }
};

/** A button that installs Tick, or explains how on iPhone. */
export function InstallButton({ className = "btn", label = "Install app" }: { className?: string; label?: string }) {
  const pwa = usePwa();
  const [help, setHelp] = useState(false);
  if (!pwa.canOffer) return null;
  return (
    <>
      <button type="button" className={className} onClick={() => (pwa.canPrompt ? pwa.install() : setHelp(true))}>
        <Download /> {label}
      </button>
      <InstallHelp open={help} onClose={() => setHelp(false)} />
    </>
  );
}

/** The card shown in the app until Tick is installed (or dismissed for two weeks). */
export function InstallBanner() {
  const pwa = usePwa();
  const [hidden, setHidden] = useState(dismissedRecently);
  const [help, setHelp] = useState(false);
  // Give the page a moment before offering, so it doesn't pop up mid-load
  const [shown, setShown] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShown(true), 1500); return () => clearTimeout(t); }, []);

  if (pwa.updateReady) {
    return (
      <div className="app-banner" role="status">
        <span className="ic"><RefreshCw /></span>
        <div className="grow"><b>A new version of Tick is ready</b><small>Update now — it takes a second.</small></div>
        <button className="btn sm primary" onClick={pwa.update}>Update</button>
      </div>
    );
  }
  if (!shown || hidden || !pwa.canOffer) return null;
  const dismiss = () => { try { localStorage.setItem(DISMISS, String(Date.now())); } catch { /* ignore */ } setHidden(true); };
  return (
    <>
      <div className="app-banner install" role="region" aria-label="Install Tick">
        <img src="/icons/icon-192.png" alt="" width={44} height={44} />
        <div className="grow">
          <b>Install Tick on this {isMobile ? "phone" : "computer"}</b>
          <small>Opens full-screen from your home screen, like any other app. Works with weak signal.</small>
        </div>
        <button className="btn sm go" onClick={() => (pwa.canPrompt ? pwa.install() : setHelp(true))}><Download /> Install</button>
        <button className="btn ghost sm icon" onClick={dismiss} aria-label="Not now" title="Not now"><X /></button>
      </div>
      <InstallHelp open={help} onClose={() => setHelp(false)} />
    </>
  );
}

function InstallHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Install Tick" intro="Add Tick to your home screen. It opens full-screen, like a native app.">
      {isIOS ? (
        <ol className="install-steps">
          <li><span className="k">1</span><span>Open this page in <b>Safari</b>.</span></li>
          <li><span className="k">2</span><span>Tap the <b>Share</b> button <Share size={16} className="inline" /> at the bottom of the screen.</span></li>
          <li><span className="k">3</span><span>Scroll down and tap <b>Add to Home Screen</b> <PlusSquare size={16} className="inline" />.</span></li>
          <li><span className="k">4</span><span>Tap <b>Add</b>. Tick appears on your home screen.</span></li>
        </ol>
      ) : (
        <ol className="install-steps">
          <li><span className="k">1</span><span>Open this page in <b>Chrome</b> (or Edge / Samsung Internet).</span></li>
          <li><span className="k">2</span><span>Tap the menu <b>⋮</b> at the top right.</span></li>
          <li><span className="k">3</span><span>Tap <b>Install app</b> or <b>Add to Home screen</b>.</span></li>
          <li><span className="k">4</span><span>Confirm. Tick appears with your other apps <Smartphone size={16} className="inline" />.</span></li>
        </ol>
      )}
      <p className="faint small" style={{ marginTop: 16 }}>Installing needs Tick's secure (https) address, such as your Netlify site.</p>
      <footer className="sheet-foot"><button className="btn primary" onClick={onClose}>Got it</button></footer>
    </Dialog>
  );
}
