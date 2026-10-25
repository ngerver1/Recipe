/**
 * Finds recipe JSON in whatever was pasted or opened: raw JSON, JSON inside a
 * ```json fence, a whole copied chat message containing a JSON object, or an
 * array of recipes. Returns the JSON values found; validation happens later.
 */

export type ExtractResult =
  | { ok: true; values: unknown[] }
  | { ok: false; error: string };

export function extractJson(input: string): ExtractResult {
  const text = input.replace(/^﻿/, '').trim();
  if (!text) return { ok: false, error: 'There was nothing to import. Copy the agent’s reply and try again.' };

  const whole = tryParse(text);
  if (whole.ok) return { ok: true, values: flatten(whole.value) };

  // Fenced code blocks, e.g. ```json ... ```
  const fenced: unknown[] = [];
  for (const match of text.matchAll(/```[^\n`]*\n([\s\S]*?)```/g)) {
    const parsed = tryParse(match[1] ?? '');
    if (parsed.ok) fenced.push(...flatten(parsed.value));
  }
  const fencedRecipes = fenced.filter(looksLikeRecipe);
  if (fencedRecipes.length) return { ok: true, values: fencedRecipes };

  // JSON objects or arrays embedded in surrounding text.
  const embedded = findEmbeddedJson(text).filter(looksLikeRecipe);
  if (embedded.length) return { ok: true, values: embedded };

  if (fenced.length) return { ok: true, values: fenced };

  return {
    ok: false,
    error: /[{[]/.test(text)
      ? 'I found something that looks like JSON, but it isn’t complete or has a typo. Copy the agent’s whole reply again and paste it here.'
      : 'I couldn’t find any recipe JSON in that text. Copy the agent’s whole reply and paste it here.',
  };
}

/** Rough check used to pick recipe objects out of a chat message. */
export function looksLikeRecipe(value: unknown): boolean {
  if (!isObject(value)) return false;
  return value.format === 'recipe-cards' || value.format === 'recipe-cards-backup' || ('steps' in value && 'title' in value);
}

function flatten(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    // Text copied through some apps turns straight quotes into curly ones.
    if (/[“”]/.test(text)) {
      try {
        return { ok: true, value: JSON.parse(text.replace(/[“”]/g, '"')) };
      } catch {
        return { ok: false };
      }
    }
    return { ok: false };
  }
}

/** Scans for balanced {...} or [...] runs (ignoring brackets inside strings) that parse as JSON. */
function findEmbeddedJson(text: string): unknown[] {
  const found: unknown[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{' || ch === '[') {
      const end = matchingBracket(text, i);
      if (end !== -1) {
        const parsed = tryParse(text.slice(i, end + 1));
        if (parsed.ok && (isObject(parsed.value) || Array.isArray(parsed.value))) {
          found.push(...flatten(parsed.value));
          i = end + 1;
          continue;
        }
      }
    }
    i++;
  }
  return found;
}

function matchingBracket(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  let quote = '';
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === '“') {
      inString = true;
      quote = ch === '"' ? '"' : '”';
    } else if (ch === '{' || ch === '[') {
      stack.push(ch === '{' ? '}' : ']');
    } else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
