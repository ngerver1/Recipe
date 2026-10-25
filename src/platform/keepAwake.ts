import { useEffect, useSyncExternalStore } from 'react';
import { getKeepAwakeMode } from './prefs';
import { SILENT_VIDEO } from './silentVideo';

/**
 * Keeps the screen on while the app is open, in two layers:
 *
 * 1. Screen Wake Lock, re-requested whenever the app becomes visible again
 *    (the browser drops it when the app is hidden).
 * 2. A tiny silent video, on iPad and iPhone always, and anywhere Wake Lock is
 *    missing or refused (or when Settings asks for it). iOS keeps the display
 *    on during video playback, but only for a video with a sound track that
 *    isn't muted and isn't set to loop, and the first play has to come from a
 *    tap. So the video has a silent sound track, is started on a tap, and is
 *    kept going by jumping back to the start instead of looping.
 */

export interface KeepAwakeStatus {
  wanted: boolean;
  wakeLock: 'holding' | 'released' | 'refused' | 'unsupported' | 'off';
  video: 'playing' | 'waiting-for-tap' | 'off';
}

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

let status: KeepAwakeStatus = { wanted: false, wakeLock: 'off', video: 'off' };
const listeners = new Set<() => void>();
let wanted = false;
let sentinel: WakeLockSentinel | null = null;
let acquiring = false;
let wakeLockRefused = false;
let video: HTMLVideoElement | null = null;

function update(patch: Partial<KeepAwakeStatus>) {
  status = { ...status, ...patch, wanted };
  listeners.forEach((l) => l());
}

export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

/** iPhone, or an iPad (which reports itself as a Mac with a touch screen). */
export function isAppleTouchDevice(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function videoNeeded(): boolean {
  return getKeepAwakeMode() === 'video' || isAppleTouchDevice() || !wakeLockSupported() || wakeLockRefused;
}

async function requestWakeLock() {
  if (!wakeLockSupported()) {
    update({ wakeLock: 'unsupported' });
    return;
  }
  if (acquiring || (sentinel && !sentinel.released)) return;
  acquiring = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    sentinel = lock;
    wakeLockRefused = false;
    update({ wakeLock: 'holding' });
    lock.addEventListener('release', () => {
      if (sentinel === lock) sentinel = null;
      if (!wanted) return;
      update({ wakeLock: 'released' });
      if (document.visibilityState === 'visible') void requestWakeLock();
    });
  } catch {
    wakeLockRefused = true;
    update({ wakeLock: 'refused' });
  } finally {
    acquiring = false;
  }
}

function ensureVideo(): HTMLVideoElement {
  if (video) return video;
  const v = document.createElement('video');
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.setAttribute('aria-hidden', 'true');
  v.setAttribute('title', 'Keeping the screen on');
  v.preload = 'auto';
  v.src = SILENT_VIDEO;
  Object.assign(v.style, {
    position: 'fixed',
    left: '-10px',
    top: '-10px',
    width: '1px',
    height: '1px',
    opacity: '0',
    pointerEvents: 'none',
  });
  // Keep it playing without `loop`, which iOS doesn't count for keeping the display on.
  v.addEventListener('timeupdate', () => {
    if (v.currentTime > 0.5) v.currentTime = Math.random() * 0.5;
  });
  v.addEventListener('ended', () => void playVideo());
  // iOS can pause it (another app took the audio, the chime changed the audio session); start it again.
  v.addEventListener('pause', () => {
    if (v !== video) return; // stopped on purpose
    update({ video: 'waiting-for-tap' });
    if (wanted && document.visibilityState === 'visible') window.setTimeout(() => void playVideo(), 300);
  });
  document.body.appendChild(v);
  video = v;
  return v;
}

async function playVideo() {
  if (!wanted || !videoNeeded() || document.visibilityState !== 'visible') return;
  const v = ensureVideo();
  if (!v.paused) return;
  // Mix with any music or podcast instead of stopping it (Safari 17+).
  const session = (navigator as AudioSessionNavigator).audioSession;
  if (session && session.type !== 'playback') {
    try {
      session.type = 'ambient';
    } catch {
      // ignore
    }
  }
  try {
    await v.play();
    update({ video: 'playing' });
  } catch {
    // Needs a tap first; the tap listener below starts it.
    update({ video: 'waiting-for-tap' });
  }
}

function stopVideo() {
  if (!video) return;
  const v = video;
  video = null;
  v.pause();
  v.remove();
  update({ video: 'off' });
}

function acquire() {
  if (!wanted || document.visibilityState !== 'visible') return;
  void requestWakeLock();
  if (videoNeeded()) void playVideo();
  else stopVideo();
}

function release() {
  const lock = sentinel;
  sentinel = null;
  void lock?.release().catch(() => {});
  stopVideo();
  update({ wakeLock: 'off', video: 'off' });
}

/** Turn keeping the screen on on or off. Safe to call repeatedly. */
export function setKeepAwake(on: boolean) {
  if (on === wanted) return;
  wanted = on;
  if (on) acquire();
  else release();
}

/** Re-apply after the setting changes. */
export function refreshKeepAwake() {
  if (!wanted) return;
  stopVideo();
  acquire();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') acquire();
  });
  // Taps that browsers accept as permission to start media. Retry anything not yet running.
  const onTap = () => {
    if (!wanted) return;
    if (videoNeeded() && (!video || video.paused)) void playVideo();
    if (wakeLockSupported() && !wakeLockRefused && !(sentinel && !sentinel.released)) void requestWakeLock();
  };
  for (const type of ['click', 'touchend', 'keydown']) {
    document.addEventListener(type, onTap, { capture: true, passive: true });
  }
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
