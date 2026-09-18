import { categorySettings } from '~/settings/category';

export type SportGroup = keyof typeof categorySettings;

export function resolveChartCategoryColor(group: SportGroup): string {
  return categorySettings[group].color;
}

export function resolveChartCategoryColors(): Record<SportGroup, string> {
  const groups = Object.keys(categorySettings) as SportGroup[];
  return Object.fromEntries(
    groups.map((group) => [group, resolveChartCategoryColor(group)]),
  ) as Record<SportGroup, string>;
}
