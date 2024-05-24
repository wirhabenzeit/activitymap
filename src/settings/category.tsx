import {
  FaPersonSkiingNordic,
  FaPersonWalking,
  FaPersonRunning,
  FaPersonBiking,
  FaPersonCircleQuestion,
} from "react-icons/fa6";

import {type Activity} from "~/server/db/schema";
import {ReactElement} from "react";

export type CategorySetting = Record<
  "bcXcSki" | "trailHike" | "run" | "ride" | "misc",
  {
    name: string;
    color: string;
    icon: ReactElement;
    alias: Activity["sport_type"][];
    active: boolean;
  }
>;

export const categorySettings: CategorySetting = {
  bcXcSki: {
    name: "BC & XC Ski",
    color: "#1982C4",
    icon: <FaPersonSkiingNordic />,
    alias: ["BackcountrySki", "NordicSki", "RollerSki"],
    active: true,
  },
  trailHike: {
    name: "Trail / Hike",
    color: "#FF595E",
    icon: <FaPersonWalking />,
    alias: ["Hike", "TrailRun", "RockClimbing", "Snowshoe"],
    active: true,
  },
  run: {
    name: "Run",
    color: "#FFCA3A",
    icon: <FaPersonRunning />,
    alias: ["Run", "VirtualRun"],
    active: true,
  },
  ride: {
    name: "Ride",
    color: "#8AC926",
    icon: <FaPersonBiking />,
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
    icon: <FaPersonCircleQuestion />,
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
  Record<Activity["sport_type"], ReactElement>
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
