import type * as z from 'zod';
import { FORMAT, RecipeSchema, SUPPORTED_VERSION, type Recipe } from './schema';
import { isObject } from './parse';

export type ValidationResult =
  | { ok: true; recipe: Recipe; warnings: string[] }
  | { ok: false; errors: string[]; title?: string };

type Json = Record<string, unknown>;

/**
 * Checks one recipe against the format. Refuses only when the recipe is
 * unusable (no title, no steps, a step without text, or a newer format
 * version). Anything else is repaired, with a plain-English warning, so the
 * recipe can still be cooked. The input is never modified.
 */
export function validateRecipe(input: unknown): ValidationResult {
  if (!isObject(input)) {
    return { ok: false, errors: ['This isn’t a recipe. Expected a JSON object with a title and steps.'] };
  }
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const fail = (errors: string[]): ValidationResult => ({ ok: false, errors, ...(title ? { title } : {}) });
  const warnings: string[] = [];

  if (input.format === undefined) {
    warnings.push('It doesn’t say "format": "recipe-cards", but it was read as a Recipe Cards recipe anyway.');
  } else if (input.format !== FORMAT) {
    return fail([`This is a “${String(input.format)}” file, not a Recipe Cards recipe.`]);
  }

  if (typeof input.version === 'number' && input.version > SUPPORTED_VERSION) {
    return fail([
      `This recipe uses format version ${input.version}, but this app only understands version ${SUPPORTED_VERSION}. ` +
        'Update the app (open it while online and reload), then import again.',
    ]);
  }
  if (input.version === undefined) {
    warnings.push('It doesn’t give a format version, so version 1 was assumed.');
  } else if (input.version !== SUPPORTED_VERSION) {
    warnings.push(`Its format version (${JSON.stringify(input.version)}) isn’t valid, so version 1 was assumed.`);
  }

  const errors: string[] = [];
  if (!title) errors.push('This recipe has no title.');
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    errors.push('This recipe has no steps.');
  } else {
    input.steps.forEach((step, i) => {
      if (!isObject(step)) errors.push(`Step ${i + 1} isn’t a valid step.`);
      else if (typeof step.text !== 'string' || !step.text.trim()) errors.push(`${stepLabel(step, i)} has no text.`);
    });
  }
  if (errors.length) return fail(errors);

  const work = structuredClone(input) as Json;
  work.format = FORMAT;
  work.version = SUPPORTED_VERSION;

  // Let the schema find each problem in turn, and repair it.
  for (let attempt = 0; attempt < 1000; attempt++) {
    const result = RecipeSchema.safeParse(work);
    if (result.success) {
      warnings.push(...crossCheck(result.data));
      return { ok: true, recipe: result.data, warnings };
    }
    const issue = result.error.issues[0]!;
    const message = repair(work, issue);
    if (message === null) {
      return fail([`Part of this recipe couldn’t be read (${issue.path.join('.') || 'recipe'}: ${issue.message}).`]);
    }
    if (message) warnings.push(message);
  }
  return fail(['This recipe has too many problems to import.']);
}

function stepLabel(step: unknown, index: number): string {
  const id = isObject(step) && typeof step.id === 'string' && step.id.trim() ? step.id.trim() : String(index + 1);
  return `Step ${id}`;
}

function ingredientLabel(ingredient: unknown, index: number): string {
  if (isObject(ingredient)) {
    if (typeof ingredient.name === 'string' && ingredient.name.trim()) return `Ingredient “${ingredient.name.trim()}”`;
    if (typeof ingredient.id === 'string' && ingredient.id.trim()) return `Ingredient “${ingredient.id.trim()}”`;
  }
  return `Ingredient ${index + 1}`;
}

/** A number, or a string holding one ("4"), as a number; otherwise undefined. */
function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

const FIELD_NAMES: Record<string, string> = {
  section: 'section',
  cue: '“Done when” note',
  tip: 'tip',
  original: 'original wording',
  note: 'note',
  group: 'group',
  url: 'link',
  site: 'site name',
  author: 'author',
  prepMinutes: 'prep time',
  cookMinutes: 'cook time',
  totalMinutes: 'total time',
  servings: 'servings',
  yield: 'yield',
  notes: 'notes',
};

/**
 * Fixes the part of `work` that `issue` points at. Returns a warning to show,
 * '' for a silent fix, or null when it can't be fixed.
 */
