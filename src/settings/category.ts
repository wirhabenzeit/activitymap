import {library} from "@fortawesome/fontawesome-svg-core";
import {fas} from "@fortawesome/free-solid-svg-icons";

library.add(fas);

import {type IconProp} from "@fortawesome/fontawesome-svg-core";

import {type Activity} from "~/server/db/schema";

export type CategorySetting = Record<
  "bcXcSki" | "trailHike" | "run" | "ride" | "misc",
  {
    name: string;
    color: string;
    icon: IconProp;
    alias: Activity["sport_type"][];
    active: boolean;
  }
>;

export const categorySettings: CategorySetting = {
  bcXcSki: {
    name: "BC & XC Ski",
    color: "#1982C4",
    icon: "skiing-nordic",
    alias: ["BackcountrySki", "NordicSki", "RollerSki"],
    active: true,
  },
  trailHike: {
    name: "Trail / Hike",
    color: "#FF595E",
    icon: "walking",
    alias: ["Hike", "TrailRun", "RockClimbing", "Snowshoe"],
    active: true,
  },
  run: {
    name: "Run",
    color: "#FFCA3A",
    icon: "running",
    alias: ["Run", "VirtualRun"],
    active: true,
  },
  ride: {
    name: "Ride",
    color: "#8AC926",
    icon: "biking",
    alias: [
      "Ride",
      "VirtualRide",
      "GravelRide",
      "MountainBikeRide",
      "EBikeRide",
      "EMountainBikeRide",
      "Handcycle",
      "Velomobile",
    ],
    active: true,
  },
  misc: {
    name: "Miscellaneous",
    color: "#6A4C93",
    icon: "person-circle-question",
    active: true,
    alias: [
      "AlpineSki",
      "Badminton",
      "Canoeing",
      "Crossfit",
      "Elliptical",
      "Golf",
      "HighIntensityIntervalTraining",
      "IceSkate",
      "InlineSkate",
      "Kayaking",
      "Kitesurf",
      "Pickleball",
      "Pilates",
      "Racquetball",
      "Rowing",
      "Sail",
      "Skateboard",
      "Snowboard",
      "Soccer",
      "Squash",
      "StairStepper",
      "StandUpPaddling",
      "Surfing",
      "Swim",
      "TableTennis",
      "Tennis",
      "VirtualRow",
      "Walk",
      "WeightTraining",
      "Wheelchair",
      "Windsurf",
      "Workout",
      "Yoga",
    ],
  },
};

const colorMap: Partial<
  Record<Activity["sport_type"], string>
> = {};

const iconMap: Partial<
  Record<Activity["sport_type"], IconProp>
> = {};

const aliasMap: Partial<
  Record<
    Activity["sport_type"],
    keyof typeof categorySettings
  >
> = {};

Object.entries(categorySettings).forEach(([key, value]) => {
  value.alias.forEach((alias) => {
    colorMap[alias] = value.color;
    iconMap[alias] = value.icon;
    aliasMap[alias] = key as keyof typeof categorySettings;
  });
});

export {aliasMap, colorMap, iconMap};
