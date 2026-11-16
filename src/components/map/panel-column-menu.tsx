'use client';

import { Columns3 } from 'lucide-react';

import {
  PreferenceMenuCheckboxItem,
  PreferenceMenuContent,
} from '~/components/preference-menu';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { activityFields } from '~/settings/activity';
import { useShallowStore } from '~/store';

/** Never offered in the panel: not metrics, or too wide for it. */
const FIXED_HIDDEN = [
  'id',
  'description',
  'photos',
  'geometry_state',
  'edit',
] as const;

const DEFAULT_VISIBLE = new Set(['distance', 'total_elevation_gain']);

const choosable = (
  Object.keys(activityFields) as (keyof typeof activityFields)[]
).filter((id) => !(FIXED_HIDDEN as readonly string[]).includes(id));

/**
 * The route panel starts with name, distance and elevation. Whatever the
 * athlete chooses in the menu below is kept in the compact list state and
 * overrides these starting columns.
 */
export function panelColumnVisibility(
  chosen: Record<string, boolean>,
): Record<string, boolean> {
  return {
    ...Object.fromEntries(
      Object.keys(activityFields).map((id) => [id, DEFAULT_VISIBLE.has(id)]),
    ),
    ...chosen,
    ...Object.fromEntries(FIXED_HIDDEN.map((id) => [id, false])),
    name: true,
  };
}

export function PanelColumnMenu({ className }: { className?: string }) {
  const { chosen, setColumnVisibility } = useShallowStore((state) => ({
    chosen: state.compactList.columnVisibility,
    setColumnVisibility: state.compactList.setColumnVisibility,
  }));
  const visibility = panelColumnVisibility(chosen);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className}
          aria-label="Choose columns"
          title="Choose columns"
        >
          <Columns3 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <PreferenceMenuContent align="end" className="w-56">
        {choosable.map((id) => (
          <PreferenceMenuCheckboxItem
            key={id}
            checked={visibility[id] !== false}
            onCheckedChange={(checked) =>
              setColumnVisibility((previous) => ({
                ...panelColumnVisibility(previous),
                [id]: checked === true,
              }))
            }
          >
            {activityFields[id].title}
          </PreferenceMenuCheckboxItem>
        ))}
      </PreferenceMenuContent>
    </DropdownMenu>
  );
}
