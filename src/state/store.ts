import { useSyncExternalStore } from 'react';
import { dedupeKey, sortByImported, type RecipeRecord } from '../core/library';
import type { Recipe } from '../core/schema';
import { reconcileSession, type CookSession } from '../core/session';
import { sameRecord, type LibraryState } from '../core/sync';
import { validateRecipe } from '../core/validate';
import * as db from '../data/db';

export interface LoadedRecipe {
  record: RecipeRecord;
  /** Null if the saved JSON can no longer be read (shouldn't happen, but never crash on it). */
  recipe: Recipe | null;
  problems?: string[];
}

export interface AppState {
  loaded: boolean;
  recipes: LoadedRecipe[];
  session: CookSession | null;
  persisted?: boolean;
  storageError?: string;
}

let state: AppState = { loaded: false, recipes: [], session: null };
const listeners = new Set<() => void>();

function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getState(): AppState {
  return state;
}

export function useAppState(): AppState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

function load(record: RecipeRecord): LoadedRecipe {
  const result = validateRecipe(record.raw);
  return result.ok ? { record, recipe: result.recipe } : { record, recipe: null, problems: result.errors };
}

export function findRecipe(id: string | undefined): LoadedRecipe | undefined {
  return id ? state.recipes.find((r) => r.record.id === id) : undefined;
}

/* Changes made on this device (import, delete, cooked), so sync can send them on. */
const localChangeListeners = new Set<() => void>();

export function onLocalChange(listener: () => void): () => void {
  localChangeListeners.add(listener);
  return () => localChangeListeners.delete(listener);
}

function localChanged() {
  localChangeListeners.forEach((l) => l());
}

function storageFailed(error: unknown) {
  console.error(error);
  set({ storageError: 'Couldn’t save to this device’s storage. If you’re in a private window, use a normal one.' });
}

export async function init(): Promise<void> {
  try {
    const [records, session] = await Promise.all([db.loadRecipes(), db.loadSession()]);
    const recipes = sortByImported(records.map(load));
    let restored = session;
    if (session) {
      const recipe = recipes.find((r) => r.record.id === session.recipeId)?.recipe;
      restored = recipe ? reconcileSession(session, recipe) : null;
      if (!restored) void db.saveSession(null);
    }
    set({ loaded: true, recipes, session: restored });
  } catch (error) {
    set({ loaded: true });
    storageFailed(error);
  }
  void db.requestPersistence().then((persisted) => set({ persisted }));
}

export async function saveRecipe(raw: unknown, recipe: Recipe, replaceId?: string): Promise<RecipeRecord> {
  const existing = findRecipe(replaceId)?.record;
  const now = Date.now();
  const record: RecipeRecord = {
    id: existing?.id ?? crypto.randomUUID(),
    raw,
    importedAt: now,
    updatedAt: now,
    ...(existing?.lastCookedAt ? { lastCookedAt: existing.lastCookedAt } : {}),
    dedupeKey: dedupeKey(recipe),
  };
  const others = state.recipes.filter((r) => r.record.id !== record.id);
  set({ recipes: sortByImported([{ record, recipe }, ...others]) });
  if (state.session?.recipeId === record.id) setSession(reconcileSession(state.session, recipe));
  try {
    await db.putRecipes([record]);
  } catch (error) {
    storageFailed(error);
  }
  localChanged();
  return record;
}

/** Restoring a backup: these count as changed now, so they win over older deletions on other devices. */
export async function putRecords(incoming: RecipeRecord[]): Promise<void> {
  const now = Date.now();
  const records = incoming.map((r) => ({ ...r, updatedAt: now }));
  const ids = new Set(records.map((r) => r.id));
  const others = state.recipes.filter((r) => !ids.has(r.record.id));
  set({ recipes: sortByImported([...records.map(load), ...others]) });
  try {
    await db.putRecipes(records);
  } catch (error) {
    storageFailed(error);
  }
  localChanged();
}

export async function removeRecipe(id: string): Promise<void> {
  set({ recipes: state.recipes.filter((r) => r.record.id !== id) });
  if (state.session?.recipeId === id) setSession(null);
  try {
    await db.deleteRecipes([id]);
    const tombstones = (await db.loadTombstones()).filter((t) => t.id !== id);
    await db.saveTombstones([...tombstones, { id, deletedAt: Date.now() }]);
  } catch (error) {
    storageFailed(error);
  }
  localChanged();
}

/** This device's library, for syncing. */
export async function loadLibrary(): Promise<LibraryState> {
  return { records: state.recipes.map((r) => r.record), tombstones: await db.loadTombstones() };
}

/**
 * Takes on the result of a sync. Only what changed between `base` (the library the sync started from) and
 * `next` is applied, so anything done on this device while the sync was running is kept. The recipe being
 * cooked right now isn't removed until the cook ends.
 */
export async function applySyncedLibrary(next: LibraryState, base: LibraryState): Promise<void> {
  const before = new Map(base.records.map((r) => [r.id, r]));
  const after = new Set(next.records.map((r) => r.id));
  const puts = next.records.filter((r) => !sameRecord(before.get(r.id), r));
  const removals = base.records.map((r) => r.id).filter((id) => !after.has(id) && id !== state.session?.recipeId);
  const removed = new Set(removals);
  const changed = new Map(puts.map((r) => [r.id, r]));
  const kept = state.recipes.filter((r) => !removed.has(r.record.id) && !changed.has(r.record.id));
  set({ recipes: sortByImported([...puts.map(load), ...kept]) });
  if (state.session) {
    const recipe = findRecipe(state.session.recipeId)?.recipe;
    if (recipe) setSession(reconcileSession(state.session, recipe));
  }
  try {
    await db.putRecipes(puts);
    await db.deleteRecipes(removals);
    // Keep any deletion made on this device while the sync was running.
    const tombstones = new Map(next.tombstones.map((t) => [t.id, t.deletedAt]));
    for (const t of await db.loadTombstones()) tombstones.set(t.id, Math.max(tombstones.get(t.id) ?? 0, t.deletedAt));
    await db.saveTombstones([...tombstones].map(([id, deletedAt]) => ({ id, deletedAt })));
  } catch (error) {
    storageFailed(error);
  }
}

export async function markCooked(id: string, at = Date.now()): Promise<void> {
  const found = findRecipe(id);
  if (!found) return;
  const record = { ...found.record, lastCookedAt: at };
  set({ recipes: state.recipes.map((r) => (r.record.id === id ? { ...r, record } : r)) });
  try {
    await db.putRecipes([record]);
  } catch (error) {
    storageFailed(error);
  }
  localChanged();
}

let saving: Promise<void> = Promise.resolve();

/** Replaces the cook session and saves it straight away (writes are queued so they land in order). */
export function setSession(session: CookSession | null): void {
  if (session === state.session) return;
  set({ session });
  saving = saving.then(() => db.saveSession(session)).catch(storageFailed);
}

export function updateSession(fn: (s: CookSession) => CookSession): void {
  if (state.session) setSession(fn(state.session));
}
