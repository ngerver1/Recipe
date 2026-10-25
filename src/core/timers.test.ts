import { describe, expect, it } from 'vitest';
import {
  addMinute,
  CHIME_WINDOW_MS,
  finishedWhileAwayMs,
  isFinished,
  isPaused,
  noticeFinished,
  pauseTimer,
  resumeTimer,
  ringingTimers,
  shouldChime,
  sortForTray,
  startTimer,
  timeLeft,
} from './timers';

const T0 = 1_000_000;
const rice = () => startTimer({ id: 't1', label: 'Rice', seconds: 900, now: T0, stepId: 's1' });

describe('timers', () => {
  it('starts from an absolute end time', () => {
    const t = rice();
    expect(t).toMatchObject({ endsAt: T0 + 900_000, remainingMs: null, durationMs: 900_000, stepId: 's1' });
    expect(timeLeft(t, T0 + 60_000)).toBe(840_000);
  });

  it('pauses and resumes without losing time', () => {
    const paused = pauseTimer(rice(), T0 + 100_000);
    expect(isPaused(paused)).toBe(true);
    expect(timeLeft(paused, T0 + 500_000)).toBe(800_000); // frozen while paused
    const resumed = resumeTimer(paused, T0 + 500_000);
    expect(resumed.endsAt).toBe(T0 + 500_000 + 800_000);
    expect(timeLeft(resumed, T0 + 600_000)).toBe(700_000);
  });

  it('does not pause a finished timer', () => {
    const t = rice();
    expect(pauseTimer(t, T0 + 2_000_000)).toBe(t);
  });

  it('+1 min adds a minute while running or paused', () => {
    expect(addMinute(rice(), T0).endsAt).toBe(T0 + 960_000);
    const paused = pauseTimer(rice(), T0 + 100_000);
    expect(addMinute(paused, T0 + 200_000).remainingMs).toBe(860_000);
  });

  it('+1 min on a finished timer restarts it with a minute to go', () => {
    const later = T0 + 1_000_000;
    const { timers } = noticeFinished([rice()], later);
    const snoozed = addMinute(timers[0]!, later);
    expect(snoozed.endsAt).toBe(later + 60_000);
    expect(snoozed.noticedAt).toBeUndefined();
    expect(isFinished(snoozed, later)).toBe(false);
  });

  it('works out a timer that finished while the app was in the background', () => {
    const t = rice();
    const backAt = T0 + 900_000 + 4 * 60_000; // came back 4 minutes after it ended
    expect(timeLeft(t, backAt)).toBe(0);
    expect(isFinished(t, backAt)).toBe(true);
    const { timers, newlyFinished } = noticeFinished([t], backAt);
    expect(newlyFinished.map((x) => x.id)).toEqual(['t1']);
    expect(finishedWhileAwayMs(timers[0]!)).toBe(4 * 60_000);
    expect(shouldChime(timers, backAt)).toBe(true);
  });

  it('notices each finished timer once', () => {
    const first = noticeFinished([rice()], T0 + 900_000);
    const second = noticeFinished(first.timers, T0 + 901_000);
    expect(second.newlyFinished).toEqual([]);
    expect(second.timers).toBe(first.timers);
  });

  it('chimes for 2 minutes after being noticed, but keeps ringing', () => {
    const at = T0 + 900_000;
    const { timers } = noticeFinished([rice()], at);
    expect(shouldChime(timers, at + CHIME_WINDOW_MS - 1)).toBe(true);
    expect(shouldChime(timers, at + CHIME_WINDOW_MS)).toBe(false);
    expect(ringingTimers(timers, at + CHIME_WINDOW_MS)).toHaveLength(1);
  });

  it('does not chime for a finished timer that has not been noticed yet', () => {
    expect(shouldChime([rice()], T0 + 950_000)).toBe(false);
  });

  it('runs several timers at once and sorts the tray: ringing first, then soonest', () => {
    const a = startTimer({ id: 'a', label: 'Chicken', seconds: 4500, now: T0 });
    const b = startTimer({ id: 'b', label: 'Potatoes', seconds: 2700, now: T0 });
    const c = startTimer({ id: 'c', label: 'Parboil', seconds: 480, now: T0 });
    const at = T0 + 600_000;
    expect(sortForTray([a, b, c], at).map((t) => t.id)).toEqual(['c', 'b', 'a']);
    expect(ringingTimers([a, b, c], at).map((t) => t.id)).toEqual(['c']);
  });
});
