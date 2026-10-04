import type { ReactNode } from 'react';
import { CardContent } from '~/components/ui/card';

/** One hierarchy on every viewport: description, chart, headline stats, topic groups. */
export function RouteDetailsContent({
  children,
  elevation,
  description,
}: {
  children: ReactNode;
  elevation: ReactNode;
  description?: string | null;
}) {
  return (
    <CardContent className="space-y-4 px-4 pb-4 pt-0">
      {description?.trim() && (
        <p className="whitespace-pre-wrap text-sm">{description}</p>
      )}
      {elevation && <div className="min-w-0">{elevation}</div>}
      {children}
    </CardContent>
  );
}
