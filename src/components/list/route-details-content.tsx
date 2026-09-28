'use client';

import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { CardContent } from '~/components/ui/card';
import { cn } from '~/lib/utils';

// Match the map panel's desktop breakpoint, including phones in landscape.
const DESKTOP_QUERY = '(min-width: 1024px)';
const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};
const isDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;
// Keep charts unmounted until the viewport is known, including hydration on a phone.
const serverSnapshot = () => false;

/** The summary is always visible; on phones elevation is a separate disclosure. */
export function RouteDetailsContent({
  children,
  elevation,
}: {
  children: ReactNode;
  elevation: ReactNode;
}) {
  const desktop = useSyncExternalStore(subscribe, isDesktop, serverSnapshot);
  const [expanded, setExpanded] = useState(false);
  const profileId = useId();
  const showElevation = Boolean(elevation) && (desktop || expanded);

  return (
    <CardContent
      className={cn(
        'px-4 pb-4 pt-0',
        showElevation &&
          '@2xl:grid @2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] @2xl:gap-4',
      )}
    >
      {children}
      {elevation && (
        <div
          className={cn(
            'mt-3 min-w-0',
            showElevation && '@2xl:mt-0 @2xl:border-l @2xl:pl-4',
          )}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 px-2 lg:hidden"
            aria-expanded={showElevation}
            aria-controls={profileId}
            onClick={() => setExpanded((value) => !value)}
          >
            {showElevation ? (
              <Minus aria-hidden="true" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            {showElevation ? 'Hide elevation' : 'Show elevation'}
          </Button>
          <div id={profileId} hidden={!showElevation} className="mt-2 lg:mt-0">
            {showElevation && elevation}
          </div>
        </div>
      )}
    </CardContent>
  );
}
