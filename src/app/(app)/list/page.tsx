'use client';

import { Suspense } from 'react';
import { ActivityListView } from '~/components/list/activity-list';
import { useActivities } from '~/hooks/use-activities';
import { useFilteredActivities } from '~/hooks/use-filtered-activities';
import { usePhotos } from '~/hooks/use-photos';

function ActivityList() {
  const { data: activities, hasNextPage, isFetching } = useActivities();
  const { data: photos } = usePhotos();
  const { filterIDs } = useFilteredActivities(activities);
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
