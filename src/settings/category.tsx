import {
  FaPersonBiking,
  FaPersonCircleQuestion,
  FaPersonRunning,
  FaPersonSkiingNordic,
  FaPersonWalking,
} from 'react-icons/fa6';
import { type IconType } from 'react-icons/lib';

import type { Activity } from '~/lib/activity';
import { message } from '~/lib/presentation/messages';
import { sportCategories } from '~/lib/presentation/sports';

export type CategorySetting = Record<
  'bcXcSki' | 'trailHike' | 'run' | 'ride' | 'misc',
  {
    name: string;
    color: string;
    icon: IconType;
    alias: Activity['sport_type'][];
    active: boolean;
  }
>;

const categoryIcons = {
  bcXcSki: FaPersonSkiingNordic,
  trailHike: FaPersonWalking,
  run: FaPersonRunning,
  ride: FaPersonBiking,
  misc: FaPersonCircleQuestion,
};
export const categorySettings = Object.fromEntries(
  sportCategories.map((category) => [
    category.id,
    {
      name: message(category.message),
      color: category.color,
      icon: categoryIcons[category.id],
      alias: [...category.sports],
      active: true,
    },
  ]),
) as CategorySetting;

const colorMap: Partial<Record<Activity['sport_type'], string>> = {};

const iconMap: Partial<Record<Activity['sport_type'], IconType>> = {};

const aliasMap: Partial<
  Record<Activity['sport_type'], keyof typeof categorySettings>
> = {};

Object.entries(categorySettings).forEach(([key, value]) => {
  value.alias.forEach((alias) => {
    colorMap[alias] = value.color;
    iconMap[alias] = value.icon;
    aliasMap[alias] = key as keyof typeof categorySettings;
  });
});

export { aliasMap, colorMap, iconMap };
