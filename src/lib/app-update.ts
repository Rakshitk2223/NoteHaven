// Keeps the installed app on the latest version (vite-plugin-pwa's own
// registerSW, registerType 'autoUpdate'). Before this, nothing imported
// virtual:pwa-register: the injected script only registered the service worker,
// so it never checked for updates or reloaded, and iOS kept restoring the old
// page from memory.
//
//   · checks for a new version on every route change, when the app comes back
//     to the foreground, and every 30 minutes;
//   · when a new version takes over, reloads, unless something mustn't be
//     interrupted (unsaved edits, a bulk write in progress): then the reload
//     waits for the next route change with nothing held;
//   · after an automatic reload, the app says so once ("Updated to the latest version").
import { registerSW } from 'virtual:pwa-register';

const FLAG = 'app-updated:v1';
const CHECK_EVERY_MS = 30 * 60 * 1000;

const holds = new Set<string>();
let pendingReload = false;
let registration: ServiceWorkerRegistration | undefined;
let started = false;

/** Something that mustn't be lost to a reload (a dirty form, a bulk write). */
export function holdReload(key: string, on: boolean): void {
  if (on) holds.add(key); else holds.delete(key);
}

const check = () => { void registration?.update().catch(() => undefined); };

function reloadNow() {
  try { sessionStorage.setItem(FLAG, '1'); } catch { /* private mode: no toast, still updates */ }
  window.location.reload();
}

/** Once, at app start. */
export function startAppUpdates(): void {
  if (started) return;
  started = true;
  registerSW({
    immediate: true,
    onRegisteredSW(_url, r) {
      registration = r;
      if (!r) return;
      setInterval(check, CHECK_EVERY_MS);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    },
    // autoUpdate: the new service worker is active; the page still runs the old code.
    onNeedReload() {
      if (holds.size > 0) { pendingReload = true; return; }
      reloadNow();
    },
  });
}

/** On every route change: look for an update, and apply a deferred one if nothing's held now. */
export function onRouteChange(): void {
  check();
  if (pendingReload && holds.size === 0) reloadNow();
}

/** True once after an automatic update reload (for the toast). */
export function consumeUpdatedFlag(): boolean {
  try {
    if (!sessionStorage.getItem(FLAG)) return false;
    sessionStorage.removeItem(FLAG);
    return true;
  } catch {
    return false;
  }
}
