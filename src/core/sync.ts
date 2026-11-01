import { sameJson } from './backup';
import type { RecipeRecord } from './library';
import { isObject } from './parse';

/**
 * Syncing the recipe library between devices through one shared file.
 *
 * Every device keeps its own copy and merges with the shared file instead of
 * overwriting it, so nothing is lost when two devices change things between
 * syncs:
 * - a recipe added on either side is kept;
 * - when both sides changed the same recipe, the later change wins, and
 *   "last cooked" keeps the later date;
 * - a deletion is remembered (a tombstone) so the recipe doesn't come back
 *   from a device that still has it;
 * - the same recipe imported separately on two devices (same source, same
 *   JSON) is folded into one.
 *
 * All functions are pure, except syncOnce, which does its I/O through `io`.
 */

export const SYNC_FORMAT = 'recipe-cards-sync';

export interface Tombstone {
  id: string;
  deletedAt: number;
}

export interface LibraryState {
  records: RecipeRecord[];
  tombstones: Tombstone[];
}

export interface SyncFile {
  format: typeof SYNC_FORMAT;
  version: 1;
  updatedAt: string;
  recipes: RecipeRecord[];
  deleted: Tombstone[];
}

export interface MergeResult extends LibraryState {
  /** This device needs to take on changes. */
  changedLocal: boolean;
  /** The shared file needs updating. */
  changedRemote: boolean;
}

export const EMPTY_LIBRARY: LibraryState = { records: [], tombstones: [] };

export function updatedOf(record: RecipeRecord): number {
  return record.updatedAt ?? record.importedAt;
}

/** Same content and app fields. */
export function sameRecord(a: RecipeRecord | undefined, b: RecipeRecord | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.id === b.id &&
    a.importedAt === b.importedAt &&
    updatedOf(a) === updatedOf(b) &&
    (a.lastCookedAt ?? 0) === (b.lastCookedAt ?? 0) &&
    a.dedupeKey === b.dedupeKey &&
    sameJson(a.raw, b.raw)
  );
}

function sameLibrary(a: LibraryState, b: LibraryState): boolean {
  if (a.records.length !== b.records.length || a.tombstones.length !== b.tombstones.length) return false;
  const records = new Map(a.records.map((r) => [r.id, r]));
  if (!b.records.every((r) => sameRecord(records.get(r.id), r))) return false;
  const tombs = new Map(a.tombstones.map((t) => [t.id, t.deletedAt]));
  return b.tombstones.every((t) => tombs.get(t.id) === t.deletedAt);
}

/** The later of two versions of one recipe, with the earliest import date and latest cooked date. */
function combine(a: RecipeRecord, b: RecipeRecord): RecipeRecord {
  let newer: RecipeRecord;
  if (updatedOf(a) !== updatedOf(b)) newer = updatedOf(a) > updatedOf(b) ? a : b;
  else newer = JSON.stringify(a.raw) >= JSON.stringify(b.raw) ? a : b; // same moment: any fixed choice, so every device agrees
  const { lastCookedAt: _drop, ...rest } = newer;
  const lastCookedAt = Math.max(a.lastCookedAt ?? 0, b.lastCookedAt ?? 0);
  return { ...rest, importedAt: Math.min(a.importedAt, b.importedAt), ...(lastCookedAt ? { lastCookedAt } : {}) };
}

