'use client';

import * as d3 from 'd3';
import { useId } from 'react';

import { useElementSize } from '~/hooks/use-element-size';
import type { ComparisonBand } from '~/lib/stats/comparison-band';
import { type Sport, sportOrder } from '~/lib/stats/tile-data';
import { categorySettings } from '~/settings/category';

import type { LineSeries } from './charts';

export type ExplorerColumn = {
  key: number;
  label: string;
  tickLabel?: string;
  x1: number;
  x2: number;
  values: Partial<Record<Sport, number>>;
  previous?: Partial<Record<Sport, number>>;
  incomplete?: boolean;
  disabled?: boolean;
  activityCount?: number;
};
const total = (values: Partial<Record<Sport, number>>) =>
  sportOrder.reduce((sum, sport) => sum + (values[sport] ?? 0), 0);

/** One coordinate system for cumulative comparisons and their contributing bars. */
export function ExplorerChart({
  label,
  series = [],
  band,
  columns,
  domain,
  ticks,
  formatValue,
  formatAxis,
  selected,
  active,
  onActive,
  onSelect,
  comparisonKey,
  onComparison,
  trend = [],
  titles,
  reportingBoundary,
  refined = false,
  comparisonLabel = 'previous year',
}: {
  label: string;
  series?: LineSeries[];
  band?: ComparisonBand;
  columns: ExplorerColumn[];
  domain: [number, number];
  ticks: { x: number; label: string }[];
  formatValue: (value: number) => string;
  formatAxis: (value: number, step: number) => string;
  selected: number | null;
  active: number | null;
  onActive: (key: number | null) => void;
  onSelect: (key: number) => void;
  comparisonKey?: string;
  onComparison?: (key: string | null) => void;
  trend?: { x: number; value: number }[];
  titles?: { cumulative: string; daily: string };
  reportingBoundary?: { x: number; label: string; futureLabel?: string };
  refined?: boolean;
  comparisonLabel?: string;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const width = Math.max(280, Math.floor(size.width) || 720);
  const id = useId();
  const hasLines = series.length > 0;
  const polished = refined || Boolean(titles);
  const height = titles ? 438 : hasLines ? 420 : 320;
  const left = 48;
  const right = width - (titles && width >= 600 ? 110 : 16);
  const x = d3.scaleLinear().domain(domain).range([left, right]);
  const lineTop = titles ? 32 : 16;
  const lineBottom = titles ? 242 : 240;
  const barTop = titles ? 306 : hasLines ? 290 : 16;
  const bottom = height - 30;
  const ymax = Math.max(
    1,
    ...series.flatMap((s) => s.points.map((p) => p.y)),
    ...(band?.points.map((p) => p.high) ?? []),
  );
  const y = d3
    .scaleLinear()
    .domain([0, ymax * 1.06])
    .nice()
    .range([lineBottom, lineTop]);
  const barMax = Math.max(
    1,
    ...columns.flatMap((c) => [total(c.values), total(c.previous ?? {})]),
    ...trend.map((p) => p.value),
  );
  const by = d3
    .scaleLinear()
    .domain([0, barMax * 1.08])
    .nice()
    .range([bottom, barTop]);
  const line = d3
    .line<{ x: number; y: number }>()
    .x((p) => x(p.x))
    .y((p) => y(p.y));
  const current = active ?? selected;
  const column = columns.find((c) => c.key === current);
  const selectedColumn = columns.find((c) => c.key === selected);
  const selectedX = selectedColumn
    ? (selectedColumn.x1 + selectedColumn.x2) / 2
    : null;
  const tickSpacing = Math.max(
    28,
    ...ticks.map((tick) => tick.label.length * 7 + 12),
  );
  const tickStride = Math.max(
    1,
    Math.ceil((ticks.length * tickSpacing) / (right - left)),
  );
  const visibleTicks = ticks.filter((_, index) => index % tickStride === 0);
  const dateTicks =
    polished && selectedX !== null
      ? [
          ...visibleTicks.filter(
            (tick) => Math.abs(x(tick.x) - x(selectedX)) > tickSpacing,
          ),
          {
            x: selectedX,
            label: selectedColumn?.tickLabel ?? String(Math.round(selectedX)),
          },
        ].sort((a, b) => a.x - b.x)
      : visibleTicks;
  const cursor = column ? (column.x1 + column.x2) / 2 : null;
  const stackBars = (
    values: Partial<Record<Sport, number>>,
    bx: number,
    bw: number,
    opacity: number,
  ) => {
    let base = 0;
    return sportOrder.map((sport) => {
      const value = values[sport] ?? 0;
      const bar = (
        <rect
          key={sport}
          x={bx}
          y={by(base + value)}
          width={Math.max(1, bw)}
          height={Math.max(0, by(base) - by(base + value))}
          fill={categorySettings[sport].color}
          opacity={opacity}
        />
      );
      base += value;
      return bar;
    });
  };
  return (
    <div ref={ref} className="min-w-0" data-explorer-chart>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full overflow-visible text-muted-foreground"
        aria-labelledby={id}
        role="group"
        onPointerMove={(event) => {
          if (!hasLines) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const px = ((event.clientX - rect.left) * width) / rect.width;
          const py = ((event.clientY - rect.top) * height) / rect.height;
          if (py >= barTop || px < left || px > right) return;
          const value = x.invert(px);
          const nearest = columns.reduce<ExplorerColumn | undefined>(
            (best, c) =>
              !best ||
              Math.abs((c.x1 + c.x2) / 2 - value) <
                Math.abs((best.x1 + best.x2) / 2 - value)
                ? c
                : best,
            undefined,
          );
          onActive(nearest?.key ?? null);
        }}
        onPointerLeave={() => {
          onActive(null);
          onComparison?.(null);
        }}
      >
        <title id={id}>{label}</title>
        {reportingBoundary && (
          <>
            {reportingBoundary.x < domain[1] && (
              <>
                <rect
                  data-future-region
                  x={x(reportingBoundary.x)}
                  y={barTop}
                  width={right - x(reportingBoundary.x)}
                  height={bottom - barTop}
                  fill="currentColor"
                  opacity={0.06}
                >
                  <title>Future dates · {reportingBoundary.label}</title>
                </rect>
              </>
            )}
            <line
              data-reporting-boundary
              x1={x(reportingBoundary.x)}
              x2={x(reportingBoundary.x)}
              y1={lineTop}
              y2={bottom}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="2 4"
              opacity={0.4}
            />
            <text
              x={
                x(reportingBoundary.x) +
                (x(reportingBoundary.x) - left < 115 ? 5 : -5)
              }
              y={width < 500 ? lineTop + 14 : lineTop - 7}
              textAnchor={x(reportingBoundary.x) - left < 115 ? 'start' : 'end'}
              fill="currentColor"
              fontSize={12}
            >
              {reportingBoundary.label}
            </text>
            {right - x(reportingBoundary.x) > 66 && (
              <text
                x={(x(reportingBoundary.x) + right) / 2}
                y={lineTop - 15}
                textAnchor="middle"
                fill="currentColor"
                fontSize={11}
              >
                {reportingBoundary.futureLabel ?? 'Future days'}
              </text>
            )}
          </>
        )}
        {hasLines && (
          <>
            {titles && (
              <text
                x={left}
                y={18}
                className="fill-foreground"
                fontSize={14}
                fontWeight={600}
              >
                {titles.cumulative}
              </text>
            )}
            {y.ticks(4).map((v, i, values) => (
              <g key={v}>
                <line
                  x1={left}
                  x2={right}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="currentColor"
                  opacity={0.1}
                />
                <text
                  x={left - 8}
                  y={y(v) + 4}
                  textAnchor="end"
                  fill="currentColor"
                  fontSize={polished ? 12 : 10}
                >
                  {formatAxis(v, (values[1] ?? 1) - (values[0] ?? 0))}
                </text>
              </g>
            ))}
            {column && !titles && (
              <rect
                x={x(column.x1)}
                y={16}
                width={Math.max(1, x(column.x2) - x(column.x1))}
                height={lineBottom - 16}
                fill="currentColor"
                opacity={0.05}
              />
            )}
            {band && (
              <path
                data-explorer-band
                d={
                  d3
                    .area<(typeof band.points)[number]>()
                    .x((p) => x(p.x))
                    .y0((p) => y(p.low))
                    .y1((p) => y(p.high))(band.points) ?? ''
                }
                fill="currentColor"
                opacity={0.1}
                stroke="none"
              />
            )}
            {series.map((s) => (
              <g
                key={s.key}
                data-explorer-series={s.key}
                onPointerEnter={() => onComparison?.(s.key)}
                onPointerLeave={() => onComparison?.(null)}
              >
                <path
                  d={line(s.points) ?? ''}
                  fill="none"
                  className={
                    titles && s.role === 'current'
                      ? 'text-header-background'
                      : s.role === 'current'
                        ? 'text-foreground'
                        : 'text-muted-foreground'
                  }
                  stroke="currentColor"
                  strokeWidth={
                    titles && s.role === 'current'
                      ? 3.25
                      : s.role === 'current' || comparisonKey === s.key
                        ? 2.5
                        : 1.5
                  }
                  strokeDasharray={s.role === 'current' ? undefined : '5 4'}
                  opacity={
                    comparisonKey &&
                    comparisonKey !== s.key &&
                    s.role !== 'current'
                      ? 0.35
                      : 1
                  }
                />
                <path
                  d={line(s.points) ?? ''}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16}
                >
                  <title>
                    {`${s.label}: ${formatValue(s.points.at(-1)?.y ?? 0)}`}
                  </title>
                </path>
                {titles &&
                  s.points.length > 0 &&
                  (() => {
                    const last = s.points.at(-1)!;
                    const other = series
                      .find((other) => other.key !== s.key)
                      ?.points.at(-1);
                    const overlap =
                      other &&
                      Math.abs(y(other.y) - y(last.y)) < 20 &&
                      Math.abs(x(other.x) - x(last.x)) < 85;
                    const endpointLabel =
                      s.role === 'current'
                        ? `${s.label} · ${formatValue(last.y)}`
                        : s.label;
                    const room =
                      width - x(last.x) > endpointLabel.length * 7 + 10;
                    return (
                      <g>
                        {s.role === 'current' && (
                          <circle
                            data-current-endpoint
                            cx={x(last.x)}
                            cy={y(last.y)}
                            r={4.5}
                            className="fill-header-background"
                            stroke="hsl(var(--background))"
                            strokeWidth={2}
                          />
                        )}
                        <text
                          x={x(last.x) + (room ? 8 : -4)}
                          y={Math.max(
                            lineTop + 12,
                            y(last.y) +
                              (s.role === 'current'
                                ? y(last.y) < lineTop + 40
                                  ? 20
                                  : -18
                                : overlap
                                  ? 17
                                  : -7),
                          )}
                          textAnchor={room ? 'start' : 'end'}
                          className={
                            s.role === 'current'
                              ? 'fill-header-background'
                              : 'fill-muted-foreground'
                          }
                          fontSize={13}
                          fontWeight={s.role === 'current' ? 600 : 400}
                        >
                          {endpointLabel}
                        </text>
                      </g>
                    );
                  })()}
                {cursor !== null &&
                  (!titles || active !== null) &&
                  (() => {
                    const p = s.points.find((p) => p.x >= cursor);
                    return p ? (
                      <circle
                        cx={x(p.x)}
                        cy={y(p.y)}
                        r={3}
                        fill="currentColor"
                      />
                    ) : null;
                  })()}
              </g>
            ))}
            {titles &&
              dateTicks.map((t) => (
                <text
                  key={t.x}
                  x={x(t.x)}
                  y={lineBottom + 21}
                  textAnchor="middle"
                  fill="currentColor"
                  fontSize={12}
                >
                  {t.label}
                </text>
              ))}
            <text
              x={left}
              y={barTop - (titles ? 22 : 15)}
              className={titles ? 'fill-foreground' : undefined}
              fill={titles ? undefined : 'currentColor'}
              fontSize={titles ? 14 : 11}
              fontWeight={titles ? 600 : undefined}
            >
              {titles
                ? titles.daily
                : columns[0]?.previous
                  ? 'Monthly totals · current / previous year'
                  : 'Daily totals · select a day'}
            </text>
          </>
        )}
        {by.ticks(hasLines ? 2 : 4).map((v, i, values) => (
          <g key={v}>
            <line
              x1={left}
              x2={right}
              y1={by(v)}
              y2={by(v)}
              stroke="currentColor"
              opacity={0.1}
            />
            <text
              x={left - 8}
              y={by(v) + 4}
              textAnchor="end"
              fill="currentColor"
              fontSize={polished ? 12 : 10}
            >
              {formatAxis(v, (values[1] ?? 1) - (values[0] ?? 0))}
            </text>
          </g>
        ))}
        {columns.map((c, index) => {
          const start = x(c.x1),
            span = Math.max(2, x(c.x2) - start),
            padding = Math.min(5, span * 0.14);
          const bw = (span - padding * 2) / (c.previous ? 2 : 1);
          const isActive = current === c.key;
          return (
            <g
              key={c.key}
              role="button"
              aria-label={`${c.label}: ${formatValue(total(c.values))}${c.previous ? `; ${comparisonLabel}: ${formatValue(total(c.previous))}` : ''}${c.incomplete ? '; incomplete' : ''}${c.disabled ? '; upcoming' : ''}`}
              aria-pressed={selected === c.key}
              aria-disabled={c.disabled ? true : undefined}
              tabIndex={
                !c.disabled &&
                (selected === c.key || (selected === null && index === 0))
                  ? 0
                  : -1
              }
              data-explorer-period={c.key}
              data-active={isActive}
              className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring"
              onPointerEnter={() => onActive(c.key)}
              onFocus={() => onActive(c.key)}
              onBlur={() => onActive(null)}
              onClick={() => !c.disabled && onSelect(c.key)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if (!c.disabled) onSelect(c.key);
                  return;
                }
                const direction =
                  getComputedStyle(event.currentTarget).direction === 'rtl'
                    ? -1
                    : 1;
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? columns.map((c) => !c.disabled).lastIndexOf(true)
                      : event.key === 'ArrowRight'
                        ? index + direction
                        : event.key === 'ArrowLeft'
                          ? index - direction
                          : -1;
                if (
                  next < 0 ||
                  next >= columns.length ||
                  columns[next]?.disabled
                )
                  return;
                event.preventDefault();
                (
                  event.currentTarget.parentElement?.querySelector(
                    `[data-explorer-period="${columns[next]!.key}"]`,
                  ) as SVGElement | null
                )?.focus();
              }}
            >
              <rect
                data-selected-day-highlight={
                  polished && selected === c.key ? true : undefined
                }
                x={start}
                y={barTop}
                width={span}
                height={bottom - barTop}
                fill={
                  polished
                    ? selected === c.key
                      ? 'hsl(var(--header-background))'
                      : active === c.key
                        ? 'currentColor'
                        : 'transparent'
                    : isActive
                      ? 'hsl(var(--header-background))'
                      : 'transparent'
                }
                fillOpacity={
                  polished ? (selected === c.key ? 0.06 : 0.04) : 0.09
                }
                stroke={
                  !polished && selected === c.key
                    ? 'hsl(var(--header-background))'
                    : 'none'
                }
                strokeWidth={1}
              />
              {stackBars(
                c.values,
                start + padding,
                bw,
                c.disabled ? 0.15 : c.incomplete ? 0.55 : 0.9,
              )}
              {c.previous &&
                stackBars(c.previous, start + padding + bw, bw, 0.3)}
              {total(c.values) === 0 && !c.disabled && (
                <line
                  x1={start + padding}
                  x2={start + span - padding}
                  y1={bottom - 1}
                  y2={bottom - 1}
                  stroke="currentColor"
                  opacity={0.3}
                />
              )}
            </g>
          );
        })}
        {trend.length > 0 && (
          <path
            d={
              d3
                .line<(typeof trend)[number]>()
                .x((p) => x(p.x))
                .y((p) => by(p.value))(trend) ?? ''
            }
            fill="none"
            className="text-foreground"
            stroke="currentColor"
            strokeDasharray="4 4"
            strokeWidth={1.5}
            pointerEvents="none"
          />
        )}
        {cursor !== null && hasLines && (!titles || active !== null) && (
          <line
            x1={x(cursor)}
            x2={x(cursor)}
            y1={lineTop}
            y2={bottom}
            stroke={titles ? 'currentColor' : 'hsl(var(--header-background))'}
            strokeDasharray="3 3"
            pointerEvents="none"
            opacity={titles ? (active !== null ? 0.3 : 0.14) : 0.6}
          />
        )}
        {titles && active !== null && column && (
          <text
            data-hover-readout
            x={Math.max(left + 60, Math.min(right - 60, x(cursor ?? 0)))}
            y={barTop - 6}
            textAnchor="middle"
            fill="currentColor"
            fontSize={11}
          >
            {column.disabled
              ? `${column.label} · upcoming`
              : `${column.label} · ${formatValue(total(column.values))}`}
          </text>
        )}
        <line
          x1={left}
          x2={right}
          y1={bottom}
          y2={bottom}
          stroke="currentColor"
          opacity={0.4}
        />
        {dateTicks.map((t) => (
          <text
            data-selected-date={
              polished && t.x === selectedX ? true : undefined
            }
            key={t.x}
            x={x(t.x)}
            y={height - 9}
            textAnchor="middle"
            className={
              polished && t.x === selectedX
                ? 'fill-header-background'
                : undefined
            }
            fontWeight={polished && t.x === selectedX ? 600 : undefined}
            fill={polished && t.x === selectedX ? undefined : 'currentColor'}
            fontSize={polished ? 12 : 10}
          >
            {t.label}
          </text>
        ))}
      </svg>
      {!polished && (
        <p
          className={
            titles
              ? 'min-h-5 text-sm text-muted-foreground'
              : 'min-h-5 text-xs text-muted-foreground'
          }
          aria-live="polite"
        >
          {column
            ? `${column.label} · ${formatValue(total(column.values))}${column.previous ? ` · ${comparisonLabel} ${formatValue(total(column.previous))}` : ''}${column.incomplete ? ' · incomplete period' : ''}`
            : 'Hover to compare. Select a bar to inspect its activities.'}
        </p>
      )}
    </div>
  );
}
