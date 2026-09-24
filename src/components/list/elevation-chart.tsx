'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { areaY, defineChart, lineY } from '@tanstack/charts';
import { Chart } from '@tanstack/charts/react';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { Loader2 } from 'lucide-react';

import { activityStreamsDTOSchema } from '~/contracts/v1/activity-streams';
import { responseEnvelope } from '~/contracts/v1/envelope';
import { errorEnvelopeSchema } from '~/contracts/v1/error';
import { Button } from '~/components/ui/button';

type StreamResult = {
  profile: { altitude: number[]; distance: number[] } | null;
  pending: boolean;
  retryAfterMs: number;
};

async function fetchStreams(
  activityId: string,
  signal: AbortSignal,
): Promise<StreamResult> {
  const response = await fetch(`/api/v1/activities/${activityId}/streams`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  });
  const body: unknown = await response.json();

  if (!response.ok) {
    const error = errorEnvelopeSchema.safeParse(body);
    if (response.status === 429)
      throw new Error('Stream requests are limited. Try again later.');
    if (response.status === 404)
      throw new Error('Elevation data is unavailable for this activity.');
    throw new Error(
      error.success
        ? error.data.error.message
        : 'Could not load elevation data.',
    );
  }

  const parsed = responseEnvelope(activityStreamsDTOSchema).safeParse(body);
  if (!parsed.success) throw new Error('Could not read elevation data.');

  const retryAfter = Number(response.headers.get('Retry-After'));
  const data = parsed.data.data;
  const altitude =
    data.metadata.state === 'current' ? data.streams?.altitude : undefined;
  const distance =
    data.metadata.state === 'current' ? data.streams?.distance : undefined;
  let profile: StreamResult['profile'] = null;
  // Strava streams can have different sampling. Only pair streams with matching
  // shape and sampling metadata, then verify that distance moves forward.
  if (altitude && distance) {
    const aligned =
      altitude.data.length === distance.data.length &&
      altitude.resolution === distance.resolution &&
      altitude.series_type === distance.series_type &&
      altitude.original_size === distance.original_size &&
      distance.data.every(
        (value, index) => index === 0 || value >= distance.data[index - 1]!,
      );
    if (
      aligned &&
      distance.data.length > 1 &&
      distance.data[distance.data.length - 1]! > distance.data[0]!
    ) {
      profile = { altitude: altitude.data, distance: distance.data };
    }
  }
  return {
    profile,
    pending: response.status === 202,
    retryAfterMs:
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30_000)
        : 3000,
  };
}

function ElevationPlot({
  profile,
}: {
  profile: NonNullable<StreamResult['profile']>;
}) {
  const plot = useMemo(() => {
    const { altitude, distance } = profile;
    const start = distance[0]!;
    const total = distance[distance.length - 1]! - start;
    const axisUnit = total < 1000 ? 'm' : 'km';
    const axisTotal = axisUnit === 'km' ? total / 1000 : total;
    const distanceUnit = axisUnit === 'km' ? 1000 : 1;
    let min = Infinity;
    let max = -Infinity;
    for (const value of altitude) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    const rows = altitude.map((value, index) => ({
      distance: (distance[index]! - start) / distanceUnit,
      altitude: value,
    }));
    const metres = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 0,
    });
    const distanceFormat = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
    });
    const padding = Math.max((max - min) * 0.08, 1);
    const definition = defineChart({
      marks: [
        areaY(rows, {
          x: 'distance',
          y1: min,
          y2: 'altitude',
          fill: 'hsl(var(--primary))',
          fillOpacity: 0.12,
        }),
        lineY(rows, {
          x: 'distance',
          y: 'altitude',
          stroke: 'hsl(var(--primary))',
          strokeWidth: 1.5,
        }),
      ],
      scales: {
        x: {
          scale: scaleLinear().domain([0, axisTotal]),
          axis: {
            line: false,
            ticks: {
              count: 3,
              size: 4,
              format: (value: number) =>
                value === 0
                  ? '0'
                  : `${distanceFormat.format(value)} ${axisUnit}`,
            },
            tickLabels: { fontSize: 12 },
          },
        },
        y: {
          scale: scaleLinear().domain([min - padding, max + padding]),
          grid: { strokeDasharray: '3 4', strokeOpacity: 0.2 },
          axis: {
            line: false,
            ticks: {
              values: min === max ? [min] : [min, max],
              size: 0,
              format: (value: number) => `${metres.format(value)} m`,
            },
            tickLabels: { fontSize: 12, thin: false },
          },
        },
      },
    });
    return {
      min,
      max,
      total,
      definition,
    };
  }, [profile]);

  const metres = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

  return (
    <Chart
      definition={plot.definition}
      height={118}
      initialWidth={304}
      className="w-full text-muted-foreground"
      ariaLabel={`Elevation profile from ${metres.format(plot.min)} to ${metres.format(plot.max)} metres over ${(plot.total / 1000).toFixed(1)} kilometres`}
    />
  );
}

export function ElevationChart({
  activityId,
  userId,
  compact = false,
}: {
  activityId: string;
  userId: string;
  compact?: boolean;
}) {
  const query = useQuery({
    queryKey: ['activity-elevation', userId, activityId],
    queryFn: ({ signal }) => fetchStreams(activityId, signal),
    retry: false,
    // Revalidate on every opening: activity edits can invalidate stored streams.
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: (current) =>
      current.state.status !== 'error' && current.state.data?.pending
        ? current.state.data.retryAfterMs
        : false,
  });

  const profile = query.data?.profile;

  return (
    <section
      className={
        compact ? 'border-t pt-3 lg:border-t-0 lg:pt-0' : 'border-t pt-3'
      }
      aria-label="Elevation profile"
    >
      <h3 className="mb-2 text-sm font-semibold">Elevation profile</h3>
      {query.isError ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{query.error.message}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : query.isPending || query.isFetching || query.data?.pending ? (
        <div
          className="flex items-center gap-2 text-xs text-muted-foreground"
          role="status"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading elevation samples…
        </div>
      ) : profile ? (
        <ElevationPlot profile={profile} />
      ) : (
        <p className="text-xs text-muted-foreground">
          Elevation by distance is unavailable for this activity.
        </p>
      )}
    </section>
  );
}
