// Places the stats tiles on the bento grid from shared/stats-tiles.json.
// Tiles go in manifest order into the first free cell that fits them (like
// CSS `grid-auto-flow: dense`). A span wider than the grid is clamped, so the
// same spans work on the 4-column and 2-column grids. A gap left at the end
// of a row goes to the tile before it.

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
