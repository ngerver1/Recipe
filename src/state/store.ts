import { useSyncExternalStore } from 'react';
import { dedupeKey, sortByImported, type RecipeRecord } from '../core/library';
import type { Recipe } from '../core/schema';
import { reconcileSession, type CookSession } from '../core/session';
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
  const record: RecipeRecord = {
    id: existing?.id ?? crypto.randomUUID(),
    raw,
    importedAt: Date.now(),
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
  return record;
}

export async function putRecords(records: RecipeRecord[]): Promise<void> {
  const ids = new Set(records.map((r) => r.id));
  const others = state.recipes.filter((r) => !ids.has(r.record.id));
  set({ recipes: sortByImported([...records.map(load), ...others]) });
  try {
    await db.putRecipes(records);
  } catch (error) {
    storageFailed(error);
  }
}

export async function removeRecipe(id: string): Promise<void> {
  set({ recipes: state.recipes.filter((r) => r.record.id !== id) });
  if (state.session?.recipeId === id) setSession(null);
  try {
    await db.deleteRecipe(id);
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
