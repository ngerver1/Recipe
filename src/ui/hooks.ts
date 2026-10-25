import { useEffect, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

/** The current time, updated every `intervalMs` while enabled and the page is visible. */
export function useNow(intervalMs = 250, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    let id: number | undefined;
    const tick = () => setNow(Date.now());
    const startStop = () => {
      window.clearInterval(id);
      if (document.visibilityState === 'visible') {
        tick();
        id = window.setInterval(tick, intervalMs);
      }
    };
    startStop();
    document.addEventListener('visibilitychange', startStop);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', startStop);
    };
  }, [intervalMs, enabled]);
  return now;
}

export function useVisible(): boolean {
  return useSyncExternalStore(
    (l) => {
      document.addEventListener('visibilitychange', l);
      return () => document.removeEventListener('visibilitychange', l);
    },
    () => document.visibilityState === 'visible',
  );
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (l) => {
      const mq = matchMedia(query);
      mq.addEventListener('change', l);
      return () => mq.removeEventListener('change', l);
    },
    () => matchMedia(query).matches,
  );
}

/** Runs a state change as a view transition (cards sliding between slots), unless reduced motion is on. */
export function withTransition(update: () => void, direction: 'forward' | 'back' = 'forward'): void {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || typeof document.startViewTransition !== 'function') {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.nav = direction;
  try {
    const transition = document.startViewTransition(() => flushSync(update));
    void transition.finished.finally(() => delete root.dataset.nav);
  } catch {
    delete root.dataset.nav;
    update();
  }
}

export function newId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
