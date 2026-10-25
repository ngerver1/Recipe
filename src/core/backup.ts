import { dedupeKey, type RecipeRecord } from './library';
import { isObject } from './parse';
import { validateRecipe } from './validate';

/**
 * Backup of every saved recipe as one .json file. This is the app's own
 * format, separate from the agent's import format: each entry carries the
 * recipe JSON exactly as imported plus the app's fields.
 */

export const BACKUP_FORMAT = 'recipe-cards-backup';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  recipes: { id: string; importedAt: string; lastCookedAt?: string; recipe: unknown }[];
}

export function buildBackup(records: RecipeRecord[], now: number): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date(now).toISOString(),
    recipes: [...records]
      .sort((a, b) => a.importedAt - b.importedAt)
      .map((r) => ({
        id: r.id,
        importedAt: new Date(r.importedAt).toISOString(),
        ...(r.lastCookedAt ? { lastCookedAt: new Date(r.lastCookedAt).toISOString() } : {}),
        recipe: r.raw,
      })),
  };
}

export function isBackup(value: unknown): boolean {
  return isObject(value) && value.format === BACKUP_FORMAT;
}

export type ReadBackupResult =
  | { ok: true; records: RecipeRecord[]; skipped: string[] }
  | { ok: false; error: string };

export function readBackup(value: unknown, now: number): ReadBackupResult {
  if (!isObject(value) || value.format !== BACKUP_FORMAT) {
    return { ok: false, error: 'This isn’t a Recipe Cards backup file.' };
  }
  if (typeof value.version === 'number' && value.version > 1) {
    return { ok: false, error: `This backup was made by a newer version of the app (backup version ${value.version}). Update the app and try again.` };
  }
  if (!Array.isArray(value.recipes)) return { ok: false, error: 'This backup file has no recipes in it.' };

  const records: RecipeRecord[] = [];
  const skipped: string[] = [];
  value.recipes.forEach((entry, i) => {
    const raw = isObject(entry) ? entry.recipe : undefined;
    const result = validateRecipe(raw);
    if (!result.ok) {
      skipped.push(`${result.title ?? `Recipe ${i + 1}`}: ${result.errors[0]}`);
      return;
    }
    const e = entry as Record<string, unknown>;
    const lastCookedAt = parseDate(e.lastCookedAt);
    records.push({
      id: typeof e.id === 'string' && e.id ? e.id : `restored-${now}-${i}`,
      raw,
      importedAt: parseDate(e.importedAt) ?? now,
      ...(lastCookedAt ? { lastCookedAt } : {}),
      dedupeKey: dedupeKey(result.recipe),
    });
  });
  return { ok: true, records, skipped };
}

function parseDate(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : undefined;
}

export interface MergePlan {
  put: RecipeRecord[];
  added: number;
  updated: number;
  unchanged: number;
}

/**
 * Works out what restoring a backup changes, without losing anything: a recipe
 * already here (same id, or same source and identical JSON) is updated and keeps
 * the later "last cooked" date; anything else is added.
 */
export function planRestore(existing: RecipeRecord[], incoming: RecipeRecord[]): MergePlan {
  const plan: MergePlan = { put: [], added: 0, updated: 0, unchanged: 0 };
  const byId = new Map(existing.map((r) => [r.id, r]));
  const taken = new Set(existing.map((r) => r.id));

  for (const record of incoming) {
    const match =
      byId.get(record.id) ??
      existing.find((r) => r.dedupeKey === record.dedupeKey && sameJson(r.raw, record.raw));
    if (match) {
      const lastCookedAt = Math.max(match.lastCookedAt ?? 0, record.lastCookedAt ?? 0) || undefined;
      const rawChanged = !sameJson(match.raw, record.raw);
      if (!rawChanged && lastCookedAt === match.lastCookedAt) {
        plan.unchanged++;
        continue;
      }
      const { lastCookedAt: _old, ...base } = match;
      plan.put.push({
        ...base,
        raw: rawChanged ? record.raw : match.raw,
        dedupeKey: rawChanged ? record.dedupeKey : match.dedupeKey,
        ...(lastCookedAt ? { lastCookedAt } : {}),
      });
      plan.updated++;
      continue;
    }
    let id = record.id;
    while (taken.has(id)) id = `${record.id}-${Math.random().toString(36).slice(2, 8)}`;
    taken.add(id);
    plan.put.push({ ...record, id });
    plan.added++;
  }
  return plan;
}

export function sameJson(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
