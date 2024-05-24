import {
  FaStopwatch,
  FaCalendarDays,
  FaRulerHorizontal,
  FaRulerVertical,
  FaBriefcase,
} from "react-icons/fa6";

import {ReactElement} from "react";

export const filterSettings = {
  start_date_local_timestamp: {
    icon: <FaCalendarDays />,
    tooltip: (value: number) =>
      new Date(value * 1000).toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      }),
    scale: (x: number) => 2 * x - x ** 2,
  },
  distance: {
    icon: <FaRulerHorizontal />,
    tooltip: (value: number) =>
      `${Math.round(value / 1000)}km`,
    scale: (x: number) => x ** 2,
  },
  total_elevation_gain: {
    icon: <FaRulerVertical />,
    tooltip: (value: number) => `${Math.round(value)}m`,
    scale: (x: number) => x ** 2,
  },
  elapsed_time: {
    icon: <FaStopwatch />,
    tooltip: (value: number) => {
      const date = new Date(value * 1000);
      return `${date.getUTCHours()}h${date.getUTCMinutes()}`;
    },
    scale: (x: number) => x ** 2,
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
