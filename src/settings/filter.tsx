import {
  BriefcaseBusiness,
  Flag,
  LockKeyhole,
  Mountain,
  Ruler,
  Timer,
} from 'lucide-react';
import { type ReactElement } from 'react';

export const inequalityFilters = {
  distance: {
    icon: <Ruler />,
    label: 'Distance',
    measurement: 'distance',
  },
  total_elevation_gain: {
    icon: <Mountain />,
    label: 'Elevation gain',
    measurement: 'elevation',
  },
  elapsed_time: {
    icon: <Timer />,
    label: 'Elapsed time',
    unit: 'h',
    scale: 3600,
  },
} as const;

export type BinaryFilter = {
  icon: ReactElement;
  label: string;
};

export const binaryFilters = {
  commute: {
    icon: <BriefcaseBusiness />,
    label: 'Commute',
  },
  private: {
    icon: <LockKeyhole />,
    label: 'Private',
  },
  flagged: {
    icon: <Flag />,
    label: 'Flagged',
  },
} satisfies Record<string, BinaryFilter>;
