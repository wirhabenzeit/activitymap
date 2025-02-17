'use client';

import { useRouter } from 'next/navigation';
import {
  Calendar,
  Mountain,
  Heart,
  Zap,
  Map,
  Info,
  Loader2,
} from 'lucide-react';

import { type Activity, type Photo } from '~/server/db/schema';
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

import { EditActivity, ProfileForm } from './edit';
import { useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover';
import { type MapRef } from 'react-map-gl/mapbox';
import { useStore } from '~/store';
import { useShallow } from 'zustand/shallow';
import { cn } from '~/lib/utils';
import { type RefObject } from 'react';
import { LngLatBounds } from 'mapbox-gl';
import { useShallowStore } from '~/store';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import {
  Carousel,
  CarouselApi,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '../ui/carousel';

type CardProps = React.ComponentProps<typeof Card>;

interface ActivityCardProps extends CardProps {
  row: Row<Activity>;
  map?: RefObject<MapRef>;
}

interface ActivityMap {
  bbox?: [number, number, number, number];
  polyline?: string;
  summary_polyline?: string;
}

const formattedValue = (key: keyof typeof activityFields, row: Row<Activity>) =>
  activityFields[key].formatter(row.getValue(key));

export function DescriptionCard({ row }: { row: Row<Activity> }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        className="w-full truncate italic h-full flex items-center"
        onDoubleClick={() => setOpen(true)}
      >
        {row.original.description}
      </div>
      <EditActivity row={row} open={open} setOpen={setOpen} trigger={false} />
    </>
  );
}

export function ActivityCardContent({ row }: ActivityCardProps) {
  const [open, setOpen] = useState(false);
  const { loadFromStrava, loading } = useShallowStore((state) => ({
    loadFromStrava: state.loadFromStrava,
    loading: state.loading,
  }));
  const sport_type = row.original.sport_type;
  const sport_group = aliasMap[sport_type];
  const Icon = sport_group ? categorySettings[sport_group].icon : undefined;

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
    await loadFromStrava({ photos: true, ids: [row.original.id] });
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
          <CardDescription>{row.getValue('description') || ''}</CardDescription>
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
          <Button onClick={() => setOpen(true)}>Edit</Button>
          <Button onClick={handleRefresh} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ReloadIcon />
            )}
          </Button>
          <Button variant="outline">
            <Link
              href={`https://strava.com/activities/${row.getValue('id')}`}
              target="_blank"
            >
              View on Strava
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
  const sport_type = row.original.sport_type;
  const sport_group = aliasMap[sport_type];
  const Icon = sport_group ? categorySettings[sport_group].icon : undefined;
  const [highlighted, setHighlighted, setPosition, setSelected] = useStore(
    useShallow((state) => [
      state.highlighted,
      state.setHighlighted,
      state.setPosition,
      state.setSelected,
    ]),
  );
  const { push } = useRouter();

  const handleMapClick = () => {
    const bbox = row.original.map_bbox;
    if (!bbox || bbox.length < 4) {
      console.log('No bbox available for activity');
      return;
    }

    // Create a local copy that TypeScript knows is defined
    const [minLng, minLat, maxLng, maxLat] = bbox as [
      number,
      number,
      number,
      number,
    ];

    setSelected((prev) =>
      prev.includes(Number(row.id)) ? prev : [...prev, Number(row.id)],
    );
    setHighlighted(Number(row.id));

    if (!map) {
      console.log('No map reference available, redirecting to map view');
      const center = [(minLng + maxLng) / 2, (minLat + maxLat) / 2] as [
        number,
        number,
      ];
      const zoom = 13;
      const bounds = new LngLatBounds(
        [minLng, minLat] as [number, number],
        [maxLng, maxLat] as [number, number],
      );
      setSelected([Number(row.id)]);
      setHighlighted(Number(row.id));
      setPosition(
        {
          longitude: center[0],
          latitude: center[1],
          zoom,
          bearing: 0,
          pitch: 0,
          padding: { top: 0, bottom: 0, left: 0, right: 0 },
        },
        bounds,
      );
      push('/map');
      return;
    }
    const bounds = new LngLatBounds(
      [minLng, minLat] as [number, number],
      [maxLng, maxLat] as [number, number],
    );
    map.current?.fitBounds(bounds, { padding: 100 });
  };

  return (
    <>
      <div
        className="flex items-center space-x-2 w-full"
        onDoubleClick={() => setOpen(true)}
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

export function PhotoCard({
  photos,
  title,
}: {
  photos: Photo[];
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [api, setApi] = useState<CarouselApi>();

  return (
    <>
      <div className="flex flex-row items-center gap-2 h-[1.5rem] overflow-x-scroll">
        {photos &&
          photos.map((photo, index) => (
            <Button
              key={photo.unique_id}
              variant="ghost"
              size="icon"
              className="p-0 h-full rounded-sm aspect-square object-cover w-auto"
            >
              <img
                src={photo.urls ? Object.values(photo.urls)[0] : ''}
                alt={photo.caption ?? ''}
                className="h-full rounded-sm aspect-square object-cover"
                onClick={() => {
                  api?.scrollTo(index);
                  console.log(api);
                  setOpen(true);
                }}
              />
            </Button>
          ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="[&>button]:hidden p-0 max-w-2xl">
          <Carousel setApi={setApi}>
            <DialogTitle>{title}</DialogTitle>
            <CarouselContent>
              {photos.map((photo) => (
                <CarouselItem key={photo.unique_id}>
                  <img
                    src={photo.urls ? Object.values(photo.urls).at(-1) : ''}
                    alt={photo.caption ?? ''}
                    className="h-full rounded-sm object-contain"
                  />
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious />
            <CarouselNext />
          </Carousel>
        </DialogContent>
      </Dialog>
    </>
  );
}
