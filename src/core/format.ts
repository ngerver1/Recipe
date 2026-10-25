/** Display formatting for quantities, durations and dates. No unit conversion beyond g→kg and ml→L for big amounts. */

const METRIC_UNITS = new Set(['g', 'kg', 'mg', 'ml', 'l', 'cl', 'dl', 'cm', 'mm', 'm', '°c']);

const FRACTIONS: [number, string][] = [
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [1 / 2, '½'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
];

function trimNumber(n: number, maxDecimals = 2): string {
  return String(Number(n.toFixed(maxDecimals)));
}

/** 1.5 → "1½" when close to a common fraction, else a trimmed decimal. */
function withFraction(n: number): string {
  const whole = Math.floor(n + 1e-9);
  const rest = n - whole;
  if (rest < 0.02) return String(whole);
  if (rest > 0.98) return String(whole + 1);
  for (const [value, glyph] of FRACTIONS) {
    if (Math.abs(rest - value) < 0.02) return whole ? `${whole}${glyph}` : glyph;
  }
  return trimNumber(n);
}

/**
 * Formats an amount: 0.5 tsp → "½ tsp", 1500 g → "1.5 kg", 2 (no unit) → "2".
 * Returns '' when there is no quantity.
 */
export function formatQuantity(quantity: number | null | undefined, unit: string | null | undefined): string {
  if (quantity === null || quantity === undefined || !Number.isFinite(quantity)) return '';
  let q = quantity;
  let u = unit?.trim() || '';
  const lower = u.toLowerCase();
  if (lower === 'g' && q >= 1000) {
    q /= 1000;
    u = 'kg';
  } else if (lower === 'ml' && q >= 1000) {
    q /= 1000;
    u = 'L';
  }
  const number = METRIC_UNITS.has(u.toLowerCase()) ? trimNumber(q) : withFraction(q);
  return u ? `${number} ${u}` : number;
}

/** "30 ml fish sauce", "3 anchovy fillets", or just the name when there's no quantity. */
export function formatAmount(name: string, quantity: number | null | undefined, unit: string | null | undefined): string {
  const amount = formatQuantity(quantity, unit);
  return amount ? `${amount} ${name}` : name;
}

/** 80 → "1 h 20 min", 40 → "40 min", 0.5 → "30 sec". */
export function formatMinutes(minutes: number): string {
  return formatSeconds(Math.round(minutes * 60));
}

/** 45 → "45 sec", 720 → "12 min", 5400 → "1 h 30 min", 90 → "1 min 30 sec". */
export function formatSeconds(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} sec`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} h`);
  if (m) parts.push(`${m} min`);
  if (sec && !h) parts.push(`${sec} sec`);
  return parts.join(' ');
}

/** A timer's length: "12 min", or "12–15 min" for a range. */
export function formatTimerLength(seconds: number, maxSeconds?: number): string {
  if (!maxSeconds || maxSeconds <= seconds) return formatSeconds(seconds);
  if (seconds % 60 === 0 && maxSeconds % 60 === 0 && maxSeconds < 3600) {
    return `${seconds / 60}–${maxSeconds / 60} min`;
  }
  if (seconds % 3600 === 0 && maxSeconds % 3600 === 0) {
    return `${seconds / 3600}–${maxSeconds / 3600} h`;
  }
  return `${formatSeconds(seconds)} – ${formatSeconds(maxSeconds)}`;
}

/** Countdown display: "05:30", or "1:05:30" past an hour. Rounds up so it reads 00:01 until the very end. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** "just now", "4 min ago", "1 h 5 min ago". */
export function formatAgo(ms: number): string {
  if (ms < 60_000) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  return `${formatSeconds(minutes * 60)} ago`;
}

/**
 * Reads what was typed into a timer: "12" or "12.5" (minutes), "12:30" (min:sec) or "1:30:00".
 * Returns seconds, or null if it can't be read or is zero.
 */
export function parseTimerInput(input: string): number | null {
  const text = input.trim().replace(',', '.');
  if (!text) return null;
  let seconds: number;
  if (text.includes(':')) {
    const parts = text.split(':').map((p) => (p === '' ? 0 : Number(p)));
    if (parts.length > 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
    seconds = parts.reduce((acc, p) => acc * 60 + p, 0);
  } else {
    const minutes = Number(text.replace(/\s*(m|min|mins|minutes)$/i, ''));
    if (!Number.isFinite(minutes) || minutes < 0) return null;
    seconds = minutes * 60;
  }
  seconds = Math.round(seconds);
  if (seconds <= 0 || seconds > 48 * 3600) return null;
  return seconds;
}

/** "Cooked today", "Cooked yesterday", "Cooked 3 Oct", "Cooked 3 Oct 2025". */
export function formatLastCooked(at: number | undefined, now: number): string {
  if (!at) return 'Not cooked yet';
  const day = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days === 0) return 'Cooked today';
  if (days === 1) return 'Cooked yesterday';
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  const date = new Date(at).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `Cooked ${date}`;
}
