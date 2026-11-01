import { useSyncExternalStore } from 'react';
import { SyncError, syncOnce, type SyncIO } from '../core/sync';
import { checkRepository, fetchLibrary, isRepoName, saveLibrary, type GitHubConfig } from '../sync/github';
import { applySyncedLibrary, getState, loadLibrary, onLocalChange } from './store';

/**
 * Keeps this device's recipes in step with the shared library on GitHub:
 * on opening the app, after every change here, on coming back to the app,
 * when the connection returns, and every few minutes while open.
 */

export interface SyncStatus {
  config: { repo: string } | null;
  state: 'off' | 'idle' | 'syncing' | 'error' | 'offline';
  lastSyncedAt?: number;
  message?: string;
}

const CONFIG_KEY = 'sync';
const LAST_KEY = 'syncLastAt';

function readConfig(): GitHubConfig | null {
  try {
    const value = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null') as Partial<GitHubConfig> | null;
    return value && typeof value.repo === 'string' && typeof value.token === 'string' ? { repo: value.repo, token: value.token } : null;
  } catch {
    return null;
  }
}

function readLast(): number | undefined {
  try {
    const n = Number(localStorage.getItem(LAST_KEY));
    return n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

let config = typeof localStorage === 'undefined' ? null : readConfig();
let status: SyncStatus = config
  ? { config: { repo: config.repo }, state: 'idle', ...(readLast() ? { lastSyncedAt: readLast()! } : {}) }
  : { config: null, state: 'off' };
const listeners = new Set<() => void>();

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

export function getSyncToken(): string | null {
  return config?.token ?? null;
}

/** "iPad", "Pixel", … for the commit message on GitHub. */
function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  const pixel = /Pixel[^;)]*/.exec(ua);
  if (pixel) return pixel[0].trim();
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'a browser';
}

function io(cfg: GitHubConfig): SyncIO {
  return {
    loadLocal: loadLibrary,
    applyLocal: applySyncedLibrary,
    fetchRemote: () => fetchLibrary(cfg),
    putRemote: (file, version) => saveLibrary(cfg, file, version, deviceName()),
    now: () => Date.now(),
  };
}

let running: Promise<void> | null = null;
let again = false;

/** Syncs now (or straight after the sync already running). */
export function syncNow(): Promise<void> {
  if (!config || !getState().loaded) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  const cfg = config;
  running = (async () => {
    setStatus({ state: 'syncing' });
    try {
      await syncOnce(io(cfg));
      if (config !== cfg) return; // turned off meanwhile
      const now = Date.now();
      try {
        localStorage.setItem(LAST_KEY, String(now));
      } catch {
        // fine
      }
      setStatus({ state: 'idle', lastSyncedAt: now, message: undefined });
    } catch (error) {
      if (config !== cfg) return;
      const e = error instanceof SyncError ? error : new SyncError('Something went wrong while syncing.', 'other');
      if (!(error instanceof SyncError)) console.error(error);
      setStatus({ state: e.kind === 'offline' ? 'offline' : 'error', message: e.message });
    }
  })().finally(() => {
    running = null;
    if (again) {
      again = false;
      void syncNow();
    }
  });
  return running;
}

let timer: number | undefined;

/** Sync a moment after a change, so a burst of changes goes up together. */
export function scheduleSync(delayMs = 1500) {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void syncNow(), delayMs);
}

/** Turns sync on after checking the key can reach the repository, then syncs straight away. */
export async function connectSync(repo: string, token: string): Promise<{ private: boolean }> {
  const cfg = { repo: repo.trim(), token: token.trim() };
  if (!isRepoName(cfg.repo)) throw new SyncError('The repository should look like owner/name, for example ngerver1/recipe-data.', 'other');
  if (!cfg.token) throw new SyncError('Paste the sync key first.', 'auth');
  const repoInfo = await checkRepository(cfg);
  config = cfg;
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    // Works for this visit only.
  }
  setStatus({ config: { repo: cfg.repo }, state: 'idle', message: undefined });
  await syncNow();
  return repoInfo;
}

/** Turns sync off on this device. Recipes stay here; the copy on GitHub is untouched. */
export function disconnectSync() {
  config = null;
  try {
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(LAST_KEY);
  } catch {
    // fine
  }
  setStatus({ config: null, state: 'off', lastSyncedAt: undefined, message: undefined });
}

let started = false;

/** Call once, after the store has loaded. */
export function startSync() {
  if (started) return;
  started = true;
  onLocalChange(() => scheduleSync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  window.addEventListener('online', () => void syncNow());
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow();
  }, 3 * 60_000);
  void syncNow();
}
