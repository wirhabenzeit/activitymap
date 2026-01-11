'use client';

import {
  Calendar,
  Mountain,
  Heart,
  Zap,
  Map,
  Info,
  Loader2,
  Download,
} from 'lucide-react';
import { decode } from '@mapbox/polyline';
import GeoJsonToGpx from '@dwayneparton/geojson-to-gpx';
import type { Feature, LineString } from 'geojson';

import { type Activity } from '~/server/db/schema';
import { categorySettings } from '~/settings/category';
import { Button } from '~/components/ui/button';
import { aliasMap } from '~/settings/category';
import Link from 'next/link';
import {
  ReloadIcon,
  RulerHorizontalIcon,
  StopwatchIcon,
} from '@radix-ui/react-icons';

import { type Row } from '@tanstack/react-table';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { activityFields } from '~/settings/activity';

import { EditActivity } from './edit';
import { useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover';
import { type MapRef } from 'react-map-gl/mapbox';
import { cn } from '~/lib/utils';
import { type RefObject } from 'react';
import { LngLatBounds } from 'mapbox-gl';
import { useShallowStore } from '~/store';
import { PhotoLightbox } from './photo';
import { useRouter } from 'next/navigation';

type CardProps = React.ComponentProps<typeof Card>;

interface ActivityCardProps extends CardProps {
  row: Row<Activity>;
  map?: RefObject<MapRef | null>;
}

const formattedValue = (key: keyof typeof activityFields, row: Row<Activity>) =>
  activityFields[key].formatter(row.getValue(key));

export function DescriptionCard({ row }: { row: Row<Activity> }) {
  const [open, setOpen] = useState(false);
  const isGuest = useShallowStore((state) => state.isGuest);

  return (
    <>
      <div
        className="w-full truncate italic h-full flex items-center"
        onDoubleClick={() => !isGuest && setOpen(true)}
      >
        {row.original.description}
      </div>
      <EditActivity row={row} open={open} setOpen={setOpen} trigger={false} />
    </>
  );
}

import { usePhotos } from '~/hooks/use-photos';
import { useQueryClient } from '@tanstack/react-query';
import { fetchStravaActivities } from '~/server/strava/actions';
import { useToast } from '~/hooks/use-toast';

export function ActivityCardContent({ row }: ActivityCardProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { isGuest, account } = useShallowStore((state) => ({
    isGuest: state.isGuest,
    account: state.account,
  }));
  const { data: allPhotos = [] } = usePhotos();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const sport_type = row.original.sport_type;
  const sport_group = aliasMap[sport_type];
  const Icon = sport_group ? categorySettings[sport_group].icon : undefined;
  const activityId = row.original.id;

  const photos = allPhotos.filter(
    (p) => p.activity_id === activityId,
  );

  const id: number = row.getValue('id');

  const date = row.original.start_date_local;
  const stats = [
    {
      icon: Calendar,
      description: date.toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    },
    {
      icon: StopwatchIcon,
      description: `${formattedValue('moving_time', row)} (moving), ${formattedValue('elapsed_time', row)} (elapsed)`,
    },
    {
      icon: RulerHorizontalIcon,
      description: formattedValue('distance', row),
    },
    {
      icon: Mountain,
      description: `+${formattedValue('total_elevation_gain', row)} (${formattedValue('elev_high', row)} max, ${formattedValue('elev_low', row)} min)`,
    },
    ...(row.getValue('average_heartrate')
      ? [
        {
          icon: Heart,
          description: `${formattedValue('average_heartrate', row)} (avg), ${formattedValue('max_heartrate', row)} (max)`,
        },
      ]
      : []),
    ...(row.getValue('weighted_average_watts')
      ? [
        {
          icon: Zap,
          description: `${formattedValue('weighted_average_watts', row)} (norm), ${formattedValue('average_watts', row)} (avg), ${formattedValue('max_watts', row)} (max)`,
        },
      ]
      : []),
  ];

  const handleRefresh = async () => {
    if (!account) return;
    setLoading(true);
    try {
      await fetchStravaActivities({
        accessToken: account.access_token!,
        athleteId: parseInt(account.providerAccountId),
        activityIds: [row.original.id],
        includePhotos: true,
      });

      await queryClient.invalidateQueries({ queryKey: ['activities'] });
      await queryClient.invalidateQueries({ queryKey: ['photos'] });

      toast({
        title: 'Activity Refreshed',
        description: 'Successfully refreshed activity data from Strava.',
      });
    } catch (error) {
      console.error(error);
      toast({
        title: 'Error',
        description: 'Failed to refresh activity.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadGpx = () => {
    const polyline =
      row.original.map_polyline ?? row.original.map_summary_polyline;
    if (!polyline) return;

    // Decode polyline to coordinates
    const coordinates = decode(polyline).map(([lat, lon]) => [lon, lat]);
    const name: string = row.getValue('name');

    // Create GeoJSON object
    const geojson: Feature<LineString> = {
      type: 'Feature',
      properties: {
        name,
        time: row.original.start_date.toISOString(),
      },
      geometry: {
        type: 'LineString',
        coordinates,
      },
    };

    // Convert to GPX with metadata
    const options: { metadata: { name: string; time: string; desc?: string } } =
    {
      metadata: {
        name: String(row.getValue('name')),
        time: row.original.start_date.toISOString(),
        desc: row.original.description ?? undefined,
      },
    };

    const gpx = GeoJsonToGpx(geojson, options);
    const gpxString = new XMLSerializer().serializeToString(gpx);

    // Create and trigger download
    const blob = new Blob([gpxString], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Card className="w-auto max-w-80 border-none shadow-none">
        <CardHeader>
          <CardTitle>
            <div className="flex items-center space-x-4">
              {Icon && sport_group && (
                <Icon
                  color={categorySettings[sport_group].color}
                  className="w-6 h-6"
                  height="3em"
                />
              )}
              <div>{row.getValue('name')}</div>
            </div>
          </CardTitle>
          <CardDescription>
            {row.getValue('description') ?? ''}
            {photos && photos.length > 0 ? (
              <div className="pt-4">
                <PhotoLightbox
                  photos={photos}
                  title={row.getValue('name')}
                  className="h-[3rem]"
                />
              </div>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {stats.map((stat, index) => (
              <div className="flex items-center pt-2" key={index}>
                <stat.icon className="mr-2 h-4 w-4 opacity-70" />{' '}
                <div className="text-xs text-muted-foreground">
                  {stat.description}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
        <CardFooter className="flex justify-between space-x-1">
          <Button onClick={() => setOpen(true)} disabled={isGuest}>
            Edit
          </Button>
          <Button onClick={handleRefresh} disabled={loading || isGuest}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ReloadIcon />
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleDownloadGpx}
            disabled={
              !row.original.map_polyline && !row.original.map_summary_polyline
            }
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="outline">
            <Link href={`https://strava.com/activities/${id}`} target="_blank">
              Strava
            </Link>
          </Button>
        </CardFooter>
      </Card>
      <EditActivity row={row} open={open} setOpen={setOpen} trigger={false} />
    </>
  );
}

export function ActivityCard({ row, map }: ActivityCardProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { highlighted, setHighlighted, isGuest, setPosition, setSelected } = useShallowStore((state) => ({
    highlighted: state.highlighted,
    setHighlighted: state.setHighlighted,
    isGuest: state.isGuest,
    setPosition: state.setPosition,
    setSelected: state.setSelected,
  }));

  const sport_type = row.original.sport_type;
  const sport_group = aliasMap[sport_type];
  const Icon = sport_group ? categorySettings[sport_group].icon : undefined;

  const handleMapClick = () => {
    const bbox = row.original.map_bbox;
    if (!bbox || bbox.length < 4) return;

    if (map?.current) {
      // Create a bounds object with the bbox coordinates
      const bounds = new LngLatBounds(
        [bbox[0], bbox[1]] as [number, number],
        [bbox[2], bbox[3]] as [number, number],
      );
      map.current.fitBounds(bounds, { padding: 50 });
      setHighlighted(row.original.id);
    } else {
      // If map is not available, navigate to the map page
      // Create a bounds object with the bbox coordinates
      const bounds = new LngLatBounds(
        [bbox[0], bbox[1]] as [number, number],
        [bbox[2], bbox[3]] as [number, number],
      );

      // Create a viewport state centered on the bounds
      const center = bounds.getCenter();
      const viewState = {
        longitude: center.lng,
        latitude: center.lat,
        zoom: 12, // Default zoom level
        bearing: 0,
        pitch: 0,
        padding: { top: 0, bottom: 0, left: 0, right: 0 }
      };

      // Set the position in the store
      setPosition(viewState, bounds);
      setSelected((selected) => selected.includes(row.original.id) ? selected : [...selected, row.original.id]);
      setHighlighted(row.original.id);

      // Navigate to the map page
      router.push('/map');
    }
  };

  return (
    <>
      <div
        className="flex items-center space-x-2 w-full"
        onDoubleClick={() => !isGuest && setOpen(true)}
      >
        <Button
          variant={row.getIsSelected() ? 'outline' : 'ghost'}
          size="sm"
          className="h-6 w-6 border"
          onClick={() => row.toggleSelected()}
          aria-label="Select row"
        >
          {Icon && sport_group && (
            <Icon
              color={categorySettings[sport_group].color}
              className="w-6 h-6"
              height="3em"
            />
          )}
        </Button>
        <div
          className={cn(
            'text-left truncate justify-start max-w-full',
            highlighted === Number(row.id)
              ? 'text-header-background'
              : 'text-primary',
          )}
        >
          {row.getValue('name')}
        </div>
        <div className="flex-1" />
        <Button
          variant="ghost"
          className="px-0 h-4"
          size="sm"
          onClick={handleMapClick}
        >
          <Map className="h-4 w-4" />
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" className="px-0 h-4" size="sm">
              <Info className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-auto">
            <ActivityCardContent row={row} />
          </PopoverContent>
        </Popover>
      </div>
      <EditActivity row={row} open={open} setOpen={setOpen} trigger={false} />
    </>
  );
}
