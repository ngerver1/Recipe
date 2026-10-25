import type { Ingredient, Recipe, Use } from './schema';
import { formatAmount } from './format';

/** Helpers for showing a validated recipe. */

export function timerCount(recipe: Recipe): number {
  return recipe.steps.filter((s) => s.timer).length;
}

export function totalMinutes(recipe: Recipe): number | undefined {
  const t = recipe.times;
  if (!t) return undefined;
  if (t.totalMinutes) return t.totalMinutes;
  const sum = (t.prepMinutes ?? 0) + (t.cookMinutes ?? 0);
  return sum || undefined;
}

export function ingredientMap(recipe: Recipe): Map<string, Ingredient> {
  return new Map((recipe.ingredients ?? []).map((i) => [i.id, i]));
}

/** Ingredients under their group headings, in the order the groups first appear. Ungrouped ones come under ''. */
export function groupIngredients(ingredients: Ingredient[]): { group: string; items: Ingredient[] }[] {
  const groups: { group: string; items: Ingredient[] }[] = [];
  for (const ingredient of ingredients) {
    const name = ingredient.group?.trim() ?? '';
    let entry = groups.find((g) => g.group === name);
    if (!entry) {
      entry = { group: name, items: [] };
      groups.push(entry);
    }
    entry.items.push(ingredient);
  }
  return groups;
}

/** A "You'll need" chip: "30 ml fish sauce". */
export function useLabel(use: Use, ingredients: Map<string, Ingredient>): string {
  const ingredient = ingredients.get(use.ingredient);
  return formatAmount(ingredient?.name ?? use.ingredient, use.quantity, use.unit);
}

/** An ingredient-list line without the note: "1.25 kg boneless beef chuck roast". */
export function ingredientLabel(ingredient: Ingredient): string {
  return formatAmount(ingredient.name, ingredient.quantity, ingredient.unit);
}

/** "Serves 6", "Makes 1 loaf". */
export function servingsLabel(recipe: Recipe): string | undefined {
  if (recipe.servings) return `Serves ${recipe.servings}`;
  if (recipe.yield) return /^(makes|serves)\b/i.test(recipe.yield) ? recipe.yield : `Makes ${recipe.yield}`;
  return undefined;
}
