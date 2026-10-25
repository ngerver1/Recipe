import { describe, expect, it } from 'vitest';
import curry from '../../examples/green-curry.json';
import roast from '../../examples/sunday-roast.json';
import { extractJson } from './parse';
import { readImport } from './importer';

const curryText = JSON.stringify(curry, null, 2);

describe('extractJson: forgiving paste', () => {
  it('reads raw JSON', () => {
    const r = extractJson(curryText);
    expect(r.ok && r.values).toEqual([curry]);
  });

  it('reads JSON inside a ```json fence', () => {
    const r = extractJson('```json\n' + curryText + '\n```');
    expect(r.ok && r.values).toEqual([curry]);
  });

  it('reads a whole copied chat message with prose around a fenced block', () => {
    const message = `Here's your recipe as cards:\n\n\`\`\`json\n${curryText}\n\`\`\`\n\nCopy it, then in the app tap Import → Paste. I converted cups to grams {roughly}.`;
    const r = extractJson(message);
    expect(r.ok && r.values).toEqual([curry]);
  });

  it('reads a chat message with a bare JSON object and braces in the prose', () => {
    const message = `Sure! Note the {curly} bits.\n${JSON.stringify(curry)}\nEnjoy [and good luck].`;
    const r = extractJson(message);
    expect(r.ok && r.values).toEqual([curry]);
  });

  it('copes with brackets inside JSON strings', () => {
    const tricky = { ...curry, notes: 'Use a {big} pan [or two] and "quotes".' };
    const r = extractJson(`Text before ${JSON.stringify(tricky)} text after`);
    expect(r.ok && r.values).toEqual([tricky]);
  });

  it('reads an array of recipes', () => {
    const r = extractJson(JSON.stringify([curry, roast]));
    expect(r.ok && r.values).toEqual([curry, roast]);
  });

  it('reads several fenced recipes in one message', () => {
    const message = `One:\n\`\`\`json\n${JSON.stringify(curry)}\n\`\`\`\nTwo:\n\`\`\`\n${JSON.stringify(roast)}\n\`\`\``;
    const r = extractJson(message);
    expect(r.ok && r.values).toEqual([curry, roast]);
  });

  it('strips a byte-order mark and whitespace', () => {
    const r = extractJson('﻿\n  ' + curryText + '  \n');
    expect(r.ok && r.values).toEqual([curry]);
  });

  it('fixes curly quotes from a notes app', () => {
    const curly = '{“format”: “recipe-cards”, “version”: 1, “title”: “Toast”, “steps”: [{“id”: “s1”, “title”: “Toast it”, “text”: “Toast the bread.”}]}';
    const r = extractJson(curly);
    expect(r.ok && (r.values[0] as { title: string }).title).toBe('Toast');
  });

  it('explains when there is no JSON at all', () => {
    const r = extractJson('Here is a recipe for you, enjoy!');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/couldn’t find any recipe JSON/);
  });

  it('explains when the JSON is cut off', () => {
    const r = extractJson(curryText.slice(0, 300));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/isn’t complete/);
  });

  it('explains when nothing was pasted', () => {
    expect(extractJson('   ').ok).toBe(false);
  });
});

describe('readImport', () => {
  it('validates each recipe found', () => {
    const broken = { format: 'recipe-cards', version: 1, steps: [] };
    const r = readImport(JSON.stringify([curry, broken]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates[0]).toMatchObject({ kind: 'recipe', ok: true, dedupeKey: 'url:example.com/green-curry' });
    expect(r.candidates[1]).toMatchObject({ kind: 'recipe', ok: false });
  });

  it('keeps the raw JSON unchanged', () => {
    const r = readImport(curryText);
    expect(r.ok && r.candidates[0]?.kind === 'recipe' && r.candidates[0].ok && r.candidates[0].raw).toEqual(curry);
  });

  it('recognises a backup file', () => {
    const backup = { format: 'recipe-cards-backup', version: 1, exportedAt: '2026-10-25T00:00:00Z', recipes: [{ recipe: curry }] };
    const r = readImport(JSON.stringify(backup));
    expect(r.ok && r.candidates[0]).toMatchObject({ kind: 'backup', count: 1 });
  });
});