function repair(work: Json, issue: z.core.$ZodIssue): string | null {
  const path = issue.path;
  const top = path[0];
  switch (top) {
    case 'steps':
      return repairStep(work, path);
    case 'ingredients':
      return repairIngredient(work, path);
    case 'equipment': {
      const value = work.equipment;
      if (path.length === 1) {
        if (typeof value === 'string' && value.trim()) {
          work.equipment = [value];
          return '';
        }
        delete work.equipment;
        return 'The equipment list isn’t valid, so it was left out.';
      }
      (value as unknown[]).splice(path[1] as number, 1);
      return 'An item in the equipment list isn’t text, so it was left out.';
    }
    case 'source':
    case 'times': {
      const value = work[top];
      if (path.length === 1) {
        if (top === 'source' && typeof value === 'string' && /^https?:\/\//.test(value.trim())) {
          work.source = { url: value.trim() };
          return '';
        }
        delete work[top];
        return top === 'source' ? 'The source details aren’t valid, so they were left out.' : 'The times aren’t valid, so they were left out.';
      }
      const obj = value as Json;
      const key = String(path[1]);
      const n = top === 'times' ? asNumber(obj[key]) : undefined;
      if (n !== undefined && n >= 0) {
        obj[key] = n;
        return '';
      }
      delete obj[key];
      return `The recipe’s ${FIELD_NAMES[key] ?? key} isn’t valid, so it was left out.`;
    }
    case 'servings': {
      const n = asNumber(work.servings);
      if (n !== undefined && n > 0) {
        work.servings = n;
        return '';
      }
      if (typeof work.servings === 'string' && work.servings.trim() && work.yield === undefined) {
        work.yield = `Serves ${work.servings.trim()}`;
        delete work.servings;
        return '';
      }
      delete work.servings;
      return 'The number of servings isn’t valid, so it was left out.';
    }
    case 'yield':
      if (typeof work.yield === 'number') {
        work.yield = String(work.yield);
        return '';
      }
      delete work.yield;
      return 'The yield isn’t text, so it was left out.';
    case 'notes':
      if (Array.isArray(work.notes) && work.notes.every((n) => typeof n === 'string')) {
        work.notes = work.notes.join('\n');
        return '';
      }
      delete work.notes;
      return 'The notes aren’t text, so they were left out.';
    default:
      return null;
  }
}

function repairStep(work: Json, path: PropertyKey[]): string | null {
  const steps = work.steps as Json[];
  const i = path[1] as number;
  const step = steps[i];
  if (!step) return null;
  const label = stepLabel(step, i);
  const field = path[2];

  switch (field) {
    case 'id': {
      step.id = uniqueId(`step-${i + 1}`, steps.map((s) => s.id));
      return `Step ${i + 1} had no id, so one was added.`;
    }
    case 'title': {
      step.title = titleFromText(step.text as string);
      return `${label} has no title, so the start of its text is used instead.`;
    }
    case 'section':
    case 'cue':
    case 'tip':
      delete step[field];
      return `${label}’s ${FIELD_NAMES[field]} isn’t text, so it was left out.`;
    case 'uses': {
      if (path.length === 3) {
        delete step.uses;
        return `${label}’s “You’ll need” list isn’t valid, so it was left out.`;
      }
      const uses = step.uses as unknown[];
      const j = path[3] as number;
      const use = uses[j];
      const sub = path[4];
      if (isObject(use) && (sub === 'quantity' || sub === 'unit')) {
        const n = sub === 'quantity' ? asNumber(use.quantity) : undefined;
        use[sub] = n !== undefined && n >= 0 ? n : null;
        return n !== undefined && n >= 0 ? '' : `${label} has an amount that isn’t valid, so only the ingredient name is shown.`;
      }
      uses.splice(j, 1);
      return `${label} has an item in its “You’ll need” list without an ingredient, so it was left out.`;
    }
    case 'timer': {
      const timer = step.timer;
      if (path.length === 3 || !isObject(timer)) {
        delete step.timer;
        return `${label}’s timer isn’t valid, so it was left off.`;
      }
      const sub = path[3];
      if (sub === 'seconds' || sub === 'maxSeconds') {
        const n = asNumber(timer[sub]);
        if (n !== undefined && n >= 0.5) {
          timer[sub] = Math.round(n);
          return '';
        }
        if (sub === 'seconds') {
          delete step.timer;
          return `${label}’s timer has no valid length, so it was left off.`;
        }
        delete timer.maxSeconds;
        return `${label}’s timer range isn’t valid, so only the shorter time is used.`;
      }
      if (sub === 'label') {
        const fallback = typeof step.title === 'string' && step.title.trim() ? step.title.trim() : 'Timer';
        timer.label = fallback;
        return `${label}’s timer has no label, so it’s called “${fallback}”.`;
      }
      if (sub === 'background') {
        if (timer.background === 'true' || timer.background === 'false') {
          timer.background = timer.background === 'true';
          return '';
        }
        delete timer.background;
        return '';
      }
      return null;
    }
    default:
      return null;
  }
}

