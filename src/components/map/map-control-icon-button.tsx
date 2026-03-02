'use client';

import * as React from 'react';

import { Button, type ButtonProps } from '~/components/ui/button';
import { cn } from '~/lib/utils';

export const MapControlIconButton = React.forwardRef<
  HTMLButtonElement,
  ButtonProps
>(({ className, size = 'icon', variant = 'ghost', ...props }, ref) => {
  return (
    <Button
      ref={ref}
      size={size}
      variant={variant}
      className={cn(
        '!inline-flex !h-8 !w-8 !items-center !justify-center !gap-0 !p-0 !shadow-none [&_svg]:size-5 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
});

MapControlIconButton.displayName = 'MapControlIconButton';
