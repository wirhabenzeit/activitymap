/** Pure sizing rules for the map results panel handle (no React, unit-testable). */

export type PanelBounds = { min: number; max: number };

export function clampPanelHeight(height: number, { min, max }: PanelBounds) {
  return Math.round(Math.min(Math.max(height, min), Math.max(min, max)));
}

/** 0 at the collapsed (header only) height, 100 at the tallest height. */
export function panelPercent(height: number, { min, max }: PanelBounds) {
  if (max <= min) return 0;
  return Math.round(
    (Math.min(Math.max(height, min), max) - min) * (100 / (max - min)),
  );
}

/** Where a tap on the handle goes: collapsed panels open fully, others collapse. */
export function tapTarget(height: number, bounds: PanelBounds) {
  return height <= bounds.min + 1 ? bounds.max : bounds.min;
}