function repairIngredient(work: Json, path: PropertyKey[]): string | null {
  if (path.length === 1) {
    delete work.ingredients;
    return 'The ingredient list isn’t valid, so it was left out.';
  }
  const list = work.ingredients as unknown[];
  const j = path[1] as number;
  const ingredient = list[j];
  const label = ingredientLabel(ingredient, j);
  const field = path[2];
  if (!isObject(ingredient) || path.length === 2) {
    list.splice(j, 1);
    return `${label} isn’t valid, so it was left out.`;
  }
  switch (field) {
    case 'name':
      list.splice(j, 1);
      return `${label} has no name, so it was left out.`;
    case 'id': {
      if (typeof ingredient.name !== 'string' || !ingredient.name.trim()) {
        list.splice(j, 1);
        return `${label} has no name, so it was left out.`;
      }
      ingredient.id = uniqueId(kebab(ingredient.name) || `ingredient-${j + 1}`, list.map((x) => (isObject(x) ? x.id : undefined)));
      return `${label} had no id, so one was added.`;
    }
    case 'quantity': {
      const n = asNumber(ingredient.quantity);
      ingredient.quantity = n !== undefined && n >= 0 ? n : null;
      return n !== undefined && n >= 0 ? '' : `${label} has an amount that isn’t a number, so only its name is shown.`;
    }
    case 'unit':
      ingredient.unit = null;
      return `${label} has a unit that isn’t text, so it was left out.`;
    case 'original':
    case 'note':
    case 'group':
      delete ingredient[field];
      return `${label}’s ${FIELD_NAMES[field]} isn’t text, so it was left out.`;
    default:
      return null;
  }
}

/** Checks that need the whole recipe: unique ids, `uses` pointing at real ingredients, timer ranges. */
function crossCheck(recipe: Recipe): string[] {
  const warnings: string[] = [];

  const stepIds = new Set<string>();
  for (const step of recipe.steps) {
    if (stepIds.has(step.id)) {
      const renamed = uniqueId(step.id, [...stepIds]);
      warnings.push(`Two steps have the id “${step.id}”, so the second is now “${renamed}”.`);
      step.id = renamed;
    }
    stepIds.add(step.id);
    for (const key of ['section', 'cue', 'tip'] as const) {
      if (step[key] !== undefined && !step[key].trim()) delete step[key];
    }
  }

  const ingredientIds = new Set<string>();
  for (const ingredient of recipe.ingredients ?? []) {
    if (ingredientIds.has(ingredient.id)) {
      const renamed = uniqueId(ingredient.id, [...ingredientIds]);
      warnings.push(`Two ingredients have the id “${ingredient.id}”. Steps that use it will show the first one.`);
      ingredient.id = renamed;
    }
    ingredientIds.add(ingredient.id);
  }

  const anyUses = recipe.steps.some((s) => s.uses?.length);
  if (anyUses && !recipe.ingredients?.length) {
    warnings.push('The steps list what they use, but there’s no ingredient list, so the “You’ll need” chips are left out.');
    for (const step of recipe.steps) delete step.uses;
  } else {
    for (const step of recipe.steps) {
      if (!step.uses) continue;
      step.uses = step.uses.filter((use) => {
        if (ingredientIds.has(use.ingredient)) return true;
        warnings.push(`Step ${step.id} uses '${use.ingredient}', which isn't in the ingredient list.`);
        return false;
      });
    }
  }

  for (const step of recipe.steps) {
    const timer = step.timer;
    if (timer?.maxSeconds !== undefined && timer.maxSeconds <= timer.seconds) {
      if (timer.maxSeconds < timer.seconds) {
        warnings.push(`Step ${step.id}’s timer range is back to front, so only the shorter time is used.`);
      }
      delete timer.maxSeconds;
    }
  }

  if (recipe.notes !== undefined && !recipe.notes.trim()) delete recipe.notes;
  return warnings;
}

function uniqueId(base: string, taken: unknown[]): string {
  const used = new Set(taken.filter((t): t is string => typeof t === 'string'));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function kebab(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleFromText(text: string): string {
  const words = text.trim().split(/\s+/).slice(0, 5).join(' ');
  return words.replace(/[.,;:!?]+$/, '');
}
