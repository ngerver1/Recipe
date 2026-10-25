import { describe, expect, it } from 'vitest';
import curry from '../../examples/green-curry.json';
import loaf from '../../examples/overnight-loaf.json';
import roast from '../../examples/sunday-roast.json';
import stew from '../../examples/pressure-cooker-beef-stew.json';
import { buildBackup, planRestore, readBackup } from './backup';
import { recipeJsonSchema } from './jsonSchema';
import { dedupeKey, matchesSearch, type RecipeRecord } from './library';
import { validateRecipe } from './validate';
import publishedSchema from '../../public/recipe-cards.v1.schema.json';

const recipe = (raw: unknown) => {
  const r = validateRecipe(raw);
  if (!r.ok) throw new Error('invalid');
  return r.recipe;
};

describe('dedupeKey', () => {
  it('matches the same URL despite case, www, trailing slash, hash and tracking codes', () => {
    const a = dedupeKey({ title: 'A', source: { url: 'https://www.SeriousEats.com/pressure-cooker-beef-stew-recipe/' } });
    const b = dedupeKey({ title: 'B', source: { url: 'https://seriouseats.com/pressure-cooker-beef-stew-recipe?utm_source=x#comments' } });
    expect(a).toBe(b);
  });

  it('uses the title when there is no URL', () => {
    expect(dedupeKey(recipe(loaf))).toBe('title:overnight no-knead loaf');
    expect(dedupeKey({ title: '  Overnight  No-Knead Loaf ' })).toBe('title:overnight no-knead loaf');
  });
});

describe('search', () => {
  it('searches titles, sites and ingredient names, ignoring case and accents', () => {
    const s = recipe(stew);
    expect(matchesSearch(s, 'beef')).toBe(true);
    expect(matchesSearch(s, 'serious')).toBe(true);
    expect(matchesSearch(s, 'GELATINE')).toBe(true);
    expect(matchesSearch(s, 'peas stew')).toBe(true);
    expect(matchesSearch(s, 'curry')).toBe(false);
    expect(matchesSearch(recipe(curry), 'thai basil')).toBe(true);
    expect(matchesSearch(s, '')).toBe(true);
  });
});

describe('backup', () => {
  const records: RecipeRecord[] = [curry, stew].map((raw, i) => ({
    id: `id-${i}`,
    raw,
    importedAt: 1_700_000_000_000 + i,
    ...(i === 1 ? { lastCookedAt: 1_700_000_500_000 } : {}),
    dedupeKey: dedupeKey(recipe(raw)),
  }));

  it('round-trips recipes unchanged', () => {
    const file = JSON.parse(JSON.stringify(buildBackup(records, 1_800_000_000_000)));
    const back = readBackup(file, 0);
    expect(back.ok && back.records).toEqual(records);
  });

  it('restores without duplicating or losing anything', () => {
    const fromOtherDevice: RecipeRecord[] = [
      { ...records[1]!, id: 'other-id', lastCookedAt: 1_700_000_900_000 }, // same stew, cooked later
      { id: 'roast', raw: roast, importedAt: 5, dedupeKey: dedupeKey(recipe(roast)) },
    ];
    const plan = planRestore(records, fromOtherDevice);
    expect(plan).toMatchObject({ added: 1, updated: 1, unchanged: 0 });
    expect(plan.put.find((r) => r.id === 'id-1')?.lastCookedAt).toBe(1_700_000_900_000);
    expect(planRestore(records, records)).toMatchObject({ added: 0, updated: 0, unchanged: 2, put: [] });
  });

  it('refuses things that are not backups', () => {
    expect(readBackup(curry, 0).ok).toBe(false);
    expect(readBackup({ format: 'recipe-cards-backup', version: 9, recipes: [] }, 0).ok).toBe(false);
  });
});

describe('published JSON Schema', () => {
  it('matches the zod schema (run `npm run schema` after changing it)', () => {
    expect(publishedSchema).toEqual(JSON.parse(JSON.stringify(recipeJsonSchema())));
  });
});
