'use client';

import { Minus, X } from 'lucide-react';

import { Button, type ButtonProps } from '~/components/ui/button';
import { cn } from '~/lib/utils';

/** Product dismissal actions share a 44px target; Back remains a navigation action. */
export function DismissButton({
  label,
  intent = 'close',
  className,
  ...props
}: Omit<ButtonProps, 'children' | 'size' | 'aria-label'> & {
  label: string;
  intent?: 'close' | 'collapse';
}) {
  const Icon = intent === 'collapse' ? Minus : X;
  return (
    <Button
      {...props}
      type={props.type ?? 'button'}
      variant={props.variant ?? 'ghost'}
      size="icon"
      aria-label={label}
      title={label}
      className={cn(
        'size-11 min-h-11 min-w-11 shrink-0 p-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
        className,
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
    </Button>
  );
}
