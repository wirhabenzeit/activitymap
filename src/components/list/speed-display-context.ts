'use client';

import { createContext } from 'react';
import type { SpeedDisplay } from '~/lib/speed-display';

export const SpeedDisplayContext = createContext<SpeedDisplay>('speed');
