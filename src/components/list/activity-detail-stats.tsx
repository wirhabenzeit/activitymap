'use client';

import { useDisplayUnits } from '~/hooks/use-display-preferences';
import type { ReactNode } from 'react';
import { Flame, Heart, Info, Mountain, Users, Zap, Gauge } from 'lucide-react';
import type { Activity } from '~/server/db/schema';
import { activityDetailStats } from '~/lib/activity-detail-stats';

const icons = {
  'time-speed': Gauge,
  elevation: Mountain,
  power: Zap,
  'heart-rate': Heart,
  energy: Flame,
  social: Users,
  activity: Info,
};

export function ActivityDetailStats({
  activity,
  photos,
}: {
  activity: Activity;
  photos?: ReactNode;
}) {
  const { headline, groups } = activityDetailStats(
    activity,
    undefined,
    useDisplayUnits(),
  );
  return (
    <div className="space-y-5">
      <dl
        className="grid grid-cols-3 gap-2 border-t pt-4"
        aria-label="Activity summary"
      >
        {headline.map((stat) => (
          <div
            key={stat.id}
            className="flex min-w-0 flex-col items-center gap-1 text-center"
          >
            <dt className="text-xs text-muted-foreground">{stat.label}</dt>
            <dd className="order-first text-base font-semibold tabular-nums">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="space-y-5">
        <div className="grid gap-x-6 gap-y-5 @2xl:grid-cols-2">
          {photos}
          {groups.map((group) => {
            const Icon = icons[group.id as keyof typeof icons];
            return (
              <section
                key={group.id}
                className="min-w-0 border-t pt-3"
                aria-label={group.title}
              >
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {group.title}
                </h3>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  {group.stats.map((stat) => (
                    <div
                      key={stat.id}
                      className="flex min-w-0 flex-col gap-0.5"
                      data-stat={stat.id}
                    >
                      <dt className="text-xs text-muted-foreground">
                        {stat.label}
                      </dt>
                      <dd className="order-first break-words text-sm font-medium tabular-nums">
                        {stat.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
