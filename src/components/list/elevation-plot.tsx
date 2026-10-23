'use client';

import { type PointerEvent, useMemo, useRef, useState } from 'react';

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
import { measurementScale, measurementUnit } from '~/lib/units';

const EMPTY_PLACES: MatchedPlace[] = [];

/** Linear, sample-preserving plot with one interaction surface for mouse, touch and keyboard. */
export function ElevationPlot({
  profile,
  height = 165,
  onSelection = () => undefined,
  places = EMPTY_PLACES,
  focusedPlaceKey,
}: {
  profile: ElevationProfile;
  height?: number;
  onSelection?: (index: number | null) => void;
  places?: MatchedPlace[];
  focusedPlaceKey?: string;
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

  const placeMarkers = useMemo(
    () => elevationPlaceMarkers(profile, places),
    [profile, places],
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
    top = 8,
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
    if (
      !event.currentTarget.hasPointerCapture(event.pointerId) &&
      event.clientY < bounds.top + headerHeight
    ) {
      select(null);
      return;
    }
    const fraction = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left - left) / (right - left)),
    );
    select(nearestElevationSample(profile, start + fraction * span));
  };

  return (
    <div
      ref={container}
      role="slider"
      tabIndex={0}
      aria-label={`Elevation profile, ${description}`}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={profile.distance.length - 1}
      aria-valuenow={selected ?? 0}
      aria-valuetext={selected === null ? description : value(selected)}
      className="relative w-full touch-pan-y rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ height }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        selectPointer(event);
      }}
      onPointerMove={(event) => {
        if (
          event.pointerType === 'mouse' ||
          event.currentTarget.hasPointerCapture(event.pointerId)
        )
          selectPointer(event);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        select(null);
      }}
      onPointerLeave={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId))
          select(null);
      }}
      onPointerCancel={() => select(null)}
      onLostPointerCapture={() => select(null)}
      onBlur={() => select(null)}
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
            next = null;
            break;
          default:
            return;
        }
        event.preventDefault();
        select(next);
      }}
    >
      <div
        className="flex h-7 items-center justify-between gap-2 text-xs"
        data-testid="elevation-readout-row"
      >
        <span className="text-muted-foreground">
          Elevation ({elevationUnit})
        </span>
        <span
          data-testid="elevation-selection-readout"
          aria-hidden="true"
          className="rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground tabular-nums"
          style={{ visibility: selected === null ? 'hidden' : 'visible' }}
        >
          {selected === null ? '\u00a0' : value(selected)}
        </span>
      </div>
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
              {altitude.toLocaleString(undefined, { maximumFractionDigits: 1 })}
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
              {distance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
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
          <g
            key={marker.key}
            data-testid="elevation-place-marker"
            data-place-id={marker.placeId}
            data-place-name={marker.name}
          >
            <title>{marker.name}</title>
            <line
              x1={x(marker.distanceM)}
              x2={x(marker.distanceM)}
              y1={y(marker.altitudeM / elevationDivisor)}
              y2={bottom}
              stroke={focusedPlaceKey === marker.key ? '#f97316' : '#0f766e'}
              strokeOpacity={0.4}
              strokeDasharray="2 3"
            />
            <circle
              cx={x(marker.distanceM)}
              cy={y(marker.altitudeM / elevationDivisor)}
              r={focusedPlaceKey === marker.key ? 6 : 4.5}
              fill={focusedPlaceKey === marker.key ? '#f97316' : '#0f766e'}
              stroke="hsl(var(--background))"
              strokeWidth={2}
            />
            {focusedPlaceKey === marker.key && (
              <text
                x={Math.max(left + 4, Math.min(right - 4, x(marker.distanceM)))}
                y={Math.max(
                  top + 10,
                  y(marker.altitudeM / elevationDivisor) - 10,
                )}
                textAnchor={
                  x(marker.distanceM) > (left + right) / 2 ? 'end' : 'start'
                }
                fill="hsl(var(--foreground))"
                stroke="var(--background)"
                strokeWidth={3}
                paintOrder="stroke"
                fontSize={11}
              >
                {marker.name}
              </text>
            )}
          </g>
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
  );
}
