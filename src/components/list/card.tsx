'use client';

import { useRouter } from 'next/navigation';
import {
  Calendar,
  Mountain,
  Heart,
  Zap,
  ExternalLink,
  Map,
  Info,
  CircleArrowLeft,
} from 'lucide-react';

import { Activity, Photo } from '~/server/db/schema';
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
import { MapRef } from 'react-map-gl/mapbox';
import { useStore } from '~/store';
import { useShallow } from 'zustand/shallow';
import { cn } from '~/lib/utils';
import { type RefObject } from 'react';
import { LngLatBounds } from 'mapbox-gl';

type CardProps = React.ComponentProps<typeof Card>;

interface ActivityCardProps extends CardProps {
  row: Row<Activity>;
  map?: RefObject<MapRef>;
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
  const loadFromStrava = useStore((state) => state.loadFromStrava);
  const sport_type = row.original.sport_type;
  const sport_group = aliasMap[sport_type]!;
  const Icon = categorySettings[sport_group].icon;

  const date = new Date(row.original.start_date_local_timestamp * 1000);
  const stats = [
    {
      icon: Calendar,
      description: date.toLocaleString('en-US'),
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

  return (
    <>
      <Card className="w-auto max-w-80">
        <CardHeader>
          <CardTitle>
            <div className="flex items-center space-x-4">
              <Icon
                color={categorySettings[sport_group].color}
                className="w-6 h-6"
                height="3em"
              />
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
          <Button
            onClick={() =>
              loadFromStrava({ photos: true, ids: [row.original.id] })
            }
          >
            <ReloadIcon />
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
  const sport_group = aliasMap[sport_type]!;
  const Icon = categorySettings[sport_group].icon;
  const [highlighted, setHighlighted, setPosition, setSelected] = useStore(
    useShallow((state) => [
      state.highlighted,
      state.setHighlighted,
      state.setPosition,
      state.setSelected,
    ]),
  );
  const { push } = useRouter();

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
          <Icon color={categorySettings[sport_group].color} />
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
          onClick={() => {
            const bbox = row.original.map?.bbox;
            if (!bbox) {
              console.log('No bbox available for activity');
              return;
            }
            setSelected((prev) =>
              prev.includes(Number(row.id)) ? prev : [...prev, Number(row.id)],
            );
            setHighlighted(Number(row.id));
            console.log('map', map);
            if (!map) {
              console.log(
                'No map reference available, redirecting to map view',
              );
              const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
              const zoom = 12;
              setPosition(
                {
                  longitude: center[0] || 0,
                  latitude: center[1] || 0,
                  zoom,
                  bearing: 0,
                  pitch: 0,
                  padding: { top: 0, bottom: 0, left: 0, right: 0 },
                },
                new LngLatBounds([bbox[0], bbox[1]], [bbox[2], bbox[3]]),
              );
              push('/map');
              return;
            }

            const mapboxInstance = map?.current?.getMap();
            if (!mapboxInstance) {
              console.log('No mapbox instance available');
              return;
            }

            console.log('Fitting bounds to:', bbox);
            mapboxInstance.fitBounds(
              [
                [bbox[0], bbox[1]],
                [bbox[2], bbox[3]],
              ],
              { padding: 50 },
            );
          }}
        >
          <Map className="w-4 h-4 text-primary/50" />
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" className="p-0 h-4" size="sm">
              <Info className="w-4 h-4 text-primary/50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-auto">
            <ActivityCardContent row={row} />
          </PopoverContent>
        </Popover>
        <EditActivity row={row} open={open} setOpen={setOpen} trigger={false} />
      </div>
    </>
  );
}

export function PhotoCard({ photos }: { photos: Photo[] }) {
  console.log(photos);
  return photos ? (
    <div className="flex items-center h-full space-x-2">
      {photos.map((photo) => (
        <img
          src={Object.values(photo.urls)[0]}
          alt={photo.caption ?? ''}
          className="h-full rounded-sm aspect-square object-cover"
        />
      ))}
    </div>
  ) : (
    'No'
  );
}
