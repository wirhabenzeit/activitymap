import { categorySettings } from '~/settings/category';

export type SportGroup = keyof typeof categorySettings;

/**
 * The stats charts recolor sport categories to the shadcn `--chart-1..5`
 * design tokens. `categorySettings[*].color` stays untouched (concrete hex)
 * since it also feeds the Mapbox line-color expression in interactive-map.tsx,
 * which can't resolve CSS custom properties.
 */
const chartTokenByCategory: Record<SportGroup, string> = {
  bcXcSki: '--chart-1',
  trailHike: '--chart-2',
  run: '--chart-3',
  ride: '--chart-4',
  misc: '--chart-5',
};

export function resolveChartCategoryColor(group: SportGroup): string {
  if (typeof document === 'undefined') return categorySettings[group].color;
  const token = chartTokenByCategory[group];
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();
  return value ? `hsl(${value})` : categorySettings[group].color;
}

export function resolveChartCategoryColors(): Record<SportGroup, string> {
  const groups = Object.keys(categorySettings) as SportGroup[];
  return Object.fromEntries(
    groups.map((group) => [group, resolveChartCategoryColor(group)]),
  ) as Record<SportGroup, string>;
}
