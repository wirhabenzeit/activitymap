import type { ReactNode } from 'react';

import { cn } from '~/lib/utils';

export function HeadlineValue({
  value,
  unit,
  size = 'large',
}: {
  value: ReactNode;
  unit?: string;
  size?: 'tile' | 'large';
}) {
  return (
    <span
      className={cn(
        'max-w-full min-w-0 shrink-0 font-mono leading-tight font-medium tracking-tight tabular-nums',
        size === 'tile' ? 'text-[20px]' : 'text-[32px]',
      )}
    >
      {value}
      {unit && (
        <small className="ml-1 font-sans text-[13px] font-normal tracking-normal text-muted-foreground">
          {unit}
        </small>
      )}
    </span>
  );
}
