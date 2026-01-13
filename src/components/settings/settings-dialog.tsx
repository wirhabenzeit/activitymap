'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from '~/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import { Loader2, RefreshCw, Activity, CheckCircle2, ImageOff } from 'lucide-react';
import { syncYear, syncActivities, repairYear } from '~/server/strava/verification';
import { deleteActivities } from '~/server/strava/actions';
import { useToast } from '~/hooks/use-toast';
import { cn } from '~/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { useActivities } from '~/hooks/use-activities';

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const { data: activities, isFetching } = useActivities();
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Compute stats from local activities
    const stats = React.useMemo(() => {
        if (!activities) return null;

        const totalActivities = activities.length;
        const incompleteActivities = activities.filter(a => !a.is_complete).length;
        const totalPhotos = 0; // Placeholder

        return {
            totalActivities,
            incompleteActivities,
            totalPhotos,
        };
    }, [activities]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[75vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-bold flex items-center gap-2">
                        Settings & Status
                        {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </DialogTitle>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                    {/* Stats Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">
                                    Total Activities
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{stats?.totalActivities ?? 0}</div>
                                <p className="text-xs text-muted-foreground">
                                    {stats?.incompleteActivities ?? 0} incomplete
                                </p>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Yearly History */}
                    <div className="space-y-6">
                        <YearlyHistory activities={activities || []} globalLoading={isFetching} />
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function YearlyHistory({ activities, globalLoading }: { activities: any[], globalLoading: boolean }) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [syncingYear, setSyncingYear] = React.useState<number | null>(null);
    const [repairingYear, setRepairingYear] = React.useState<number | null>(null);
    const [deletingYear, setDeletingYear] = React.useState<number | null>(null);

    const [checkResults, setCheckResults] = React.useState<Record<number, { stravaCount: number; extraIds: number[] }>>({});

    // Process years
    const displayYears = React.useMemo(() => {
        if (!activities.length) return [{ year: new Date().getFullYear(), count: 0, incompleteCount: 0, missingPhotosCount: 0, ids: [], incompleteIds: [], missingPhotoIds: [] }];

        // Group by year
        const statsByYear = new Map<number, {
            count: number;
            incompleteCount: number;
            missingPhotosCount: number;
            ids: number[];
            incompleteIds: number[];
            missingPhotoIds: number[];
        }>();

        activities.forEach(act => {
            const year = new Date(act.start_date).getFullYear();
            const current = statsByYear.get(year) || { count: 0, incompleteCount: 0, missingPhotosCount: 0, ids: [], incompleteIds: [], missingPhotoIds: [] };

            current.count++;
            current.ids.push(act.id);

            if (!act.is_complete) {
                current.incompleteCount++;
                current.incompleteIds.push(act.id);

                // Check if it has photos on Strava but is incomplete (thus missing photos locally)
                if ((act.total_photo_count || 0) > 0) {
                    current.missingPhotosCount++;
                    current.missingPhotoIds.push(act.id);
                }
            }

            statsByYear.set(year, current);
        });

        const yearsList = Array.from(statsByYear.keys());
        const minYear = Math.min(...yearsList);
        const maxYear = Math.max(...yearsList);
        const currentYear = new Date().getFullYear();

        const result = new Set<number>();

        for (let y = Math.max(maxYear, currentYear); y >= minYear; y--) {
            result.add(y);
        }
        result.add(minYear - 1);

        const sortedYears = Array.from(result).sort((a, b) => b - a);

        return sortedYears.map(year => {
            const stat = statsByYear.get(year);
            return {
                year,
                count: stat?.count || 0,
                incompleteCount: stat?.incompleteCount || 0,
                missingPhotosCount: stat?.missingPhotosCount || 0,
                ids: stat?.ids || [],
                incompleteIds: stat?.incompleteIds || [],
                missingPhotoIds: stat?.missingPhotoIds || []
            };
        });
    }, [activities]);


    const syncYearMutation = useMutation({
        mutationFn: ({ year }: { year: number }) => syncYear(year),
        onMutate: ({ year }) => setSyncingYear(year),
        onSettled: () => setSyncingYear(null),
        onSuccess: (data, variables) => {
            if (data.success && data.year && data.stravaIds) {
                // Client-side computation of extra IDs
                // Find the local IDs for this year from our current displayYears state
                const yearStats = displayYears.find(y => y.year === data.year);
                const localIds = yearStats?.ids || [];
                const stravaIdsSet = new Set(data.stravaIds);
                const extraIds = localIds.filter(id => !stravaIdsSet.has(id));

                setCheckResults(prev => ({
                    ...prev,
                    [data.year]: {
                        stravaCount: data.stravaIds?.length ?? 0,
                        extraIds: extraIds
                    }
                }));

                const extraCount = extraIds.length;

                toast({
                    title: `Sync Complete for ${data.year}`,
                    description: `Synced ${data.stravaIds.length} activities. ${extraCount ? `Found ${extraCount} extra.` : 'All clear.'}`,
                });
                queryClient.invalidateQueries({ queryKey: ['activities'] });
                queryClient.invalidateQueries({ queryKey: ['photos'] });
            } else {
                toast({
                    title: 'Sync Failed',
                    description: data.error,
                    variant: 'destructive',
                });
            }
        }
    });

    const deleteExtraMutation = useMutation({
        mutationFn: ({ ids, year }: { ids: number[], year: number }) => deleteActivities(ids).then(res => ({ ...res, year })),
        onMutate: ({ year }) => setDeletingYear(year),
        onSettled: () => setDeletingYear(null),
        onSuccess: (data, variables) => {
            if (data.deletedCount > 0) {
                toast({
                    title: 'Cleanup Complete',
                    description: `Removed ${data.deletedCount} obsolete activities.`,
                });
                setCheckResults(prev => {
                    if (!variables.year) return prev;
                    return {
                        ...prev,
                        [variables.year]: {
                            ...prev[variables.year]!,
                            extraIds: []
                        }
                    };
                });
                queryClient.invalidateQueries({ queryKey: ['activities'] });
                queryClient.invalidateQueries({ queryKey: ['photos'] });
            } else {
                toast({
                    title: 'Cleanup Failed',
                    description: data.errors.join(', ') || 'Failed to delete.',
                    variant: 'destructive',
                });
            }
        }
    });

    const repairMutation = useMutation({
        mutationFn: ({ year, ids }: { year: number, ids: number[] }) => repairYear(year, ids).then(res => ({ ...res, year })),
        onMutate: ({ year }) => setRepairingYear(year),
        onSettled: () => setRepairingYear(null),
        onSuccess: (data) => {
            if (data.success) {
                toast({
                    title: 'Repair Complete',
                    description: `Repaired ${data.count} activities.${data.remaining ? ' More remaining.' : ''}`,
                });
                queryClient.invalidateQueries({ queryKey: ['activities'] });
                queryClient.invalidateQueries({ queryKey: ['photos'] });
            } else {
                toast({
                    title: 'Repair Failed',
                    description: data.error,
                    variant: 'destructive',
                });
            }
        }
    });

    return (
        <div className="rounded-md border w-full">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Year</TableHead>
                        <TableHead className="text-right">ActivityMap</TableHead>
                        <TableHead className="text-right">Strava</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {displayYears.map((stat) => {
                        const result = checkResults[stat.year];
                        const isSyncing = syncingYear === stat.year;
                        const isRepairing = repairingYear === stat.year;
                        const isDeleting = deletingYear === stat.year;
                        const isAnyActionPending = isSyncing || isRepairing || isDeleting || globalLoading;

                        const extraCount = result?.extraIds?.length || 0;

                        return (
                            <TableRow key={stat.year}>
                                <TableCell className="font-medium">{stat.year}</TableCell>
                                <TableCell className="text-muted-foreground text-right">
                                    {stat.count > 0 ? (
                                        <div className="flex flex-col">
                                            <span>{stat.count}</span>
                                            {stat.incompleteCount > 0 && (
                                                <div className="flex flex-col text-[10px] items-end">
                                                    <span className="text-amber-500 font-medium">
                                                        ({stat.incompleteCount} incomplete)
                                                    </span>
                                                    {stat.missingPhotosCount > 0 && (
                                                        <span className="text-blue-500 font-medium flex items-center gap-0.5">
                                                            ({stat.missingPhotosCount} without photos)
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <span className="text-muted-foreground/30">-</span>
                                    )}
                                </TableCell>
                                <TableCell className="text-right">
                                    {result ? (
                                        <div className="flex flex-col items-end">
                                            <span className="font-mono text-green-500">
                                                {result.stravaCount}
                                            </span>
                                            {extraCount > 0 && (
                                                <span className="text-[10px] text-red-500 font-medium">
                                                    (+{extraCount} extra)
                                                </span>
                                            )}
                                        </div>
                                    ) : (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-8 px-2 text-muted-foreground hover:text-foreground"
                                            disabled={isAnyActionPending}
                                            onClick={() => syncYearMutation.mutate({ year: stat.year })}
                                        >
                                            {isSyncing ? (
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                                <span className="flex items-center gap-1 text-xs">
                                                    <RefreshCw className="h-3 w-3" />
                                                </span>
                                            )}
                                        </Button>
                                    )}
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-2 flex-wrap">
                                        {/* Repair */}
                                        {stat.incompleteCount > 0 && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-7 text-xs border-amber-500/50 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400"
                                                disabled={isAnyActionPending}
                                                onClick={() => repairMutation.mutate({ year: stat.year, ids: stat.incompleteIds })}
                                            >
                                                {isRepairing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Activity className="h-3 w-3 mr-1" />}
                                                Repair
                                            </Button>
                                        )}

                                        {/* Sync Photos (Specific Repair) */}
                                        {stat.missingPhotosCount > 0 && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-7 text-xs border-blue-500/50 hover:bg-blue-500/10 hover:text-blue-600 dark:hover:text-blue-400"
                                                disabled={isAnyActionPending}
                                                onClick={() => repairMutation.mutate({ year: stat.year, ids: stat.missingPhotoIds })}
                                            >
                                                {isRepairing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ImageOff className="h-3 w-3 mr-1" />}
                                                Photos
                                            </Button>
                                        )}

                                        {/* Cleanup Extra */}
                                        {extraCount > 0 && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-7 text-xs border-red-500/50 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                                                disabled={isAnyActionPending}
                                                onClick={() => deleteExtraMutation.mutate({ ids: result!.extraIds, year: stat.year })}
                                            >
                                                {isDeleting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                                                Clean {extraCount}
                                            </Button>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        );
                    })
                    }
                </TableBody>
            </Table>
        </div>
    );
}
