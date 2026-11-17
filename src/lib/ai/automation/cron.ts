/**
 * Minimal 5-field cron evaluator: `minute hour day-of-month month day-of-week`.
 *
 * Supports `*`, single numbers, lists (`1,15`), ranges (`1-5`) and steps
 * (`*\/15`). That covers the schedules this app needs (daily briefs, sweeps)
 * without pulling in a dependency.
 *
 * Day-of-month and day-of-week follow standard cron semantics: when both are
 * restricted, a match on either one is enough.
 */

const RANGES: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week (0 = Sunday)
];

function parseField(field: string, min: number, max: number): Set<number> | null {
  const trimmed = field.trim();
  if (!trimmed) return null;

  const values = new Set<number>();

  for (const part of trimmed.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number.parseInt(stepPart, 10);
    if (!Number.isInteger(step) || step <= 0) return null;

    let start: number;
    let end: number;

    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      start = Number.parseInt(a, 10);
      end = Number.parseInt(b, 10);
    } else {
      start = Number.parseInt(rangePart, 10);
      // `5/15` means "from 5 to the end, every 15".
      end = stepPart === undefined ? start : max;
    }

    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < min || end > max || start > end) return null;

    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }

  return values.size > 0 ? values : null;
}

export interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

export function parseCron(expression: string): ParsedCron | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const parsed: Array<Set<number> | null> = fields.map((field, index) =>
    parseField(field, RANGES[index][0], RANGES[index][1])
  );

  if (parsed.some((value) => value === null)) return null;

  return {
    minutes: parsed[0]!,
    hours: parsed[1]!,
    daysOfMonth: parsed[2]!,
    months: parsed[3]!,
    daysOfWeek: parsed[4]!,
    domRestricted: fields[2].trim() !== "*",
    dowRestricted: fields[4].trim() !== "*",
  };
}

export function cronMatches(parsed: ParsedCron, date: Date): boolean {
  if (!parsed.minutes.has(date.getMinutes())) return false;
  if (!parsed.hours.has(date.getHours())) return false;
  if (!parsed.months.has(date.getMonth() + 1)) return false;

  const domMatch = parsed.daysOfMonth.has(date.getDate());
  const dowMatch = parsed.daysOfWeek.has(date.getDay());

  if (parsed.domRestricted && parsed.dowRestricted) return domMatch || dowMatch;
  if (parsed.domRestricted) return domMatch;
  if (parsed.dowRestricted) return dowMatch;
  return true;
}

/**
 * Next time the expression fires, strictly after `from`.
 * Returns null for an unparseable expression or nothing within a year.
 */
export function nextCronRun(expression: string, from: Date = new Date()): Date | null {
  const parsed = parseCron(expression);
  if (!parsed) return null;

  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const limit = from.getTime() + 366 * 24 * 60 * 60 * 1000;

  while (cursor.getTime() <= limit) {
    if (cronMatches(parsed, cursor)) return new Date(cursor.getTime());
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return null;
}

export function isValidCron(expression: string): boolean {
  return parseCron(expression) !== null;
}
