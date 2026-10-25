'use client';

import {
  type PointerEvent,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from 'react';

import { PlaceSymbol } from '~/components/place-symbol';
import type { MatchedPlace } from '~/contracts/activity-places';
import { useDisplayUnits } from '~/hooks/use-display-preferences';
import { useElementSize } from '~/hooks/use-element-size';
import { elevationPlaceMarkers } from '~/lib/activity-places';
import type { ElevationProfile } from '~/lib/activity-stream-summary';
import {
  elevationAxisTicks,
  elevationDistanceAxis,
  elevationDistanceLabel,
  elevationSelectionLabel,
  nearestElevationSample,
} from '~/lib/elevation-profile';
import { placeChartSymbol, primaryPlaceKind } from '~/lib/place-symbols';
import { measurementScale, measurementUnit } from '~/lib/units';

const EMPTY_PLACES: MatchedPlace[] = [];

/** Linear, sample-preserving plot with one interaction surface for mouse, touch and keyboard. */
export function ElevationPlot({
  profile,
  height = 177,
  onSelection = () => undefined,
  places = EMPTY_PLACES,
  focusedPlaceKey,
  onPlaceSelect,
  onPlaceDismiss,
  placesStatus,
}: {
  profile: ElevationProfile;
  height?: number;
  onSelection?: (index: number | null) => void;
  places?: MatchedPlace[];
  focusedPlaceKey?: string;
  onPlaceSelect?: (
    marker: ReturnType<typeof elevationPlaceMarkers>[number],
  ) => void;
  onPlaceDismiss?: () => void;
  placesStatus?: ReactNode;
}) {
  const units = useDisplayUnits();
  const [container, { width }] = useElementSize({
    retainSize: true,
    initialWidth: 304,
  });
  // A selection belongs to the profile it was made on: the chart clears the
  // map cursor whenever its profile changes, so the readout clears with it.
  const [selection, setSelection] = useState<{
    profile: ElevationProfile;
    index: number;
  } | null>(null);
  const selected = selection?.profile === profile ? selection.index : null;
  // Last emitted sample, read synchronously so pointer moves within one
  // sample neither re-render nor republish the map cursor.
  const emitted = useRef<{
    profile: ElevationProfile;
    index: number | null;
  }>({ profile, index: null });

  const press = useRef<{
    id: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const dismissPlace = () => {
    setHoveredPlaceKey(null);
    onPlaceDismiss?.();
  };
  const [hoveredPlaceKey, setHoveredPlaceKey] = useState<string | null>(null);
  const placeMarkers = useMemo(
    () => elevationPlaceMarkers(profile, places),
    [profile, places],
  );
  const activePlaceKey = hoveredPlaceKey ?? focusedPlaceKey;
  const activePlace = placeMarkers.find(
    (marker) => marker.key === activePlaceKey,
  );
  const start = profile.distance[0]!;
  const span = profile.distance.at(-1)! - start;
  const elevationDivisor = measurementScale('elevation', units);
  const elevationUnit = measurementUnit('elevation', units);
  const minimum = Math.min(...profile.altitude) / elevationDivisor;
  const maximum = Math.max(...profile.altitude) / elevationDivisor;
  const padding = Math.max(5 / elevationDivisor, (maximum - minimum) * 0.1);
  const headerHeight = 28;
  const plotHeight = height - headerHeight;
  const left = 48,
    right = Math.max(left + 1, width - 12),
    // Leave room above the highest point for the icon and its touch target.
    top = placeMarkers.length ? 40 : 8,
    bottom = plotHeight - 38;
  const { divisor: distanceDivisor, unit: distanceUnit } =
    elevationDistanceAxis(span, units);
  const distanceTicks = elevationAxisTicks(0, span / distanceDivisor);
  const altitudeTicks = elevationAxisTicks(
    minimum - padding,
    maximum + padding,
    3,
  );
  const x = (distance: number) =>
    left + ((distance - start) / span) * (right - left);
  const y = (altitude: number) =>
    bottom -
    ((altitude - minimum + padding) / (maximum - minimum + padding * 2)) *
      (bottom - top);
  const points = profile.distance.map(
    (distance, index) =>
      `${x(distance)},${y(profile.altitude[index]! / elevationDivisor)}`,
  );
  const line = `M${points.join(' L')}`;
  const value = (index: number) =>
    elevationSelectionLabel(
      profile.distance[index]! - start,
      profile.altitude[index]!,
      span,
      units,
    );
  const description = `${elevationDistanceLabel(span, span, units)}, elevation ${minimum.toLocaleString()} to ${maximum.toLocaleString()} ${elevationUnit}`;
  const select = (index: number | null) => {
    if (emitted.current.profile === profile && emitted.current.index === index)
      return;
    emitted.current = { profile, index };
    setSelection(index === null ? null : { profile, index });
    onSelection(index);
  };
  const selectPointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left - left) / (right - left)),
    );
    select(nearestElevationSample(profile, start + fraction * span));
  };

  return (
    <div ref={container} className="relative w-full" style={{ height }}>
      <div
        className="flex h-7 items-center justify-between gap-2 text-xs"
        data-testid="elevation-readout-row"
      >
        {activePlace && selected === null ? (
          <div
            className="flex min-w-0 items-center gap-1.5"
            data-testid="elevation-place-readout"
            role="status"
            style={{
              color:
                focusedPlaceKey === activePlace.key
                  ? 'var(--activity-accent)'
                  : undefined,
            }}
          >
            <PlaceSymbol
              kind={primaryPlaceKind(activePlace)}
              className="size-4 shrink-0"
            />
            <span className="truncate font-medium">{activePlace.name}</span>
            <span className="shrink-0">
              {elevationDistanceLabel(
                activePlace.distanceM - start,
                span,
                units,
              )}{' '}
              ·{' '}
              {Math.round(
                activePlace.altitudeM / elevationDivisor,
              ).toLocaleString()}{' '}
              {elevationUnit}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">
            Elevation ({elevationUnit})
          </span>
        )}
        <div className="flex min-w-0 items-center justify-end">
          <span
            data-testid="elevation-selection-readout"
            aria-hidden="true"
            className="rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground tabular-nums"
            style={{ display: selected === null ? 'none' : undefined }}
          >
            {selected === null ? ' ' : value(selected)}
          </span>
          {selected === null && !activePlace && placesStatus}
        </div>
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label={`Elevation profile, ${description}`}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={profile.distance.length - 1}
        aria-valuenow={selected ?? 0}
        aria-valuetext={selected === null ? description : value(selected)}
        className="relative w-full touch-pan-y rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ height: plotHeight }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          press.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            moved: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          selectPointer(event);
        }}
        onPointerMove={(event) => {
          const origin = press.current;
          if (
            origin?.id === event.pointerId &&
            Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 6
          )
            origin.moved = true;
          if (
            event.pointerType === 'mouse' ||
            event.currentTarget.hasPointerCapture(event.pointerId)
          )
            selectPointer(event);
        }}
        onPointerUp={(event) => {
          const origin = press.current;
          const tapped =
            origin?.id === event.pointerId &&
            !origin.moved &&
            Math.hypot(event.clientX - origin.x, event.clientY - origin.y) <= 6;
          press.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          select(null);
          if (tapped) dismissPlace();
        }}
        onPointerLeave={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId))
            select(null);
        }}
        onPointerCancel={() => {
          press.current = null;
          select(null);
        }}
        onLostPointerCapture={() => {
          press.current = null;
          select(null);
        }}
        onBlur={() => {
          press.current = null;
          select(null);
        }}
        onKeyDown={(event) => {
          let next: number | null;
          switch (event.key) {
            case 'ArrowRight':
            case 'ArrowUp':
              next =
                selected === null
                  ? 0
                  : Math.min(profile.distance.length - 1, selected + 1);
              break;
            case 'ArrowLeft':
            case 'ArrowDown':
              next = Math.max(0, (selected ?? 0) - 1);
              break;
            case 'Home':
              next = 0;
              break;
            case 'End':
              next = profile.distance.length - 1;
              break;
            case 'Escape':
              dismissPlace();
              next = null;
              break;
            default:
              return;
          }
          event.preventDefault();
          select(next);
        }}
      >
        <svg
          data-testid="elevation-plot-area"
          width="100%"
          height={plotHeight}
          aria-hidden="true"
          className="text-muted-foreground"
          style={{ fontSize: 11 }}
        >
          {altitudeTicks.map((altitude) => (
            <g key={altitude}>
              <line
                x1={left}
                x2={right}
                y1={y(altitude)}
                y2={y(altitude)}
                stroke="currentColor"
                strokeOpacity={0.2}
              />
              <text
                x={left - 6}
                y={y(altitude)}
                textAnchor="end"
                dominantBaseline="middle"
                fill="currentColor"
              >
                {altitude.toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                })}
              </text>
            </g>
          ))}
          {distanceTicks.map((distance) => (
            <g key={distance}>
              <line
                x1={x(start + distance * distanceDivisor)}
                x2={x(start + distance * distanceDivisor)}
                y1={top}
                y2={bottom}
                stroke="currentColor"
                strokeOpacity={0.2}
                strokeDasharray="3 4"
              />
              <text
                x={x(start + distance * distanceDivisor)}
                y={bottom + 16}
                textAnchor={distance === 0 ? 'start' : 'middle'}
                fill="currentColor"
              >
                {distance.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </text>
            </g>
          ))}
          <path
            d={`${line} L${right},${bottom} L${left},${bottom} Z`}
            fill="var(--activity-accent)"
            fillOpacity={0.15}
          />
          <path
            d={line}
            fill="none"
            stroke="var(--activity-accent)"
            strokeWidth={2}
          />
          <text
            x={(left + right) / 2}
            y={plotHeight - 2}
            textAnchor="middle"
            fill="currentColor"
          >
            Distance ({distanceUnit})
          </text>
          {placeMarkers.map((marker) => (
            <line
              key={marker.key}
              data-testid="elevation-place-guide"
              x1={x(marker.distanceM)}
              x2={x(marker.distanceM)}
              y1={y(marker.altitudeM / elevationDivisor) - 4}
              y2={bottom}
              stroke="currentColor"
              strokeOpacity={0.16}
              strokeDasharray="2 4"
            />
          ))}
          {selected !== null && (
            <g>
              <line
                x1={x(profile.distance[selected]!)}
                x2={x(profile.distance[selected]!)}
                y1={top}
                y2={bottom}
                stroke="currentColor"
                strokeDasharray="3 3"
              />
              <circle
                cx={x(profile.distance[selected]!)}
                cy={y(profile.altitude[selected]! / elevationDivisor)}
                r={4}
                fill="var(--activity-accent)"
                stroke="hsl(var(--background))"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>
      </div>
      {placeMarkers.map((marker) => {
        const symbol = placeChartSymbol(primaryPlaceKind(marker));
        const label =
          marker.name +
          ' at ' +
          elevationDistanceLabel(marker.distanceM, span, units);
        return (
          <button
            key={marker.key}
            type="button"
            data-testid="elevation-place-marker"
            data-place-id={marker.placeId}
            data-place-name={marker.name}
            data-place-kind={primaryPlaceKind(marker)}
            aria-label={'Highlight ' + label}
            aria-pressed={focusedPlaceKey === marker.key}
            className="group absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none"
            style={{
              left: x(marker.distanceM),
              top:
                headerHeight +
                y(marker.altitudeM / elevationDivisor) -
                symbol.offset,
            }}
            onMouseEnter={() => setHoveredPlaceKey(marker.key)}
            onMouseLeave={() => setHoveredPlaceKey(null)}
            onFocus={() => setHoveredPlaceKey(marker.key)}
            onBlur={() => setHoveredPlaceKey(null)}
            onClick={() => onPlaceSelect?.(marker)}
          >
            <span
              className="flex items-center justify-center rounded-full bg-foreground text-background group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background"
              style={{
                width: symbol.diameter,
                height: symbol.diameter,
                backgroundColor:
                  focusedPlaceKey === marker.key
                    ? 'var(--activity-accent)'
                    : undefined,
                color: focusedPlaceKey === marker.key ? '#ffffff' : undefined,
              }}
            >
              <PlaceSymbol
                kind={primaryPlaceKind(marker)}
                style={{ width: symbol.size, height: symbol.size }}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}
