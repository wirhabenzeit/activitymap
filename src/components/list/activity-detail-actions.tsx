'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { ActivityShareButton } from '~/components/share-button';
import { Button } from '~/components/ui/button';
import type { Activity } from '~/lib/activity';
import { semanticAction } from '~/lib/presentation/icons';
import { message } from '~/lib/presentation/messages';

const tileClass =
  'h-auto min-h-14 w-full justify-start gap-3 whitespace-normal rounded-none px-3 py-3 text-left';

function ActionContent({
  action,
  hint,
}: {
  action: 'edit' | 'shareActivity' | 'exportGPX' | 'openInStrava';
  hint: ReactNode;
}) {
  const { Icon, label } = semanticAction(action);
  return (
    <>
      <Icon
        className="size-4 shrink-0 text-header-background"
        aria-hidden="true"
      />
      <span className="grid gap-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {hint}
        </span>
      </span>
    </>
  );
}

/** Native detail actions, arranged in two columns when the card has room. */
export function ActivityDetailActions({
  activity,
  canEdit,
  editReason,
  onEdit,
  canShare,
  canExport,
  onExport,
}: {
  activity: Activity;
  canEdit: boolean;
  editReason?: string | null;
  onEdit: () => void;
  canShare: boolean;
  canExport: boolean;
  onExport: () => void;
}) {
  return (
    <section
      aria-label="Activity actions"
      className="grid overflow-hidden rounded-lg border @min-[30rem]:grid-cols-2"
    >
      <Button
        type="button"
        variant="ghost"
        className={tileClass}
        disabled={!canEdit}
        onClick={onEdit}
        title={editReason ?? undefined}
      >
        <ActionContent
          action="edit"
          hint={editReason ?? message('activity.edit.subtitle')}
        />
      </Button>
      {canShare && (
        <ActivityShareButton activities={[activity]}>
          <Button type="button" variant="ghost" className={tileClass}>
            <ActionContent
              action="shareActivity"
              hint={message('activity.action.shareHint')}
            />
          </Button>
        </ActivityShareButton>
      )}
      <Button
        type="button"
        variant="ghost"
        className={tileClass}
        disabled={!canExport}
        onClick={onExport}
      >
        <ActionContent
          action="exportGPX"
          hint={message(
            canExport ? 'activity.gpx.shareHint' : 'activity.action.noRoute',
          )}
        />
      </Button>
      <Button variant="ghost" className={tileClass} asChild>
        <Link
          href={`https://strava.com/activities/${activity.id}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ActionContent
            action="openInStrava"
            hint={message('activity.action.stravaHint')}
          />
        </Link>
      </Button>
    </section>
  );
}
