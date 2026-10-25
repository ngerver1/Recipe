import { writeFileSync } from 'node:fs';
import { recipeJsonSchema } from '../src/core/jsonSchema';

const out = new URL('../public/recipe-cards.v1.schema.json', import.meta.url);
writeFileSync(out, JSON.stringify(recipeJsonSchema(), null, 2) + '\n');
console.log('Wrote public/recipe-cards.v1.schema.json');
