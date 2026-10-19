'use client';

import { Flame, Gauge, Heart, Info, Mountain, Users, Zap } from 'lucide-react';
import type { ReactNode } from 'react';

import { useDisplayUnits } from '~/hooks/use-display-preferences';
import { useFormattingLocale } from '~/hooks/use-display-preferences';
import type { Activity } from '~/lib/activity';
import { activityDetailStats } from '~/lib/activity-detail-stats';
import { message } from '~/lib/presentation/messages';

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
    useFormattingLocale(),
    useDisplayUnits(),
  );
  return (
    <div className="space-y-5">
      <dl
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,6rem),1fr))] gap-2 border-t pt-4"
        aria-label={message('activity.summary')}
      >
        {headline.map((stat) => (
          <div
            key={stat.id}
            className="flex min-w-0 flex-col items-center gap-1 text-center"
          >
            <dt className="text-xs text-muted-foreground">{stat.label}</dt>
            <dd className="order-first text-base font-semibold tabular-nums">
              {stat.id === 'averagePace' ? (
                <>
                  {stat.value.split(' ')[0]}{' '}
                  <span className="whitespace-nowrap">
                    {stat.value.split(' ').slice(1).join(' ')}
                  </span>
                </>
              ) : (
                stat.value
              )}
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
                <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-x-4 gap-y-3">
                  {group.stats.map((stat) => (
                    <div
                      key={stat.id}
                      className="flex min-w-0 flex-col gap-0.5"
                      data-stat={stat.id}
                    >
                      <dt
                        className="text-xs text-muted-foreground"
                        aria-label={message('activity.metric.accessibility', {
                          group: group.title,
                          metric: stat.label,
                        })}
                      >
                        {stat.label}
                      </dt>
                      <dd className="order-first text-sm font-medium break-words tabular-nums">
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
