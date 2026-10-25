import type { Recipe, Step } from './schema';
import { addMinute, pauseTimer, resumeTimer, startTimer, type Timer } from './timers';

/**
 * The cook session: where you are in a recipe, what's ticked and what timers
 * are running. Saved after every change so the app resumes exactly where you
 * were. All functions are pure.
 */
export interface CookSession {
  v: 1;
  recipeId: string;
  stage: 'cook' | 'finished';
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  /** Index into recipe.steps of the step in the centre. */
  currentIndex: number;
  /** Ids of steps marked done. */
  done: string[];
  /** Ids of ingredients ticked as gathered. */
  gathered: string[];
  timers: Timer[];
  /** Timer lengths adjusted on a card before starting, by step id. */
  drafts: Record<string, number>;
  /** What to restore if Undo is tapped within UNDO_MS of Done. */
  undo?: { at: number; stepId: string; currentIndex: number; done: string[]; stage: CookSession['stage'] };
}

export const UNDO_MS = 5000;

export function startSession(opts: { recipeId: string; now: number; gathered?: string[] }): CookSession {
  return {
    v: 1,
    recipeId: opts.recipeId,
    stage: 'cook',
    startedAt: opts.now,
    updatedAt: opts.now,
    currentIndex: 0,
    done: [],
    gathered: opts.gathered ?? [],
    timers: [],
    drafts: {},
  };
}

const touch = (s: CookSession, now: number, patch: Partial<CookSession>): CookSession => ({ ...s, ...patch, updatedAt: now });

/** Done: marks the current step finished and moves to the next, or to Finished after the last step. Running timers keep going. */
export function markDone(s: CookSession, steps: Pick<Step, 'id'>[], now: number): CookSession {
  const step = steps[s.currentIndex];
  if (!step) return s;
  const done = s.done.includes(step.id) ? s.done : [...s.done, step.id];
  const undo = { at: now, stepId: step.id, currentIndex: s.currentIndex, done: s.done, stage: s.stage };
  const isLast = s.currentIndex >= steps.length - 1;
  if (isLast) return touch(s, now, { done, undo, stage: 'finished', finishedAt: now });
  return touch(s, now, { done, undo, currentIndex: s.currentIndex + 1 });
}

export function canUndo(s: CookSession, now: number): boolean {
  return !!s.undo && now - s.undo.at < UNDO_MS;
}

/** Undo the last Done: un-ticks that step and goes back to it. Timers are left alone. */
export function undoDone(s: CookSession, now: number): CookSession {
  const { undo, finishedAt, ...rest } = s;
  if (!undo) return s;
  return {
    ...rest,
    ...(undo.stage === 'finished' && finishedAt ? { finishedAt } : {}),
    currentIndex: undo.currentIndex,
    done: undo.done,
    stage: undo.stage,
    updatedAt: now,
  };
}

/** Moves to a step without changing anything else (tapping the previous/next card, or jumping from the Steps list). */
export function goToStep(s: CookSession, index: number, stepCount: number, now: number): CookSession {
  const clamped = Math.min(Math.max(0, Math.round(index)), Math.max(0, stepCount - 1));
  if (clamped === s.currentIndex && s.stage === 'cook') return s;
  return touch(s, now, { currentIndex: clamped, stage: 'cook' });
}

export function toggleStepDone(s: CookSession, stepId: string, now: number): CookSession {
  const done = s.done.includes(stepId) ? s.done.filter((id) => id !== stepId) : [...s.done, stepId];
  return touch(s, now, { done });
}

export function toggleGathered(s: CookSession, ingredientId: string, now: number): CookSession {
  const gathered = s.gathered.includes(ingredientId)
    ? s.gathered.filter((id) => id !== ingredientId)
    : [...s.gathered, ingredientId];
  return touch(s, now, { gathered });
}

/** Seconds shown on a step's timer control before it's started. */
export function draftSeconds(s: CookSession, step: Step): number | undefined {
  if (!step.timer) return undefined;
  return s.drafts[step.id] ?? step.timer.seconds;
}

export function setDraft(s: CookSession, stepId: string, seconds: number, now: number): CookSession {
  return touch(s, now, { drafts: { ...s.drafts, [stepId]: Math.max(1, Math.round(seconds)) } });
}

export function startStepTimer(s: CookSession, step: Step, timerId: string, now: number): CookSession {
  const seconds = draftSeconds(s, step);
  if (!step.timer || !seconds) return s;
  const timer = startTimer({ id: timerId, label: step.timer.label, seconds, now, stepId: step.id });
  return touch(s, now, { timers: [...s.timers, timer] });
}

export function addQuickTimer(s: CookSession, label: string, seconds: number, timerId: string, now: number): CookSession {
  const timer = startTimer({ id: timerId, label: label.trim() || 'Timer', seconds, now });
  return touch(s, now, { timers: [...s.timers, timer] });
}

export type TimerAction = 'pause' | 'resume' | 'addMinute' | 'remove';

export function updateTimer(s: CookSession, timerId: string, action: TimerAction, now: number): CookSession {
  if (action === 'remove') return touch(s, now, { timers: s.timers.filter((t) => t.id !== timerId) });
  const fn = action === 'pause' ? pauseTimer : action === 'resume' ? resumeTimer : addMinute;
  return touch(s, now, { timers: s.timers.map((t) => (t.id === timerId ? fn(t, now) : t)) });
}

export function setTimers(s: CookSession, timers: Timer[], now: number): CookSession {
  return touch(s, now, { timers });
}

/** The newest timer started from this step that's still in the tray. */
export function timerForStep(s: CookSession, stepId: string): Timer | undefined {
  for (let i = s.timers.length - 1; i >= 0; i--) {
    if (s.timers[i]!.stepId === stepId) return s.timers[i];
  }
  return undefined;
}

/**
 * Makes a saved session safe to use with the recipe as it is now (it may have
 * been replaced by a re-import): keeps the position in range and drops ticks
 * for steps or ingredients that no longer exist.
 */
export function reconcileSession(s: CookSession, recipe: Recipe): CookSession {
  const stepIds = new Set(recipe.steps.map((st) => st.id));
  const ingredientIds = new Set((recipe.ingredients ?? []).map((i) => i.id));
  const currentIndex = Math.min(Math.max(0, s.currentIndex), recipe.steps.length - 1);
  const done = s.done.filter((id) => stepIds.has(id));
  const gathered = s.gathered.filter((id) => ingredientIds.has(id));
  if (currentIndex === s.currentIndex && done.length === s.done.length && gathered.length === s.gathered.length) return s;
  return { ...s, currentIndex, done, gathered };
}

/** Checks something read back from storage is a session this version understands. */
export function isCookSession(value: unknown): value is CookSession {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<CookSession>;
  return (
    s.v === 1 &&
    typeof s.recipeId === 'string' &&
    (s.stage === 'cook' || s.stage === 'finished') &&
    typeof s.currentIndex === 'number' &&
    Array.isArray(s.done) &&
    Array.isArray(s.gathered) &&
    Array.isArray(s.timers) &&
    typeof s.drafts === 'object' &&
    s.drafts !== null
  );
}
