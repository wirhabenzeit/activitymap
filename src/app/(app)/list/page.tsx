'use client';

import { Suspense } from 'react';

import { ActivityListView } from '~/components/list/activity-list';
import { useBrowsingLibrary } from '~/hooks/use-browsing-library';
import { usePhotos } from '~/hooks/use-photos';

function ActivityList() {
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

export default function ListPage() {
  return (
    <Suspense>
      <ActivityList />
    </Suspense>
  );
}
