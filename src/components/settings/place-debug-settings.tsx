'use client';

import { usePlaceDebugAccess } from '~/hooks/use-place-debug';
import { usePlaceDebug } from '~/store/place-debug';

export function PlaceDebugSettings({ check }: { check: boolean }) {
  const { userId, allowed, active } = usePlaceDebugAccess(check);
  const setEnabled = usePlaceDebug((state) => state.setEnabled);
  if (!allowed || !userId) return null;
  return (
    <section
      className="mt-6 space-y-2 border-t pt-5"
      aria-labelledby="place-debug-heading"
    >
      <div className="flex items-center justify-between gap-4">
        <label
          id="place-debug-heading"
          htmlFor="place-debug-toggle"
          className="text-sm font-semibold"
        >
          Place matching debug mode
        </label>
        <input
          type="checkbox"
          role="switch"
          id="place-debug-toggle"
          checked={active}
          onChange={(event) => setEnabled(userId, event.target.checked)}
          aria-describedby="place-debug-description"
          className="size-5 accent-teal-700"
        />
      </div>
      <p id="place-debug-description" className="text-xs text-muted-foreground">
        Show nearby places and experiment with matching thresholds on the map.
        Temporary for this signed-in session; results are never saved.
      </p>
    </section>
  );
}
