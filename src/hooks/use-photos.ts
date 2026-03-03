"use client";

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getPhotos } from '~/server/db/actions';
import { useShallowStore } from '~/store';
import type { Photo } from '~/server/db/schema';
import { getCachedPhotos, upsertCachedPhotos } from '~/lib/offline/db';

const memoryPhotosByScope = new Map<string, Photo[]>();

export function usePhotos() {
    const queryClient = useQueryClient();
    const { userId, isInitialized, isGuest } = useShallowStore((state) => ({
        userId: state.user?.id,
        isInitialized: state.isInitialized,
        isGuest: state.isGuest,
    }));
    const canFetchUserData = isInitialized && !!userId && !isGuest;
    const cacheScope = useMemo(() => {
        if (!isGuest && userId) {
            return `auth:${userId}`;
        }
        return null;
    }, [isGuest, userId]);
    const queryKey = useMemo(() => ['photos', userId ?? null] as const, [userId]);
    const initialData = useMemo(() => {
        if (!cacheScope) return undefined;
        const seed = memoryPhotosByScope.get(cacheScope);
        return seed && seed.length > 0 ? seed : undefined;
    }, [cacheScope]);

    const query = useQuery({
        queryKey,
        queryFn: () => getPhotos(),
        enabled: canFetchUserData,
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        initialData,
    });

    const cacheQuery = useQuery({
        queryKey: ['photos-cache', cacheScope],
        queryFn: () => {
            if (!cacheScope) return Promise.resolve([]);
            return getCachedPhotos(cacheScope);
        },
        enabled: !!cacheScope,
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
    });

    useEffect(() => {
        if (!cacheScope || !cacheQuery.data || cacheQuery.data.length === 0) {
            return;
        }

        memoryPhotosByScope.set(cacheScope, cacheQuery.data);
        queryClient.setQueryData<Photo[]>(
            queryKey,
            (current) => current ?? cacheQuery.data,
        );
    }, [cacheQuery.data, cacheScope, queryClient, queryKey]);

    useEffect(() => {
        if (!cacheScope || !query.data || query.data.length === 0) {
            return;
        }

        memoryPhotosByScope.set(cacheScope, query.data);
        void upsertCachedPhotos(cacheScope, query.data).catch((error: unknown) => {
            console.error('Failed to persist photos in IndexedDB cache:', error);
        });
    }, [cacheScope, query.data]);

    const data = query.data ?? cacheQuery.data ?? (cacheScope ? memoryPhotosByScope.get(cacheScope) : undefined);

    return {
        ...query,
        data,
    };
}
