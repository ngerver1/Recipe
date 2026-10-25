import { describe, expect, it } from 'vitest';
import stewJson from '../../examples/pressure-cooker-beef-stew.json';
import {
  addQuickTimer,
  canUndo,
  draftSeconds,
  goToStep,
  isCookSession,
  markDone,
  reconcileSession,
  setDraft,
  startSession,
  startStepTimer,
  timerForStep,
  toggleGathered,
  toggleStepDone,
  undoDone,
  updateTimer,
  UNDO_MS,
} from './session';
import { timeLeft } from './timers';
import { validateRecipe } from './validate';

const result = validateRecipe(stewJson);
if (!result.ok) throw new Error('stew should be valid');
const stew = result.recipe;
const steps = stew.steps;
const T0 = 1_700_000_000_000;

const fresh = () => startSession({ recipeId: 'r1', now: T0, gathered: ['stock'] });

describe('cook session: Done and Undo', () => {
  it('starts at the first step with gathering ticks carried over', () => {
    const s = fresh();
    expect(s).toMatchObject({ currentIndex: 0, stage: 'cook', done: [], gathered: ['stock'] });
  });

  it('Done marks the step finished and moves on', () => {
    const s = markDone(fresh(), steps, T0 + 1000);
    expect(s.currentIndex).toBe(1);
    expect(s.done).toEqual(['s1']);
  });

  it('Undo within 5 seconds restores the step', () => {
    const done = markDone(fresh(), steps, T0 + 1000);
    expect(canUndo(done, T0 + 1000 + UNDO_MS - 1)).toBe(true);
    expect(canUndo(done, T0 + 1000 + UNDO_MS)).toBe(false);
    const undone = undoDone(done, T0 + 2000);
    expect(undone.currentIndex).toBe(0);
    expect(undone.done).toEqual([]);
    expect(undone.undo).toBeUndefined();
  });

  it('Done on the last step finishes, and Undo comes back from Finished', () => {
    let s = goToStep(fresh(), steps.length - 1, steps.length, T0);
    s = markDone(s, steps, T0 + 1000);
    expect(s.stage).toBe('finished');
    expect(s.finishedAt).toBe(T0 + 1000);
    expect(s.currentIndex).toBe(steps.length - 1);
    const back = undoDone(s, T0 + 2000);
    expect(back.stage).toBe('cook');
    expect(back.finishedAt).toBeUndefined();
    expect(back.done).toEqual([]);
  });

  it('Done does not stop the step’s timer', () => {
    let s = goToStep(fresh(), 1, steps.length, T0); // "Brown the beef" has a timer
    s = startStepTimer(s, steps[1]!, 't1', T0);
    s = markDone(s, steps, T0 + 1000);
    expect(s.timers).toHaveLength(1);
    expect(timeLeft(s.timers[0]!, T0 + 1000)).toBe(599_000);
  });

  it('Done on a step already ticked keeps it ticked once', () => {
    let s = toggleStepDone(fresh(), 's1', T0);
    s = markDone(s, steps, T0);
    expect(s.done).toEqual(['s1']);
  });
});

describe('cook session: jumping', () => {
  it('moving to another step changes nothing else', () => {
    const s = markDone(fresh(), steps, T0);
    const back = goToStep(s, 0, steps.length, T0 + 100);
    expect(back.currentIndex).toBe(0);
    expect(back.done).toEqual(['s1']);
    const forward = goToStep(back, 5, steps.length, T0 + 200);
    expect(forward.currentIndex).toBe(5);
    expect(forward.done).toEqual(['s1']);
  });

  it('keeps the position in range', () => {
    expect(goToStep(fresh(), 99, steps.length, T0).currentIndex).toBe(steps.length - 1);
    expect(goToStep(fresh(), -3, steps.length, T0).currentIndex).toBe(0);
  });

  it('ticks and unticks steps and ingredients', () => {
    let s = toggleStepDone(fresh(), 's3', T0);
    expect(s.done).toEqual(['s3']);
    s = toggleStepDone(s, 's3', T0);
    expect(s.done).toEqual([]);
    s = toggleGathered(s, 'beef', T0);
    expect(s.gathered).toEqual(['stock', 'beef']);
    s = toggleGathered(s, 'stock', T0);
    expect(s.gathered).toEqual(['beef']);
  });
});

describe('cook session: timers', () => {
  it('starts a step timer from the recipe, or from the adjusted draft', () => {
    const step = steps[1]!; // 600 s
    let s = fresh();
    expect(draftSeconds(s, step)).toBe(600);
    s = setDraft(s, step.id, 660, T0);
    s = startStepTimer(s, step, 't1', T0);
    expect(s.timers[0]).toMatchObject({ label: 'Brown beef', stepId: 's2', durationMs: 660_000 });
    expect(timerForStep(s, 's2')?.id).toBe('t1');
  });

  it('adds quick timers and updates or removes them', () => {
    let s = addQuickTimer(fresh(), '', 300, 'q1', T0);
    s = addQuickTimer(s, 'Eggs', 420, 'q2', T0);
    expect(s.timers.map((t) => t.label)).toEqual(['Timer', 'Eggs']);
    s = updateTimer(s, 'q1', 'pause', T0 + 60_000);
    expect(s.timers[0]!.remainingMs).toBe(240_000);
    s = updateTimer(s, 'q1', 'addMinute', T0 + 60_000);
    expect(s.timers[0]!.remainingMs).toBe(300_000);
    s = updateTimer(s, 'q1', 'resume', T0 + 120_000);
    expect(s.timers[0]!.endsAt).toBe(T0 + 420_000);
    s = updateTimer(s, 'q1', 'remove', T0);
    expect(s.timers.map((t) => t.id)).toEqual(['q2']);
  });
});

describe('cook session: resuming', () => {
  it('survives being saved and read back', () => {
    let s = markDone(fresh(), steps, T0);
    s = startStepTimer(goToStep(s, 1, steps.length, T0), steps[1]!, 't1', T0);
    s = toggleGathered(s, 'beef', T0);
    const restored = JSON.parse(JSON.stringify(s));
    expect(isCookSession(restored)).toBe(true);
    expect(restored).toEqual(s);
    // A reload 7 minutes later: the timer has kept counting from its end time.
    expect(timeLeft(restored.timers[0], T0 + 7 * 60_000)).toBe(3 * 60_000);
  });

  it('rejects things that are not sessions', () => {
    expect(isCookSession(null)).toBe(false);
    expect(isCookSession({ v: 2 })).toBe(false);
  });

  it('copes with the recipe being replaced by a shorter one', () => {
    let s = goToStep(fresh(), 10, steps.length, T0);
    s = toggleStepDone(s, 's10', T0);
    const shorter = { ...stew, steps: steps.slice(0, 4), ingredients: [] };
    const r = reconcileSession(s, shorter);
    expect(r.currentIndex).toBe(3);
    expect(r.done).toEqual([]);
    expect(r.gathered).toEqual([]);
  });
});
