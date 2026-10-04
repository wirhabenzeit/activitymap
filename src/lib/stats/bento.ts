// Places the stats tiles on the bento grid from shared/stats-tiles.json.
// Tiles go in manifest order into the first free cell that fits them (like
// CSS `grid-auto-flow: dense`). A span wider than the grid is clamped, so the
// same spans work on the 4-column and 2-column grids. A gap left at the end
// of a row goes to the tile before it, unless `fillGaps` is off.

export type BentoSpan = { columns: number; rows: number };

export type BentoPlacement = {
  column: number; // 1-based, as CSS grid lines
  row: number;
  columns: number;
  rows: number;
};

export function placeBento(
  spans: readonly BentoSpan[],
  columns: number,
  { fillGaps = true }: { fillGaps?: boolean } = {},
): BentoPlacement[] {
  const taken: boolean[][] = [];
  const isFree = (row: number, column: number) => !taken[row]?.[column];
  const fits = (row: number, column: number, span: BentoSpan) => {
    for (let r = row; r < row + span.rows; r++)
      for (let c = column; c < column + span.columns; c++)
        if (!isFree(r, c)) return false;
    return true;
  };
  const take = (row: number, column: number, span: BentoSpan) => {
    for (let r = row; r < row + span.rows; r++) {
      taken[r] ??= [];
      for (let c = column; c < column + span.columns; c++) taken[r]![c] = true;
    }
  };

  const placements = spans.map((requested) => {
    const span = {
      columns: Math.max(1, Math.min(requested.columns, columns)),
      rows: Math.max(1, requested.rows),
    };
    for (let row = 0; ; row++) {
      for (let column = 0; column + span.columns <= columns; column++) {
        if (!fits(row, column, span)) continue;
        take(row, column, span);
        return { column: column + 1, row: row + 1, ...span };
      }
    }
  });

  // Close gaps: a tile with free cells to its right, across all its rows,
  // grows into them.
  if (!fillGaps) return placements;
  for (const placement of placements) {
    const rows = Array.from(
      { length: placement.rows },
      (_, index) => placement.row - 1 + index,
    );
    const next = () => placement.column - 1 + placement.columns;
    while (next() < columns && rows.every((row) => isFree(row, next()))) {
      for (const row of rows) take(row, next(), { columns: 1, rows: 1 });
      placement.columns += 1;
    }
  }
  return placements;
}

// Expansion starts at the selected tile's original row. Standalone rows of
// remaining cards share the width evenly; rows crossed by a tall card retain
// their packed geometry. Fractional logical columns map to CSS subcolumns.
export function placeExpandedBento(
  spans: readonly BentoSpan[],
  columns: number,
  expandedIndex: number,
): BentoPlacement[] {
  const collapsed = placeBento(spans, columns);
  if (expandedIndex < 0 || expandedIndex >= spans.length) return collapsed;
  const expandedRow = collapsed[expandedIndex]!.row;
  const order = [
    ...spans.flatMap((_, index) =>
      collapsed[index]!.row < expandedRow ? [index] : [],
    ),
    expandedIndex,
    ...spans.flatMap((_, index) =>
      index !== expandedIndex && collapsed[index]!.row >= expandedRow
        ? [index]
        : [],
    ),
  ];
  const packed = placeBento(
    order.map((index) =>
      index === expandedIndex ? { columns, rows: 1 } : spans[index]!,
    ),
    columns,
  );
  // A tall calendar can leave empty cells below its shorter row-mates when
  // the following expanded tile needs a full row. Stretch those surfaces down
  // only into free cells, preserving the calendar's wider horizontal span.
  for (const item of packed) {
    const bottom = Math.max(
      ...packed
        .filter((other) => other.row === item.row)
        .map((other) => other.row + other.rows),
    );
    while (item.row + item.rows < bottom) {
      const nextRow = item.row + item.rows;
      const blocked = packed.some(
        (other) =>
          other !== item &&
          other.row <= nextRow &&
          other.row + other.rows > nextRow &&
          other.column < item.column + item.columns &&
          other.column + other.columns > item.column,
      );
      if (blocked) break;
      item.rows++;
    }
  }
  for (const row of new Set(packed.map((item) => item.row))) {
    const occupants = packed.filter(
      (item) => item.row <= row && item.row + item.rows > row,
    );
    if (occupants.some((item) => item.rows !== 1)) continue;
    occupants.sort((a, b) => a.column - b.column);
    occupants.forEach((item, index) => {
      item.columns = columns / occupants.length;
      item.column = 1 + index * item.columns;
    });
  }
  const result = new Array<BentoPlacement>(spans.length);
  order.forEach((index, position) => {
    result[index] = packed[position]!;
  });
  return result;
}

// minHeight is a whole-card minimum. A multi-row tile contributes its height
// across its rows after subtracting the gaps inside its span.
export function bentoRowMinimums(
  tiles: readonly { minHeight?: number }[],
  placements: readonly BentoPlacement[],
  rowHeight: number,
  gap: number,
): number[] {
  const count = Math.max(
    0,
    ...placements.map((item) => item.row + item.rows - 1),
  );
  const heights = Array<number>(count).fill(rowHeight);
  placements.forEach((item, index) => {
    const minimum =
      ((tiles[index]?.minHeight ?? 0) - gap * (item.rows - 1)) / item.rows;
    for (let row = item.row - 1; row < item.row + item.rows - 1; row++) {
      heights[row] = Math.max(heights[row]!, minimum);
    }
  });
  return heights;
}
