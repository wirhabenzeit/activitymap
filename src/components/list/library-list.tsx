'use client';

import { ActivityListView } from '~/components/list/activity-list';
import { useBrowsingLibrary } from '~/hooks/use-browsing-library';
import { usePhotos } from '~/hooks/use-photos';

/** The `/list` view over the signed-in library, rendered by `AppViews`. */
export default function LibraryList() {
  const {
    query: { data: activities, hasNextPage, isFetching },
    filterIDs,
  } = useBrowsingLibrary();
  const { data: photos } = usePhotos();
  return (
    <ActivityListView
      activities={activities}
      photos={photos}
      filterIDs={filterIDs}
      hasNextPage={hasNextPage}
      isFetching={isFetching}
    />
  );
}
