import * as z from 'zod';

/**
 * The Recipe Cards import format, version 1.
 *
 * This is the contract between the `recipe-cards` agent and the app. It drives
 * validation (see validate.ts), the TypeScript types below, and the published
 * JSON Schema in public/recipe-cards.v1.schema.json (see jsonSchema.ts).
 * Unknown fields are allowed and ignored.
 */

export const FORMAT = 'recipe-cards';
export const SUPPORTED_VERSION = 1;

const text = z.string().trim().min(1);

export const SourceSchema = z
  .object({
    url: z.string().optional().describe('Link to the original recipe.'),
    site: z.string().optional().describe('Name of the site or book, e.g. "Serious Eats".'),
    author: z.string().optional(),
  })
  .describe('Where the recipe came from.');

export const TimesSchema = z
  .object({
    prepMinutes: z.number().nonnegative().optional(),
    cookMinutes: z.number().nonnegative().optional(),
    totalMinutes: z.number().nonnegative().optional(),
  })
  .describe('Times in minutes.');

export const IngredientSchema = z
  .object({
    id: text.describe('Unique within the recipe, kebab-case, e.g. "fish-sauce". Steps refer to it in `uses`.'),
    name: text.describe('What to show, e.g. "fish sauce".'),
    quantity: z
      .number()
      .nonnegative()
      .nullable()
      .optional()
      .describe('Total amount, already metric. Null when there is no amount ("to taste", "a handful").'),
    unit: z
      .string()
      .nullable()
      .optional()
      .describe('e.g. "g", "ml", "tsp". Null for plain counts like 2 eggs.'),
    original: z.string().optional().describe("The source's wording before conversion, e.g. \"2 tbsp\"."),
    note: z.string().optional().describe('Preparation or extra detail, e.g. "finely chopped".'),
    group: z.string().optional().describe('Heading to list it under, e.g. "Sauce".'),
  })
  .describe('One ingredient with its total amount.');

export const UseSchema = z
  .object({
    ingredient: text.describe('An ingredient id.'),
    quantity: z.number().nonnegative().nullable().optional(),
    unit: z.string().nullable().optional(),
  })
  .describe('What a step needs. The quantity can be part of the ingredient total.');

export const TimerSchema = z
  .object({
    seconds: z
      .number()
      .int()
      .positive()
      .describe('Whole number above 0. For a range, the lower end.'),
    maxSeconds: z.number().int().positive().optional().describe('The upper end of a range.'),
    label: text.describe('Short name shown in the timer tray, e.g. "Rice".'),
    background: z
      .boolean()
      .optional()
      .describe('True when the cook can carry on with the next steps while it runs.'),
  })
  .describe('A timer the cook can start from this step.');

export const StepSchema = z
  .object({
    id: text.describe('Unique within the recipe, e.g. "s1".'),
    section: z.string().optional().describe('Heading for a group of steps, e.g. "Curry".'),
    title: text.describe('2 to 5 words.'),
    text: text.describe('What to do, with quantities written inline.'),
    uses: z.array(UseSchema).optional(),
    timer: TimerSchema.optional(),
    cue: z.string().optional().describe("How to tell it's done."),
    tip: z.string().optional().describe('A short helpful note.'),
  })
  .describe('One card in cook mode.');

export const RecipeSchema = z
  .object({
    format: z.literal(FORMAT),
    version: z.literal(SUPPORTED_VERSION),
    title: text,
    source: SourceSchema.optional(),
    servings: z.number().positive().optional(),
    yield: z.string().optional().describe('Text, e.g. "1 loaf".'),
    times: TimesSchema.optional(),
    equipment: z.array(z.string()).optional(),
    notes: z.string().optional(),
    ingredients: z.array(IngredientSchema).optional(),
    steps: z.array(StepSchema).min(1),
  })
  .describe('A recipe converted into step cards for the Recipe Cards cook-mode app.');

export type Recipe = z.infer<typeof RecipeSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Ingredient = z.infer<typeof IngredientSchema>;
export type Use = z.infer<typeof UseSchema>;
export type StepTimer = z.infer<typeof TimerSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Times = z.infer<typeof TimesSchema>;
