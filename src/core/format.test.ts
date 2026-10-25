import { describe, expect, it } from 'vitest';
import {
  formatAgo,
  formatAmount,
  formatClock,
  formatLastCooked,
  formatMinutes,
  formatQuantity,
  formatSeconds,
  formatTimerLength,
  parseTimerInput,
} from './format';

describe('formatQuantity', () => {
  it.each([
    [0.5, 'tsp', '½ tsp'],
    [0.25, 'tsp', '¼ tsp'],
    [1.5, 'tbsp', '1½ tbsp'],
    [0.333, 'cup', '⅓ cup'],
    [0.125, 'tsp', '⅛ tsp'],
    [2, null, '2'],
    [0.5, null, '½'],
    [1500, 'g', '1.5 kg'],
    [1000, 'g', '1 kg'],
    [1250, 'g', '1.25 kg'],
    [999, 'g', '999 g'],
    [1.25, 'kg', '1.25 kg'],
    [2000, 'ml', '2 L'],
    [750, 'ml', '750 ml'],
    [0.5, 'kg', '0.5 kg'],
    [12.5, 'g', '12.5 g'],
    [1.7, 'tbsp', '1.7 tbsp'],
    [3, 'cloves', '3 cloves'],
  ])('%s %s → %s', (q, unit, expected) => {
    expect(formatQuantity(q, unit)).toBe(expected);
  });

  it('is empty when there is no quantity', () => {
    expect(formatQuantity(null, null)).toBe('');
    expect(formatQuantity(undefined, 'g')).toBe('');
  });
});

describe('formatAmount', () => {
  it('puts amount, unit and name together', () => {
    expect(formatAmount('fish sauce', 30, 'ml')).toBe('30 ml fish sauce');
    expect(formatAmount('anchovy fillets', 3, null)).toBe('3 anchovy fillets');
    expect(formatAmount('chicken', 1500, 'g')).toBe('1.5 kg chicken');
  });

  it('shows only the name when there is no quantity', () => {
    expect(formatAmount('Thai basil leaves', null, null)).toBe('Thai basil leaves');
  });
});

describe('durations', () => {
  it('formats minutes', () => {
    expect(formatMinutes(40)).toBe('40 min');
    expect(formatMinutes(80)).toBe('1 h 20 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(1020)).toBe('17 h');
  });

  it('formats seconds', () => {
    expect(formatSeconds(45)).toBe('45 sec');
    expect(formatSeconds(90)).toBe('1 min 30 sec');
    expect(formatSeconds(720)).toBe('12 min');
  });

  it('formats timer lengths and ranges', () => {
    expect(formatTimerLength(720)).toBe('12 min');
    expect(formatTimerLength(720, 900)).toBe('12–15 min');
    expect(formatTimerLength(43200, 64800)).toBe('12–18 h');
    expect(formatTimerLength(3600, 7200)).toBe('1–2 h');
    expect(formatTimerLength(4500, 5400)).toBe('1 h 15 min – 1 h 30 min');
    expect(formatTimerLength(720, 720)).toBe('12 min');
  });

  it('formats the countdown clock', () => {
    expect(formatClock(720_000)).toBe('12:00');
    expect(formatClock(65_000)).toBe('01:05');
    expect(formatClock(400)).toBe('00:01');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(-5)).toBe('00:00');
    expect(formatClock(3_930_000)).toBe('1:05:30');
  });

  it('says how long ago', () => {
    expect(formatAgo(20_000)).toBe('just now');
    expect(formatAgo(4 * 60_000 + 10_000)).toBe('4 min ago');
    expect(formatAgo(65 * 60_000)).toBe('1 h 5 min ago');
  });
});

describe('parseTimerInput', () => {
  it.each([
    ['12', 720],
    ['12.5', 750],
    ['12,5', 750],
    ['12:30', 750],
    ['1:30:00', 5400],
    ['5 min', 300],
    [' 3 ', 180],
  ])('%s → %s seconds', (input, seconds) => {
    expect(parseTimerInput(input)).toBe(seconds);
  });

  it.each(['', '0', 'abc', '-3', '1:2:3:4'])('rejects %j', (input) => {
    expect(parseTimerInput(input)).toBeNull();
  });
});

describe('formatLastCooked', () => {
  const now = new Date(2026, 9, 25, 18, 0).getTime();
  it('reads naturally', () => {
    expect(formatLastCooked(undefined, now)).toBe('Not cooked yet');
    expect(formatLastCooked(new Date(2026, 9, 25, 8, 0).getTime(), now)).toBe('Cooked today');
    expect(formatLastCooked(new Date(2026, 9, 24, 22, 0).getTime(), now)).toBe('Cooked yesterday');
    expect(formatLastCooked(new Date(2026, 9, 3).getTime(), now)).toBe('Cooked 3 Oct');
    expect(formatLastCooked(new Date(2025, 9, 3).getTime(), now)).toBe('Cooked 3 Oct 2025');
  });
});
