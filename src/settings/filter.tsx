import { RulerHorizontalIcon, StopwatchIcon } from '@radix-ui/react-icons';
import { Flag, LockKeyhole, Mountain } from 'lucide-react';
import { FaBriefcase } from 'react-icons/fa6';

import { type ReactElement } from 'react';

export const inequalityFilters = {
  distance: {
    icon: <RulerHorizontalIcon />,
    label: 'Distance',
    measurement: 'distance',
  },
  total_elevation_gain: {
    icon: <Mountain />,
    label: 'Elevation gain',
    measurement: 'elevation',
  },
  elapsed_time: {
    icon: <StopwatchIcon />,
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
    icon: <FaBriefcase />,
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
