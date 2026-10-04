# Independent parity investigations — 2026-10-04

Three GPT-6.1-Sol subagents inspected unrelated issues while #263/#254 was implemented. These findings use merged baseline `49224cdf`; they are source/SDK investigations, not simulator or physical-device verification. No fixes or issue closures are claimed here.

## #286 — dark-mode route colours

**High-confidence cause:** `MapScreen` selects Mapbox Standard `.night` in dark mode, while all six route line layers in `RouteLayers` omit emissive strength. The installed Mapbox SDK 11.31.0 defaults that property to zero. The fixed sport palette has no dark variants. Mapbox explicitly documents custom layers darkening under night lighting and recommends emissive strength 1 for lines: [official iOS style-layer guide](https://docs.mapbox.com/ios/maps/guides/styles/style-layers/).

Proposed focused patch: add `.lineEmissiveStrength(1)` after `.lineColor(...)` to ordinary, selected casing, selected route, active casing, active halo and active route. Start without changing the palette or SDK.

Verify all five sport colours and ordinary/selected/active states on Standard day/night, appearance changes while open, and other base styles/raster overlays. Existing rendered picking tests guard selection/hit behavior but their blank local style cannot prove the night-lighting fix. Assess white-casing brightness on device before further styling.

## #275 — route fit followed by results/detail reveal

Concrete findings:

- The native gallery considers request consumption plus any viewport `.state` sufficient, ignores its map-idle timeout, then reveals the panel and waits a fixed 500 ms. This does not establish a successful intended fit or settled final geometry. Require navigation success, final panel stability and projected-route containment; surface readiness failures.
- The web gallery calls SDK `fitBounds` with a fixed bottom padding of 40% of viewport height, bypassing production UI. It ignores actual results/sidebar/header geometry and uses naive longitude min/max for date-line bounds.
- Production web **Show on map** in `src/components/list/card.tsx` uses bounding-box centre, fixed zoom 12 and zero padding. The gallery therefore does not reproduce that action; large/small routes can be clipped or poorly framed. Reproduce through the actual List action before fixing extent-based framing.
- Native explicit fits now reserve the normal phone opening/medium footprint and wide trailing footprint. Old screenshots alone do not establish a current native regression. Fully expanding the phone panel may intentionally cover routes; resizing must not repeatedly refit.
- Native phone fitting conservatively uses the maximum of legacy medium and actual opening height. This may over-reserve space for single-detail framing, but requires measurement before narrowing it.

Next reproduction: use committed Lunch Ride and four-route scenarios through real UI, invoke Fit route/Fit selection, then compare projected routes with the actual visible rectangle in collapsed and normal-reveal states. Repeat phone/tablet and large text. Update the harness to perform/capture the same operation. Existing renderer tests cover geometry and deferred requests but do not fully certify the production native-sheet fit→reveal flow; some older tablet camera tests still use leading-panel padding.

## #283 — Account and bottom-selection menu animations

The original top-header selection-menu reproduction is superseded. Account is a plain native `Menu` in the persistent shell HStack, with a clipped avatar/fallback glyph. List bulk selection is a custom icon/count/chevron menu in the bottom safe-area bar, inheriting plain button style. Neither opening action mutates app state or applies an explicit SwiftUI animation.

Native menu source-label lifting remains plausible. Async avatar replacement is another Account-only possibility. There is insufficient evidence for a production patch.

Review a current physical Release build, recording commit/device/OS. Capture opening and dismissal video for loaded avatar and fallback icon; List selection with zero, visible and filter-hidden selections; repeat after detail return and with Reduce Motion. Inspect transition frames for label continuity. If reproducible, compare a standard native label with the current custom label before changing the interaction. Applying `.buttonStyle(.plain)` directly to the bottom menu may clarify intent but is expected to match its inherited behavior and is not an established fix.

#273 remains a separate real-iPad/window acceptance task, particularly the sidebar-constrained overlay host and restoration of width, exact scroll position and independent selection.
