'use client';

import { Calendar, Mountain, Heart, Zap } from 'lucide-react';

import { Activity } from '~/server/db/schema';
import { categorySettings } from '~/settings/category';
import { Button } from '~/components/ui/button';
import { aliasMap } from '~/settings/category';
import Link from 'next/link';
import { RulerHorizontalIcon, StopwatchIcon } from '@radix-ui/react-icons';

import { type Row } from '@tanstack/react-table';

import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '~/components/ui/hover-card';

import { Card } from '~/components/ui/card';
import { HoverCardPortal } from '@radix-ui/react-hover-card';
import { activityFields } from '~/settings/activity';

type CardProps = React.ComponentProps<typeof Card>;

interface ActivityCardProps extends CardProps {
  row: Row<Activity>;
}

const formattedValue = (key: keyof typeof activityFields, row: Row<Activity>) =>
  activityFields[key].formatter(row.getValue(key));

export function ActivityCard({ row }: ActivityCardProps) {
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
    <div className="flex items-center space-x-2 w-full">
      <Button
        variant={row.getIsSelected() ? 'outline' : 'ghost'}
        size="sm"
        className="h-6 w-6 border"
        onClick={() => row.toggleSelected()}
        aria-label="Select row"
      >
        <Icon color={categorySettings[sport_group].color} />
      </Button>
      <HoverCard>
        <HoverCardTrigger asChild>
          <Button
            asChild
            variant="link"
            className="text-left truncate underline justify-start max-w-full px-0"
            size="sm"
          >
            <Link
              href={`https://strava.com/activities/${row.getValue('id')}`}
              target="_blank"
            >
              {row.getValue('name')}
            </Link>
          </Button>
        </HoverCardTrigger>
        <HoverCardPortal>
          <HoverCardContent className="w-auto max-w-80">
            <div className="flex justify-between space-x-4">
              <Avatar>
                <AvatarFallback>
                  <Icon
                    color={categorySettings[sport_group].color}
                    className="w-6 h-6"
                    height="3em"
                  />
                </AvatarFallback>
              </Avatar>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">
                  {row.getValue('name')}
                </h4>
                <p className="text-sm">{row.getValue('description') || ''}</p>
                {stats.map((stat, index) => (
                  <div className="flex items-center pt-2" key={index}>
                    <stat.icon className="mr-2 h-4 w-4 opacity-70" />{' '}
                    <span className="text-xs text-muted-foreground">
                      {stat.description}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </HoverCardContent>
        </HoverCardPortal>
      </HoverCard>
    </div>
  );
}
