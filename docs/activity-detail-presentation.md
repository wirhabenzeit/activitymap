# Activity detail presentation contract

Applies to web Map/List cards and iOS Map/List detail panels. Native controls may differ, but the information hierarchy, grouping, labels and data rules are shared.

## Hierarchy

1. Activity title, sport and activity-local date/time. Keep route/navigation actions in the heading or action bar. On the native map, Fit route sits beside the activity title in portrait, landscape and iPad panels; it must not reserve a footer row.
2. Elevation graph when an elevation profile is available, with its axes and units.
3. Activity description, when present, below the graph. Preserve line breaks; omit blank descriptions.
4. Exactly three headline measurements: **Distance**, **Moving time**, **Elevation gain**, in that order. Use one row at ordinary phone size; reflow for accessibility text sizes. Values are prominent, labels secondary. Do not repeat elapsed time or min/max as headline captions. Missing primary values show an em dash.
5. Topic groups containing the remaining recorded fields, each shown once.
6. Photos, when present.

Collapsed map details reuse the same sport icon, title typography, subtitle spacing and content padding in portrait and landscape. They use a single-line, tail-truncated title with the sport and activity-local date/time beneath it. The full title remains available in the open detail.

The landscape/iPad custom panel uses a stable scrolling viewport with the heading inside its content; the grabber shares the navigation row. Safe-area spacing belongs inside the scroll content, not a fixed bottom strip. Collapsing the panel cancels chart demand/cursors without discarding a valid decoded profile or the scroll position.

The iPhone medium sheet keeps title, graph and headline row together for short or absent descriptions; longer descriptions remain in the same scroll view while the map stays visible. Details continue below in the same scroll view; enlarging the sheet reveals more content. No “All recorded details” or stats disclosure, no separate preliminary summary row above the graph. The compact sheet detent may summarize the activity when the detail content itself is closed. Explicit Fit route/selection commands use the medium (normal opening) detent: keep the profile/results visible and fit the route into the remaining map space. A fully expanded phone sheet returns to this height, never to the collapsed summary.

On web, keep the chart, description and headline row visible when a table row opens. Everything after the headline row (topic groups and photos) goes inside one **Activity details** disclosure, collapsed by default. This keeps inline Map/List rows compact. Individual topic groups have no additional collapsing. iOS keeps all groups open in the scrolling sheet. Map framing is an icon beside the selection close control, not a separate toolbar row.

## Topic groups

Groups have one small neutral icon beside the group title. Substats have no icons. Every substat uses the same compact value-over-label treatment, with two columns in a narrow panel and a single column at accessibility text sizes. Web can put whole groups side by side in a wide card. Group headings and subtle separators establish hierarchy; there are no nested cards or repeated measurements.

| Group | Icon meaning | Fields, in order |
| --- | --- | --- |
| Time & speed | Speedometer | Elapsed time, Average speed, Maximum speed |
| Elevation | Mountain | Minimum, Maximum |
| Power | Bolt | Average, Maximum, Weighted average, Work |
| Heart rate | Heart | Average, Maximum |
| Energy | Flame | Calories |
| Social | People | Kudos, Achievements, Comments, Photos |
| Activity | Information | Commute, Private, Indoor, Manual, Flagged, Geometry status |

Short labels are scoped by their visible group heading. Accessibility combines the group and label where necessary. “Weighted average” refers to the recorded `weighted_average_watts`; do not relabel it “Normalized power” or calculate a replacement.

## Data and formatting