export function mergeLibraries(local: LibraryState, remote: LibraryState): MergeResult {
  const tombs = new Map<string, number>();
  for (const t of [...local.tombstones, ...remote.tombstones]) {
    tombs.set(t.id, Math.max(tombs.get(t.id) ?? 0, t.deletedAt));
  }

  const byId = new Map<string, RecipeRecord>();
  for (const r of remote.records) byId.set(r.id, r);
  for (const r of local.records) {
    const other = byId.get(r.id);
    byId.set(r.id, other ? combine(r, other) : r);
  }

  // Deleted after its last change: stays deleted. Changed after the deletion: comes back.
  for (const [id, r] of byId) {
    const deletedAt = tombs.get(id);
    if (deletedAt !== undefined && deletedAt >= updatedOf(r)) byId.delete(id);
  }

  // The same recipe imported on two devices: keep the first import. The tombstone uses the
  // duplicate's own date, so every device works out the same result.
  const groups = new Map<string, RecipeRecord[]>();
  for (const r of byId.values()) groups.set(r.dedupeKey, [...(groups.get(r.dedupeKey) ?? []), r]);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.importedAt - b.importedAt || a.id.localeCompare(b.id));
    const kept: RecipeRecord[] = [];
    for (const r of group) {
      const twin = kept.find((k) => sameJson(k.raw, r.raw));
      if (!twin) {
        kept.push(r);
        continue;
      }
      const lastCookedAt = Math.max(twin.lastCookedAt ?? 0, r.lastCookedAt ?? 0);
      if (lastCookedAt) byId.set(twin.id, { ...byId.get(twin.id)!, lastCookedAt });
      byId.delete(r.id);
      tombs.set(r.id, Math.max(tombs.get(r.id) ?? 0, updatedOf(r)));
    }
  }

  const merged: LibraryState = {
    records: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    tombstones: [...tombs].map(([id, deletedAt]) => ({ id, deletedAt })).sort((a, b) => a.id.localeCompare(b.id)),
  };
  return { ...merged, changedLocal: !sameLibrary(local, merged), changedRemote: !sameLibrary(remote, merged) };
}

export function toSyncFile(library: LibraryState, now: number): SyncFile {
  return {
    format: SYNC_FORMAT,
    version: 1,
    updatedAt: new Date(now).toISOString(),
    recipes: library.records,
    deleted: library.tombstones,
  };
}

export class SyncError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'access' | 'offline' | 'conflict' | 'file' | 'other',
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

/** Reads the shared file. Refuses (rather than overwrite) a file it doesn't understand. */
export function readSyncFile(value: unknown): LibraryState {
  if (!isObject(value) || value.format !== SYNC_FORMAT) {
    throw new SyncError('The sync file on GitHub isn’t a Recipe Cards library, so it was left alone.', 'file');
  }
  if (typeof value.version === 'number' && value.version > 1) {
    throw new SyncError('The sync file was written by a newer version of the app. Update this device (reload while online).', 'file');
  }
  const records = (Array.isArray(value.recipes) ? value.recipes : []).filter(
    (r): r is RecipeRecord =>
      isObject(r) &&
      typeof r.id === 'string' &&
      typeof r.importedAt === 'number' &&
      typeof r.dedupeKey === 'string' &&
      isObject(r.raw) &&
      (r.updatedAt === undefined || typeof r.updatedAt === 'number') &&
      (r.lastCookedAt === undefined || typeof r.lastCookedAt === 'number'),
  );
  const tombstones = (Array.isArray(value.deleted) ? value.deleted : []).filter(
    (t): t is Tombstone => isObject(t) && typeof t.id === 'string' && typeof t.deletedAt === 'number',
  );
  return { records, tombstones };
}

export interface SyncIO {
  /** This device's library right now. */
  loadLocal(): Promise<LibraryState>;
  /** Take on the merged library. `base` is what loadLocal returned, so changes made meanwhile aren't lost. */
  applyLocal(next: LibraryState, base: LibraryState): Promise<void>;
  /** The shared file (null if there isn't one yet) and a version tag for safe writes. */
  fetchRemote(): Promise<{ library: LibraryState | null; version: string | null }>;
  /** Write the shared file, only if it's still at `version`; otherwise throw a SyncError of kind 'conflict'. */
  putRemote(file: SyncFile, version: string | null): Promise<void>;
  now(): number;
}

/** One round: fetch, merge, update this device, update the shared file. Retries if another device wrote in between. */
export async function syncOnce(io: SyncIO, maxAttempts = 4): Promise<{ pulled: boolean; pushed: boolean }> {
  let pulled = false;
  for (let attempt = 1; ; attempt++) {
    const remote = await io.fetchRemote();
    const local = await io.loadLocal();
    const merged = mergeLibraries(local, remote.library ?? EMPTY_LIBRARY);
    if (merged.changedLocal) {
      await io.applyLocal(merged, local);
      pulled = true;
    }
    const push = merged.changedRemote || !remote.library;
    if (!push) return { pulled, pushed: false };
    try {
      await io.putRemote(toSyncFile(merged, io.now()), remote.version);
      return { pulled, pushed: true };
    } catch (error) {
      if (error instanceof SyncError && error.kind === 'conflict' && attempt < maxAttempts) continue;
      throw error;
    }
  }
}
