import { useEffect, useSyncExternalStore } from 'react';
import { getKeepAwakeMode } from './prefs';
import { SILENT_VIDEO } from './silentVideo';

/**
 * Keeps the screen on while cooking. Uses the Screen Wake Lock API, re-requested
 * whenever the app becomes visible again (the browser drops it when hidden).
 * Falls back to a muted, looping, invisible video where Wake Lock isn't
 * available, or when the "video" mode is chosen in Settings.
 */

export interface KeepAwakeStatus {
  wanted: boolean;
  method: 'wake-lock' | 'video' | 'none';
  holding: boolean;
  note?: string;
}

let status: KeepAwakeStatus = { wanted: false, method: 'none', holding: false };
const listeners = new Set<() => void>();
let wanted = false;
let sentinel: WakeLockSentinel | null = null;
let acquiring = false;
let video: HTMLVideoElement | null = null;

function setStatus(next: Omit<KeepAwakeStatus, 'wanted'>) {
  status = { ...next, wanted };
  listeners.forEach((l) => l());
}

export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

async function acquire() {
  if (!wanted || document.visibilityState !== 'visible' || acquiring) return;
  if (getKeepAwakeMode() === 'auto' && wakeLockSupported()) {
    if (sentinel && !sentinel.released) return;
    acquiring = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      sentinel = lock;
      lock.addEventListener('release', () => {
        if (sentinel === lock) sentinel = null;
        if (wanted) {
          setStatus({ method: 'wake-lock', holding: false, note: 'Released; asking again when the app is visible' });
          void acquire();
        }
      });
      stopVideo();
      setStatus({ method: 'wake-lock', holding: true });
      return;
    } catch (error) {
      setStatus({ method: 'video', holding: false, note: `Wake Lock refused (${(error as Error).name}), using the video fallback` });
    } finally {
      acquiring = false;
    }
  }
  startVideo();
}

function startVideo() {
  if (!video) {
    video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.setAttribute('aria-hidden', 'true');
    video.muted = true;
    video.loop = true;
    video.src = SILENT_VIDEO;
    Object.assign(video.style, {
      position: 'fixed',
      left: '0',
      bottom: '0',
      width: '1px',
      height: '1px',
      opacity: '0.01',
      pointerEvents: 'none',
    });
    document.body.appendChild(video);
  }
  video
    .play()
    .then(() => setStatus({ method: 'video', holding: true }))
    .catch(() => {
      setStatus({ method: 'video', holding: false, note: 'Waiting for a tap to start' });
      document.addEventListener('pointerdown', () => void acquire(), { once: true, capture: true });
    });
}

function stopVideo() {
  if (!video) return;
  video.pause();
  video.remove();
  video = null;
}

function release() {
  const lock = sentinel;
  sentinel = null;
  void lock?.release().catch(() => {});
  stopVideo();
  setStatus({ method: 'none', holding: false });
}

/** Turn keeping the screen on on or off. Safe to call repeatedly. */
export function setKeepAwake(on: boolean) {
  if (on === wanted) return;
  wanted = on;
  if (on) void acquire();
  else release();
}

/** Re-apply after the mode changes in Settings. */
export function refreshKeepAwake() {
  if (!wanted) return;
  release();
  wanted = true;
  void acquire();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wanted) void acquire();
  });
}

export function useKeepAwake(on: boolean) {
  useEffect(() => {
    setKeepAwake(on);
  }, [on]);
}

export function useKeepAwakeStatus(): KeepAwakeStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}
