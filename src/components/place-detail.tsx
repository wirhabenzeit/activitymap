'use client';

import { useRouter } from 'next/navigation';

import { PlaceSymbol } from '~/components/place-symbol';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '~/components/ui/dialog';
import { useDisplayUnits } from '~/hooks/use-display-preferences';
import type { Activity } from '~/lib/activity';
import { placeKindLabel } from '~/lib/activity-places';
import type { LibraryPlace } from '~/lib/place-library';
import { primaryPlaceKind } from '~/lib/place-symbols';
import { measurementScale, measurementUnit } from '~/lib/units';
import { store } from '~/store';
import { applyFilters } from '~/store/filter';

/** The detail's Show actions: filter to the place (replacing name search)
 * and open the destination, fitting the filtered routes on the map. */
export function useShowPlace(activities: readonly Activity[] | undefined) {
  const router = useRouter();
  return (
    place: Pick<LibraryPlace, 'id' | 'name'>,
    userId: string,
    destination: 'map' | 'list',
  ) => {
    store.setState({
      place: { id: place.id, name: place.name, userId },
      search: '',
    });
    store.getState().setOnlySelected(false);
    if (destination === 'map') {
      store.setState({ showPlaces: true });
      store
        .getState()
        .requestRouteFit(
          (activities ?? [])
            .filter((activity) => applyFilters(store.getState(), activity))
            .map((activity) => activity.id),
        );
    }
    router.push(destination === 'map' ? '/map' : '/list');
  };
}

/** Shared compact inspection. Opening it has no selection/filter/camera effects. */
export function PlaceDetail({
  place,
  onClose,
  onShowActivities,
  onShowMap,
}: {
  place: LibraryPlace | undefined;
  onClose: () => void;
  onShowActivities: () => void;
  onShowMap: () => void;
}) {
  const units = useDisplayUnits();
  return (
    <Dialog
      open={Boolean(place)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-[calc(100%_-_2rem)] sm:max-w-md">
        <DialogTitle className="flex items-center gap-2 pr-6">
          {place && (
            <PlaceSymbol
              kind={primaryPlaceKind(place)}
              className="size-5 shrink-0"
            />
          )}
          {place?.name}
        </DialogTitle>
        <DialogDescription>
          {place && placeKindLabel(place)}
          {place?.elevationM != null
            ? ` · ${Math.round(place.elevationM / measurementScale('elevation', units)).toLocaleString()} ${measurementUnit('elevation', units)}`
            : ''}
        </DialogDescription>
        {place && (
          <>
            <p className="text-sm">
              {place.activityCount}{' '}
              {place.activityCount === 1 ? 'activity' : 'activities'}
            </p>
            <p className="text-sm text-muted-foreground">
              Location: {place.latitude.toFixed(4)},{' '}
              {place.longitude.toFixed(4)}
            </p>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-muted-foreground">First visit</dt>
                <dd>{place.firstVisit.slice(0, 10)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Latest visit</dt>
                <dd>{place.latestVisit.slice(0, 10)}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button onClick={onShowActivities}>Show activities</Button>
              <Button variant="outline" onClick={onShowMap}>
                Show on map
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
