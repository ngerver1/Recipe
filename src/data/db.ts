import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { RecipeRecord } from '../core/library';
import { isCookSession, type CookSession } from '../core/session';

interface RecipeCardsDB extends DBSchema {
  recipes: { key: string; value: RecipeRecord };
  kv: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<RecipeCardsDB>> | null = null;

function db() {
  dbPromise ??= openDB<RecipeCardsDB>('recipe-cards', 1, {
    upgrade(database) {
      database.createObjectStore('recipes', { keyPath: 'id' });
      database.createObjectStore('kv');
    },
  });
  return dbPromise;
}

export async function loadRecipes(): Promise<RecipeRecord[]> {
  return (await db()).getAll('recipes');
}

export async function putRecipes(records: RecipeRecord[]): Promise<void> {
  const tx = (await db()).transaction('recipes', 'readwrite');
  await Promise.all([...records.map((r) => tx.store.put(r)), tx.done]);
}

export async function deleteRecipe(id: string): Promise<void> {
  await (await db()).delete('recipes', id);
}

export async function loadSession(): Promise<CookSession | null> {
  const value = await (await db()).get('kv', 'session');
  return isCookSession(value) ? value : null;
}

export async function saveSession(session: CookSession | null): Promise<void> {
  const d = await db();
  if (session) await d.put('kv', session, 'session');
  else await d.delete('kv', 'session');
}

/** Asks the browser not to clear our data under storage pressure. Returns whether storage is persistent. */
export async function requestPersistence(): Promise<boolean | undefined> {
  try {
    if (!navigator.storage?.persist) return undefined;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return undefined;
  }
}
