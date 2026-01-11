"use client";

import { useQuery } from '@tanstack/react-query';
import { getPhotos } from '~/server/db/actions';

export function usePhotos() {
    return useQuery({
        queryKey: ['photos'],
        queryFn: () => getPhotos(),
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });
}
