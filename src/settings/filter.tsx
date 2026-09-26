import { RulerHorizontalIcon, StopwatchIcon } from '@radix-ui/react-icons';
import { Flag, LockKeyhole, Mountain } from 'lucide-react';
import { FaBriefcase } from 'react-icons/fa6';

import { type ReactElement } from 'react';

export const inequalityFilters = {
  distance: {
    icon: <RulerHorizontalIcon />,
    label: 'Distance',
    transform: (value: number) => value * 1000,
    fromCanonical: (value: number) => value / 1000,
    unit: 'km',
  },
  total_elevation_gain: {
    icon: <Mountain />,
    label: 'Elevation gain',
    transform: (value: number) => value,
    fromCanonical: (value: number) => value,
    unit: 'm',
  },
  elapsed_time: {
    icon: <StopwatchIcon />,
    label: 'Elapsed time',
    unit: 'h',
    transform: (value: number) => value * 3600,
    fromCanonical: (value: number) => value / 3600,
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
