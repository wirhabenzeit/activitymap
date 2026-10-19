/** Presentation facts only. Analytics remain in their existing client engines. */
export type ComparisonDirection = 'higher' | 'lower' | 'unchanged';
export function comparisonPresentation(current: number, previous: number) {
  const delta = current - previous;
  const direction: ComparisonDirection =
    delta === 0 ? 'unchanged' : delta > 0 ? 'higher' : 'lower';
  const raw = previous === 0 ? null : (delta / previous) * 100;
  const magnitude =
    raw === null || !Number.isFinite(raw)
      ? null
      : Math.floor(Math.abs(raw) + 0.5);
  return { direction, magnitude, lessThanOne: magnitude === 0 && delta !== 0 };
}
export function comparisonPercentage(
  current: number,
  previous: number,
  number: (value: number) => string = String,
) {
  const facts = comparisonPresentation(current, previous);
  if (facts.magnitude === null) return null;
  const sign =
    facts.direction === 'unchanged'
      ? ''
      : facts.direction === 'higher'
        ? '+'
        : '−';
  return `${sign}${facts.lessThanOne ? '<1' : number(facts.magnitude)}%`;
}

export type ComparisonPeriods = {
  current: { first: number; last: number; complete: boolean };
  previous: { first: number; last: number; complete: boolean };
};
const day = (year: number, month: number, date = 1) =>
  Date.UTC(year, month, date) / 86400000;
/** Date-only UTC coordinates; never reinterpret an activity day in viewer time. */
export function comparisonPeriods(
  today: number,
  kind: 'month' | 'year',
): ComparisonPeriods {
  const date = new Date(today * 86400000),
    year = date.getUTCFullYear(),
    month = date.getUTCMonth();
  const first = kind === 'month' ? day(year, month) : day(year, 0);
  const previousFirst =
    kind === 'month' ? day(year, month - 1) : day(year - 1, 0);
  const previousMonth =
    kind === 'month' ? new Date(previousFirst * 86400000).getUTCMonth() : month;
  const previousYear = new Date(previousFirst * 86400000).getUTCFullYear();
  const length = new Date(
    Date.UTC(previousYear, previousMonth + 1, 0),
  ).getUTCDate();
  const previousLast = day(
    previousYear,
    previousMonth,
    Math.min(date.getUTCDate(), length),
  );
  return {
    current: { first, last: today, complete: false },
    previous: {
      first: previousFirst,
      last: previousLast,
      complete: previousLast === first - 1,
    },
  };
}
