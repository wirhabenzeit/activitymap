"use client";

import { useQuery } from '@tanstack/react-query';
import { getPhotos } from '~/server/db/actions';
import { useShallowStore } from '~/store';

export function usePhotos() {
    const { userId, isInitialized, isGuest } = useShallowStore((state) => ({
        userId: state.user?.id,
        isInitialized: state.isInitialized,
        isGuest: state.isGuest,
    }));
    const canFetchUserData = isInitialized && !!userId && !isGuest;

    return useQuery({
        queryKey: ['photos', userId ?? null],
        queryFn: () => getPhotos(),
        enabled: canFetchUserData,
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });
}
