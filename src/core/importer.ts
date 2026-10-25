import { isBackup } from './backup';
import { dedupeKey } from './library';
import { extractJson } from './parse';
import type { Recipe } from './schema';
import { validateRecipe } from './validate';

export type ImportCandidate =
  | { kind: 'recipe'; ok: true; raw: unknown; recipe: Recipe; warnings: string[]; dedupeKey: string }
  | { kind: 'recipe'; ok: false; errors: string[]; title?: string }
  | { kind: 'backup'; raw: unknown; count: number };

export type ImportReadResult = { ok: true; candidates: ImportCandidate[] } | { ok: false; error: string };

/** Pasted text or file contents → the recipes in it, each validated. */
export function readImport(text: string): ImportReadResult {
  const extracted = extractJson(text);
  if (!extracted.ok) return extracted;
  const candidates = extracted.values.map((value): ImportCandidate => {
    if (isBackup(value)) {
      const recipes = (value as { recipes?: unknown }).recipes;
      return { kind: 'backup', raw: value, count: Array.isArray(recipes) ? recipes.length : 0 };
    }
    const result = validateRecipe(value);
    if (!result.ok) return { kind: 'recipe', ...result };
    return { kind: 'recipe', ...result, raw: value, dedupeKey: dedupeKey(result.recipe) };
  });
  if (!candidates.length) return { ok: false, error: 'That was an empty list, with no recipes in it.' };
  return { ok: true, candidates };
}
