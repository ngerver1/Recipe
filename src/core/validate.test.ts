import { describe, expect, it } from 'vitest';
import curry from '../../examples/green-curry.json';
import loaf from '../../examples/overnight-loaf.json';
import roast from '../../examples/sunday-roast.json';
import stew from '../../examples/pressure-cooker-beef-stew.json';
import { validateRecipe, type ValidationResult } from './validate';

const clone = <T>(v: T): T => structuredClone(v);

function ok(result: ValidationResult) {
  if (!result.ok) throw new Error(`Expected a valid recipe, got: ${result.errors.join('; ')}`);
  return result;
}

describe('validateRecipe: example recipes', () => {
  it.each([
    ['green-curry', curry],
    ['pressure-cooker-beef-stew', stew],
    ['sunday-roast', roast],
    ['overnight-loaf', loaf],
  ])('%s is valid with no warnings', (_name, recipe) => {
    const r = ok(validateRecipe(recipe));
    expect(r.warnings).toEqual([]);
    expect(r.recipe.steps.length).toBe(recipe.steps.length);
  });

  it('ignores unknown fields', () => {
    const r = ok(validateRecipe(loaf));
    expect(r.recipe).not.toHaveProperty('agentVersion');
    expect(r.recipe.steps[0]).not.toHaveProperty('image');
    expect(r.recipe.ingredients?.[0]).not.toHaveProperty('aisle');
  });

  it('does not modify the input', () => {
    const input = clone(curry);
    (input.steps[3]!.uses[1] as { ingredient: string }).ingredient = 'basl';
    const before = JSON.stringify(input);
    validateRecipe(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('validateRecipe: refusals', () => {
  it('refuses a newer format version with a clear message', () => {
    const r = validateRecipe({ ...clone(curry), version: 2 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0]).toMatch(/version 2, but this app only understands version 1/);
  });

  it('refuses a recipe with no title', () => {
    const { title: _t, ...rest } = clone(curry);
    const r = validateRecipe(rest);
    expect(!r.ok && r.errors).toEqual(['This recipe has no title.']);
  });

  it('refuses a recipe with no steps', () => {
    const r = validateRecipe({ ...clone(curry), steps: [] });
    expect(!r.ok && r.errors).toEqual(['This recipe has no steps.']);
    expect(!r.ok && r.title).toBe('Green chicken curry');
  });

  it('refuses a step without text, naming the step', () => {
    const input = clone(curry);
    (input.steps[3] as { text?: string }).text = '  ';
    const r = validateRecipe(input);
    expect(!r.ok && r.errors).toEqual(['Step s4 has no text.']);
  });

  it('refuses a different format', () => {
    const r = validateRecipe({ ...clone(curry), format: 'shopping-list' });
    expect(!r.ok && r.errors[0]).toMatch(/“shopping-list” file, not a Recipe Cards recipe/);
  });

  it('refuses something that is not an object', () => {
    expect(validateRecipe('hello').ok).toBe(false);
    expect(validateRecipe([curry]).ok).toBe(false);
  });
});

describe('validateRecipe: imports with warnings', () => {
  it('names a step that uses an unknown ingredient, and drops that chip', () => {
    const input = clone(curry);
    (input.steps[3]!.uses[1] as { ingredient: string }).ingredient = 'basl';
    const r = ok(validateRecipe(input));
    expect(r.warnings).toEqual(["Step s4 uses 'basl', which isn't in the ingredient list."]);
    expect(r.recipe.steps[3]!.uses).toEqual([{ ingredient: 'fish-sauce', quantity: 30, unit: 'ml' }]);
  });

  it('drops an invalid timer but keeps the step', () => {
    const input = clone(curry);
    (input.steps[0]!.timer as { seconds: unknown }).seconds = 0;
    const r = ok(validateRecipe(input));
    expect(r.recipe.steps[0]!.timer).toBeUndefined();
    expect(r.warnings).toEqual(['Step s1’s timer has no valid length, so it was left off.']);
  });

  it('rounds fractional or string timer seconds silently', () => {
    const input = clone(curry);
    (input.steps[0]!.timer as { seconds: unknown }).seconds = '900';
    (input.steps[2]!.timer as { seconds: unknown }).seconds = 720.4;
    const r = ok(validateRecipe(input));
    expect(r.recipe.steps[0]!.timer!.seconds).toBe(900);
    expect(r.recipe.steps[2]!.timer!.seconds).toBe(720);
    expect(r.warnings).toEqual([]);
  });

  it('drops a back-to-front timer range', () => {
    const input = clone(curry);
    input.steps[2]!.timer!.maxSeconds = 600;
    const r = ok(validateRecipe(input));
    expect(r.recipe.steps[2]!.timer).toEqual({ seconds: 720, label: 'Curry' });
    expect(r.warnings[0]).toMatch(/Step s3’s timer range is back to front/);
  });

  it('gives a missing timer label the step title', () => {
    const input = clone(curry);
    delete (input.steps[0]!.timer as { label?: string }).label;
    const r = ok(validateRecipe(input));
    expect(r.recipe.steps[0]!.timer!.label).toBe('Start the rice');
  });

  it('fills in a missing step title and id', () => {
    const input = clone(curry);
    delete (input.steps[1] as { title?: string }).title;
    delete (input.steps[2] as { id?: string }).id;
    const r = ok(validateRecipe(input));
    expect(r.recipe.steps[1]!.title).toBe('Heat 15 ml oil in');
    expect(r.recipe.steps[2]!.id).toBe('step-3');
    expect(r.warnings).toHaveLength(2);
  });

  it('renames duplicate step ids', () => {
    const input = clone(curry);
    input.steps[1]!.id = 's1';
    const r = ok(validateRecipe(input));
    expect(r.recipe.steps.map((s) => s.id)).toEqual(['s1', 's1-2', 's3', 's4']);
    expect(r.warnings[0]).toMatch(/Two steps have the id “s1”/);
  });

  it('turns a quantity written as text into a number, or null if it is not one', () => {
    const input = clone(curry);
    (input.ingredients[0] as { quantity: unknown }).quantity = '370';
    (input.ingredients[1] as { quantity: unknown }).quantity = 'two cups';
    const r = ok(validateRecipe(input));
    expect(r.recipe.ingredients![0]!.quantity).toBe(370);
    expect(r.recipe.ingredients![1]!.quantity).toBeNull();
    expect(r.warnings).toEqual(['Ingredient “water” has an amount that isn’t a number, so only its name is shown.']);
  });

  it('leaves out an ingredient with no name', () => {
    const input = clone(curry);
    delete (input.ingredients[7] as { name?: string }).name;
    const r = ok(validateRecipe(input));
    expect(r.recipe.ingredients).toHaveLength(7);
    expect(r.warnings).toContain('Ingredient “basil” has no name, so it was left out.');
    // and the step that used it now warns too
    expect(r.warnings).toContain("Step s4 uses 'basil', which isn't in the ingredient list.");
  });

  it('accepts a missing format and version with warnings', () => {
    const { format: _f, version: _v, ...rest } = clone(curry);
    const r = ok(validateRecipe(rest));
    expect(r.warnings).toHaveLength(2);
    expect(r.recipe.format).toBe('recipe-cards');
  });

  it('leaves out bad optional fields', () => {
    const input = { ...clone(curry), servings: 'lots', equipment: ['Wok', 42], times: { prepMinutes: 'ten' } };
    const r = ok(validateRecipe(input));
    expect(r.recipe.servings).toBeUndefined();
    expect(r.recipe.yield).toBe('Serves lots');
    expect(r.recipe.equipment).toEqual(['Wok']);
    expect(r.recipe.times).toEqual({});
    expect(r.warnings).toHaveLength(2);
  });

  it('copes with uses but no ingredient list', () => {
    const { ingredients: _i, ...rest } = clone(curry);
    const r = ok(validateRecipe(rest));
    expect(r.recipe.steps.every((s) => !s.uses)).toBe(true);
    expect(r.warnings).toHaveLength(1);
  });

  it('accepts the smallest possible recipe', () => {
    const r = ok(
      validateRecipe({ format: 'recipe-cards', version: 1, title: 'Toast', steps: [{ id: 's1', title: 'Toast it', text: 'Toast the bread.' }] }),
    );
    expect(r.warnings).toEqual([]);
  });
});
