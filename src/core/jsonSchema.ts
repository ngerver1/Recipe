import * as z from 'zod';
import { RecipeSchema } from './schema';

/** The published JSON Schema for format version 1, generated from the zod schema. */
export function recipeJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(RecipeSchema, { io: 'input', target: 'draft-2020-12' });
  return {
    $schema: generated.$schema,
    $id: 'https://ngerver1.github.io/Recipe/recipe-cards.v1.schema.json',
    title: 'Recipe Cards, format version 1',
    ...withoutKey(generated, '$schema'),
  };
}

function withoutKey(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}
