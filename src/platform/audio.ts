import { useSyncExternalStore } from 'react';

/**
 * The timer chime, made with Web Audio so there's no sound file. iPad Safari
 * only plays sound after a tap, so unlockAudio() runs on the Start cooking tap
 * and on every tap after that (in case the system suspended audio meanwhile).
 */

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

let ctx: AudioContext | null = null;
let output: AudioNode | null = null;
let chimeTimer: number | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function unlockAudio(): void {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      ctx.addEventListener('statechange', notify);
      const compressor = ctx.createDynamicsCompressor();
      const gain = ctx.createGain();
      gain.gain.value = 0.9;
      gain.connect(compressor).connect(ctx.destination);
      output = gain;
    }
    if (ctx.state !== 'running') void ctx.resume().then(notify, notify);
    // iOS fully unlocks only once something has played during a tap.
    const silent = ctx.createBufferSource();
    silent.buffer = ctx.createBuffer(1, 1, 22050);
    silent.connect(ctx.destination);
    silent.start(0);
  } catch {
    // No sound available; the banner and vibration still work.
  }
  notify();
}

export function isAudioReady(): boolean {
  return ctx?.state === 'running';
}

export function useAudioReady(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    isAudioReady,
  );
}

/** One "ding-dong": two bell tones with a few overtones each. */
function strike() {
  if (!ctx || !output) return;
  if (ctx.state !== 'running') void ctx.resume();
  const start = ctx.currentTime + 0.03;
  const notes: [freq: number, offset: number][] = [
    [880, 0],
    [1318.5, 0.22],
    [880, 0.9],
    [1318.5, 1.12],
  ];
  for (const [freq, offset] of notes) {
    for (const [ratio, level] of [
      [1, 0.5],
      [2.76, 0.16],
      [5.4, 0.06],
    ] as const) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const t = start + offset;
      osc.type = 'sine';
      osc.frequency.value = freq * ratio;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(level, t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 1.2 / ratio + 0.4);
      osc.connect(env).connect(output);
      osc.start(t);
      osc.stop(t + 1.8);
    }
  }
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported (iPad).
  }
}

function setPlaybackSession(on: boolean) {
  // Safari: "playback" isn't muted by silent mode. Only while ringing, so music elsewhere isn't interrupted otherwise.
  const session = (navigator as AudioSessionNavigator).audioSession;
  if (session) {
    try {
      session.type = on ? 'playback' : 'auto';
    } catch {
      // ignore
    }
  }
}

/** Rings every 2.5 seconds until stopChime(). */
export function startChime(): void {
  if (chimeTimer !== null) return;
  setPlaybackSession(true);
  const ring = () => {
    strike();
    vibrate([300, 150, 300, 150, 300]);
  };
  ring();
  chimeTimer = window.setInterval(ring, 2500);
}

export function stopChime(): void {
  if (chimeTimer === null) return;
  window.clearInterval(chimeTimer);
  chimeTimer = null;
  vibrate(0);
  setPlaybackSession(false);
}

/** Settings → Test the chime. Call from a tap. */
export function testChime(): void {
  unlockAudio();
  setPlaybackSession(true);
  strike();
  vibrate([300, 150, 300]);
  window.setTimeout(() => {
    if (chimeTimer === null) setPlaybackSession(false);
  }, 2500);
}
