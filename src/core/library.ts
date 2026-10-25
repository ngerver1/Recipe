import type { Recipe } from './schema';

/** A saved recipe: the imported JSON exactly as it arrived, plus the app's own fields. */
export interface RecipeRecord {
  id: string;
  /** The recipe JSON as imported, unchanged, so export round-trips. */
  raw: unknown;
  importedAt: number;
  lastCookedAt?: number;
  /** Used to spot the same recipe being imported twice. */
  dedupeKey: string;
}

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src)$/i;

/** Same recipe = same source URL (ignoring case, www., trailing slash, #hash and tracking codes), or same title when there's no URL. */
export function dedupeKey(recipe: Pick<Recipe, 'title' | 'source'>): string {
  const url = recipe.source?.url?.trim();
  if (url) {
    const normalised = normaliseUrl(url);
    if (normalised) return `url:${normalised}`;
  }
  return `title:${recipe.title.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

function normaliseUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const params = [...url.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAMS.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? `?${new URLSearchParams(params).toString()}` : '';
    const path = url.pathname.replace(/\/+$/, '');
    return `${host}${path}${query}`.toLowerCase();
  } catch {
    return raw.toLowerCase().replace(/\/+$/, '') || null;
  }
}

/** Lowercase with accents removed, for searching. */
export function normaliseText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Text searched for a recipe: title, site and ingredient names. */
export function searchText(recipe: Recipe): string {
  return normaliseText(
    [recipe.title, recipe.source?.site ?? '', ...(recipe.ingredients ?? []).map((i) => i.name)].join('\n'),
  );
}

/** Every word of the query must appear somewhere in the title, site or ingredient names. */
export function matchesSearch(recipe: Recipe, query: string): boolean {
  const words = normaliseText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = searchText(recipe);
  return words.every((w) => haystack.includes(w));
}

/** Newest first. */
export function sortByImported<T extends { record: RecipeRecord }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.record.importedAt - a.record.importedAt);
}
