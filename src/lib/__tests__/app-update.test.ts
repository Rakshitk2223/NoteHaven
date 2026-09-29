import { describe, it, expect, vi, beforeEach } from 'vitest';

// registerSW (vite-plugin-pwa) mocked: capture its hooks, hand back a fake registration.
let hooks: { onRegisteredSW?: (url: string, r?: ServiceWorkerRegistration) => void; onNeedReload?: () => void } = {};
vi.mock('virtual:pwa-register', () => ({ registerSW: (o: typeof hooks) => { hooks = o; return async () => {}; } }));

const reload = vi.fn();
const update = vi.fn(async () => {});
const store = new Map<string, string>();
vi.stubGlobal('window', { location: { reload } });
vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn() });
vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });

const mod = await import('../app-update');

beforeEach(() => { reload.mockClear(); update.mockClear(); store.clear(); });

describe('app-update (installed app stays current, never drops unsaved work)', () => {
  it('registers once and checks for an update on every route change', () => {
    mod.startAppUpdates();
    mod.startAppUpdates(); // idempotent
    hooks.onRegisteredSW?.('/sw.js', { update } as unknown as ServiceWorkerRegistration);
    mod.onRouteChange();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('reloads straight away when a new version takes over and nothing is held, then toasts once', () => {
    hooks.onNeedReload?.();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(mod.consumeUpdatedFlag()).toBe(true);
    expect(mod.consumeUpdatedFlag()).toBe(false);
  });

  it('defers the reload while unsaved work is held, and applies it on the next route change once released', () => {
    mod.holdReload('media-edit', true);
    hooks.onNeedReload?.();
    expect(reload).not.toHaveBeenCalled();
    mod.onRouteChange();                 // still held: no reload
    expect(reload).not.toHaveBeenCalled();
    mod.holdReload('media-edit', false);
    mod.onRouteChange();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
