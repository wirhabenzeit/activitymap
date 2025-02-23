import { FaBriefcase } from "react-icons/fa6";
import { RulerHorizontalIcon, StopwatchIcon } from "@radix-ui/react-icons";
import { Mountain } from "lucide-react";

import { type ReactElement } from "react";

export const inequalityFilters = {
  distance: {
    icon: <RulerHorizontalIcon />,
    transform: (value: number) => value * 1000,
    unit: "km",
  },
  total_elevation_gain: {
    icon: <Mountain />,
    transform: (value: number) => value,
    unit: "m",
  },
  elapsed_time: {
    icon: <StopwatchIcon />,
    unit: "h",
    transform: (value: number) => value * 3600,
  },
} as const;

export type BinaryFilter = {
  icon: ReactElement;
  label: string;
  defaultValue: boolean | undefined;
};

export const binaryFilters = {
  commute: {
    icon: <FaBriefcase />,
    label: "Commutes",
    defaultValue: undefined,
  } as BinaryFilter,
};