- Use actual activity fields. Moving time is `moving_time`, never `elapsed_time` or a calculated replacement. Elevation gain is `total_elevation_gain`, not profile maximum minus minimum.
- Each field is independently present. Omit missing/nonfinite secondary measurements and empty groups, but preserve measured zero, negative altitude, and recorded false flags (“No”). Missing siblings cannot suppress a valid average, maximum or minimum.
- Headline measurements and activity-local date already shown above are excluded from groups. Do not repeat flags as badges. Description remains available without a duplicate metadata cell.
- Honor saved display preferences: distance uses km/mi with one decimal, speed uses km/h or mph with one decimal, and elevation uses m/ft; power: W; work: kJ; heart rate: bpm; calories: kcal. Put a space between number and unit. Locale controls decimal/grouping separators. Duration uses abbreviated hours/minutes (days/hours for long activities).
- Photo count uses total photo count when supplied, falling back to photo count. Photo thumbnails remain a separate media section.
- Omit internal activity IDs from user-facing details. Keep Edit as a top-level action, without duplicating it in the overflow menu.
- Retain recording/context fields in the final Activity group. Do not silently drop previously accessible fields to make the card shorter.

Implementation: `ActivityMetricGroup` / `ActivityHeadlineStats` on iOS and `activityDetailStats` / `ActivityDetailStats` on web. Group IDs and field IDs are shared across implementations and covered by data tests.

## Elevation graph

- Render the supplied elevation samples as a blue line with a subtle area fill (15% opacity), using linear interpolation. Preserve all samples and gaps in supplied distance; do not smooth, sort, invent altitude, or infer GPS positions.
- Use the same activity accent on both platforms: `#1976d2` in light appearance and `#90caf9` in dark appearance. A selected point and vertical guide identify the sample; the map cursor uses this hue with a white outline and full emissive strength in Mapbox Standard.
- Above the plot, reserve a fixed readout row: **Elevation (m/ft)** on the left, matching the selected units; selected distance and altitude on the right. Example: **91.9 km · 490 m**. Distance uses at most one decimal in km/mi, whole m/ft below 1 km/mi; altitude uses whole m/ft. Keep richer wording in accessibility text only.
- The selected values have primary text on a fully opaque secondary surface in both appearances. They are separate from the plot, never a floating annotation over the fill, grid, line or user's finger. Keep the row's space when no sample is selected so selection does not resize the card.
- Keep numeric axes and grid lines readable. The distance axis starts at zero relative to the first recorded sample. Use round, evenly spaced ticks (roughly 3–5, adapting to width), not an arbitrary midpoint or forced final-distance tick. Center **Distance (km/mi)** or **Distance (m/ft)** below the plot. The y-domain includes at least 5 m padding or 10% of the recorded elevation range, whichever is larger.
- Do not add an “Elevation profile” heading, written min/max sentence, or offline/dragging instructions. Loading, unavailable and retry states reserve the chart's footprint and retain actionable errors.
- On iOS use Swift Charts and its native selection binding; on web support hover, pointer/touch scrubbing and keyboard arrows/Home/End/Escape. Select the nearest recorded distance. Clear selection on release, cancellation, leaving an uncaptured web plot, blur, activity change or disappearance. VoiceOver adjustment can retain a point until cleared.
- The selected route dot follows the matching aligned GPS sample without refitting the camera. If GPS is absent or misaligned, the chart remains usable without a fabricated dot. Filtering, account changes and source invalidation clear or suppress the cursor. Horizontal activity paging yields while scrubbing.
- Normal phone map chart footprint: about 150 pt native / 165 px web, including the readout and axes. Allow text to scale for accessibility. Keep the title, chart and three headline stats visible together in the iPhone middle sheet; grouped details extend below.

## Verification

- Native rendered checks cover the middle sheet and expanded/scrolling detail, chart selection at intermediate/end samples, preserved axes, and the readout above the plot. Test light/dark appearances and actual data differing from profile distance or elapsed time.
- Web browser checks cover phone/wide light/dark rendering, a stable opaque readout outside the plot, round ticks, keyboard/pointer/touch scrubbing, map-dot movement and cursor cleanup. Group mapping tests on both platforms reject duplicate or omitted fields and preserve zero/false values.
- Test the chart over a real detailed map on-device as well: the plot must never paint over readout text, regardless of the map or material underneath.
