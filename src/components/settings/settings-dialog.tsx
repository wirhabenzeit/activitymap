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
import { Loader2, RefreshCw, Activity, CheckCircle2 } from 'lucide-react';
import { checkYear, syncMissing, repairYear } from '~/server/strava/verification';
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
        const totalPhotos = 0; // Photos are not typically eager loaded in full detail on list view, might need adjustment if we want accurate photo count

        // Find last sync time (approximate based on latest update or just use what we have)
        // Ideally we'd have a separate query for metadata, but for now we can omit or simplify
        const lastSync = null;

        return {
            totalActivities,
            incompleteActivities,
            totalPhotos,
            lastSync
        };
    }, [activities]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto w-full">
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
                        {/* Removed Photo card as accurate count requires DB query, and Last Sync as it's less relevant with stream */}
                    </div>

                    {/* Actions & History */}
                    <div className="space-y-6">
                        {/* Maintenance Actions - ONLY SHOW IF GLOBAL REPAIR IS NEEDED OR SIMPLIFY */}
                        {/* Keeping it simple for now, focusing on Yearly which is more granular */}

                        {/* Yearly History */}
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

    const [checkingYear, setCheckingYear] = React.useState<number | null>(null);
    const [syncingYear, setSyncingYear] = React.useState<number | null>(null);
    const [repairingYear, setRepairingYear] = React.useState<number | null>(null);

    const [checkResults, setCheckResults] = React.useState<Record<number, { stravaCount: number; missingIds: number[] }>>({});

    // Process years to include padding
    const displayYears = React.useMemo(() => {
        if (!activities.length) return [{ year: new Date().getFullYear(), count: 0, incompleteCount: 0 }];

        // Group by year
        const statsByYear = new Map<number, { count: number; incompleteCount: number }>();

        activities.forEach(act => {
            const year = new Date(act.start_date).getFullYear();
            const current = statsByYear.get(year) || { count: 0, incompleteCount: 0 };
            current.count++;
            if (!act.is_complete) current.incompleteCount++;
            statsByYear.set(year, current);
        });

        const yearsList = Array.from(statsByYear.keys());
        const minYear = Math.min(...yearsList);
        const maxYear = Math.max(...yearsList);
        const currentYear = new Date().getFullYear();

        const result = new Set<number>();
        result.add(Math.max(maxYear, currentYear) + 1);

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
            };
        });
    }, [activities]);


    const checkMutation = useMutation({
        mutationFn: (year: number) => checkYear(year),
        onMutate: (year) => setCheckingYear(year),
        onSettled: () => setCheckingYear(null),
        onSuccess: (data) => {
            if (data.success && data.year) {
                setCheckResults(prev => ({
                    ...prev,
                    [data.year]: {
                        stravaCount: data.stravaCount ?? 0,
                        missingIds: data.missingIds ?? []
                    }
                }));
                const missingCount = data.missingIds?.length ?? 0;
                toast({
                    title: `Check Complete for ${data.year}`,
                    description: `Found ${data.stravaCount} activities on Strava. ${missingCount > 0 ? missingCount + ' missing in DB.' : 'All synced.'}`,
                });
            } else {
                toast({
                    title: 'Check Failed',
                    description: data.error,
                    variant: 'destructive',
                });
            }
        }
    });

    const syncMissingMutation = useMutation({
        mutationFn: ({ ids, year }: { ids: number[], year: number }) => syncMissing(ids).then(res => ({ ...res, year })),
        onMutate: ({ year }) => setSyncingYear(year),
        onSettled: () => setSyncingYear(null),
        onSuccess: (data) => {
            if (data.success) {
                toast({
                    title: 'Sync Complete',
                    description: `Synced ${data.count} missing activities.`,
                });
                // Clear the missing IDs for this result by updating state
                setCheckResults(prev => {
                    if (!data.year) return prev;
                    return {
                        ...prev,
                        [data.year]: {
                            ...prev[data.year]!,
                            stravaCount: prev[data.year]?.stravaCount ?? 0,
                            missingIds: []
                        }
                    };
                });
                queryClient.invalidateQueries({ queryKey: ['activities'] });
            } else {
                toast({
                    title: 'Sync Failed',
                    description: data.error,
                    variant: 'destructive',
                });
            }
        }
    });

    const repairMutation = useMutation({
        mutationFn: (year: number) => repairYear(year).then(res => ({ ...res, year })),
        onMutate: (year) => setRepairingYear(year),
        onSettled: () => setRepairingYear(null),
        onSuccess: (data) => {
            if (data.success) {
                toast({
                    title: 'Repair Complete',
                    description: `Repaired ${data.count} activities.${data.remaining ? ' More remaining.' : ''}`,
                });
                queryClient.invalidateQueries({ queryKey: ['activities'] });
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
                        <TableHead className="w-[100px]">Year</TableHead>
                        <TableHead className="text-right">ActivityMap</TableHead>
                        <TableHead className="text-right">Strava</TableHead>
                        <TableHead className="text-right">Actions (Sync)</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {displayYears.map((stat) => {
                        const result = checkResults[stat.year];
                        const isChecking = checkingYear === stat.year;
                        const isSyncing = syncingYear === stat.year;
                        const isRepairing = repairingYear === stat.year;
                        const isAnyActionPending = isChecking || isSyncing || isRepairing || globalLoading;

                        return (
                            <TableRow key={stat.year}>
                                <TableCell className="font-medium">{stat.year}</TableCell>
                                <TableCell className="text-muted-foreground text-right">
                                    {stat.count > 0 ? (
                                        <div className="flex flex-col">
                                            <span>{stat.count}</span>
                                            {stat.incompleteCount > 0 && (
                                                <span className="text-[10px] text-amber-500 font-medium">
                                                    ({stat.incompleteCount} incomplete)
                                                </span>
                                            )}
                                        </div>
                                    ) : (
                                        <span className="text-muted-foreground/30">-</span>
                                    )}
                                </TableCell>
                                <TableCell className="text-right">
                                    {result ? (
                                        <span className={cn(
                                            "font-mono",
                                            result.missingIds.length > 0 ? "text-amber-500 font-bold" : "text-green-500"
                                        )}>
                                            {result.stravaCount}
                                        </span>
                                    ) : (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-8 px-2 text-muted-foreground hover:text-foreground"
                                            disabled={isAnyActionPending}
                                            onClick={() => checkMutation.mutate(stat.year)}
                                        >
                                            {isChecking ? (
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                                <span className="flex items-center gap-1 text-xs">
                                                    ?
                                                </span>
                                            )}
                                        </Button>
                                    )}
                                </TableCell>
                                <TableCell className="text-right">
                                    {stat.incompleteCount > 0 && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-7 text-xs border-amber-500/50 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400"
                                            disabled={isAnyActionPending}
                                            onClick={() => repairMutation.mutate(stat.year)}
                                        >
                                            {isRepairing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Activity className="h-3 w-3 mr-1" />}
                                            Repair
                                        </Button>
                                    )}
                                    {result && result.missingIds.length > 0 && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-7 text-xs border-amber-500/50 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400"
                                            disabled={isAnyActionPending}
                                            onClick={() => {
                                                setSyncingYear(stat.year);
                                                syncMissingMutation.mutate({ ids: result.missingIds, year: stat.year });
                                            }}
                                        >
                                            {isSyncing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                                            Sync {result.missingIds.length} Missing
                                        </Button>
                                    )}
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
