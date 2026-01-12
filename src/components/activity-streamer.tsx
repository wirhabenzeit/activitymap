'use client';

import { useEffect } from 'react';
import { useActivities } from '~/hooks/use-activities';

export function ActivityStreamer() {
    const { hasNextPage, fetchNextPage, isFetching } = useActivities();

    useEffect(() => {
        if (hasNextPage && !isFetching) {
            void fetchNextPage();
        }
    }, [hasNextPage, fetchNextPage, isFetching]);



    return null;
}
