import {
  type CategoryID,
  type SportID,
  presentation,
} from './catalog.generated';

/** No React, server module, translated text or display label drives membership. */
export const sportCategories = presentation.categories;
export const sportCategoryIDs = sportCategories.map((category) => category.id);
export const categoryForSport = Object.fromEntries(
  sportCategories.flatMap((category) =>
    category.sports.map((sport) => [sport, category.id]),
  ),
) as Record<SportID, CategoryID>;
export type { CategoryID, SportID } from './catalog.generated';
