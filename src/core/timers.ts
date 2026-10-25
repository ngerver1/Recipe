/**
 * Kitchen timers. Every timer works from an absolute end time (epoch ms), never
 * from counting ticks, so it stays right through sleep, backgrounding and
 * reloads. All functions are pure: they take `now` and return new values.
 */

export interface Timer {
  id: string;
  label: string;
  /** The step it was started from, if any. Quick timers have none. */
  stepId?: string;
  /** Length as set, including any added minutes. */
  durationMs: number;
  /** Set while running (including once finished). */
  endsAt: number | null;
  /** Set while paused. */
  remainingMs: number | null;
  /** When the app first showed this timer as finished. Drives the 2-minute chime window. */
  noticedAt?: number;
}

export const MINUTE = 60_000;
export const CHIME_WINDOW_MS = 2 * MINUTE;

export function startTimer(opts: { id: string; label: string; seconds: number; now: number; stepId?: string }): Timer {
  const durationMs = Math.max(1, Math.round(opts.seconds)) * 1000;
  return {
    id: opts.id,
    label: opts.label,
    ...(opts.stepId ? { stepId: opts.stepId } : {}),
    durationMs,
    endsAt: opts.now + durationMs,
    remainingMs: null,
  };
}

export function timeLeft(timer: Timer, now: number): number {
  if (timer.remainingMs !== null) return timer.remainingMs;
  if (timer.endsAt !== null) return Math.max(0, timer.endsAt - now);
  return 0;
}

export function isPaused(timer: Timer): boolean {
  return timer.remainingMs !== null;
}

export function isFinished(timer: Timer, now: number): boolean {
  return timer.endsAt !== null && timer.endsAt <= now;
}

export function isRunning(timer: Timer, now: number): boolean {
  return timer.endsAt !== null && timer.endsAt > now;
}

export function pauseTimer(timer: Timer, now: number): Timer {
  if (!isRunning(timer, now)) return timer;
  return { ...timer, endsAt: null, remainingMs: timer.endsAt! - now };
}

export function resumeTimer(timer: Timer, now: number): Timer {
  if (timer.remainingMs === null) return timer;
  return { ...timer, endsAt: now + timer.remainingMs, remainingMs: null };
}

/** +1 min. On a finished timer this restarts it with one minute to go (snooze). */
export function addMinute(timer: Timer, now: number): Timer {
  if (timer.remainingMs !== null) {
    return { ...timer, remainingMs: timer.remainingMs + MINUTE, durationMs: timer.durationMs + MINUTE };
  }
  if (timer.endsAt === null) return timer;
  if (timer.endsAt <= now) {
    const { noticedAt: _dropped, ...rest } = timer;
    return { ...rest, endsAt: now + MINUTE, durationMs: MINUTE };
  }
  return { ...timer, endsAt: timer.endsAt + MINUTE, durationMs: timer.durationMs + MINUTE };
}

/**
 * Marks timers that have finished but haven't been shown yet. Call it only
 * while the app is visible, so anything that finished in the background rings
 * when the app comes back.
 */
export function noticeFinished(timers: Timer[], now: number): { timers: Timer[]; newlyFinished: Timer[] } {
  const newlyFinished: Timer[] = [];
  const next = timers.map((t) => {
    if (isFinished(t, now) && t.noticedAt === undefined) {
      const noticed = { ...t, noticedAt: now };
      newlyFinished.push(noticed);
      return noticed;
    }
    return t;
  });
  return newlyFinished.length ? { timers: next, newlyFinished } : { timers, newlyFinished };
}

/** Finished timers, waiting for Stop or +1 min, oldest first. */
export function ringingTimers(timers: Timer[], now: number): Timer[] {
  return timers.filter((t) => isFinished(t, now)).sort((a, b) => a.endsAt! - b.endsAt!);
}

/** True while the chime should sound: a finished timer was noticed less than 2 minutes ago. */
export function shouldChime(timers: Timer[], now: number): boolean {
  return timers.some((t) => isFinished(t, now) && t.noticedAt !== undefined && now - t.noticedAt < CHIME_WINDOW_MS);
}

/** How long before it was noticed the timer actually ended (0 if noticed straight away). */
export function finishedWhileAwayMs(timer: Timer): number {
  if (timer.endsAt === null || timer.noticedAt === undefined) return 0;
  return Math.max(0, timer.noticedAt - timer.endsAt);
}

/** Tray order: ringing first, then by time left. */
export function sortForTray(timers: Timer[], now: number): Timer[] {
  return [...timers].sort((a, b) => {
    const fa = isFinished(a, now) ? 0 : 1;
    const fb = isFinished(b, now) ? 0 : 1;
    return fa - fb || timeLeft(a, now) - timeLeft(b, now);
  });
}
