# Activity detail presentation contract

Applies to web Map/List cards and iOS Map/List detail panels. Native controls may differ, but the information hierarchy, grouping, labels and data rules are shared.

## Hierarchy

1. Activity title, sport and activity-local date/time. Native headers contain identity and direct previous/next navigation only. Edit and Show on map belong to the shared scrolling action rows; Map keeps Fit route in its persistent results header. On web, wide rows keep Edit beside the map action; narrower rows move Edit into the ••• menu alongside Strava refresh, GPX and Open in Strava.
2. Elevation graph when an elevation profile is available, with its axes and units.
3. Activity description, when present, below the graph. Preserve line breaks; omit blank descriptions.
4. Exactly three headline measurements: **Distance**, **Moving time**, **Elevation gain**, in that order for speed-based sports. Run, TrailRun, VirtualRun and Swim replace the third headline with **Average pace**; elevation gain moves to the Elevation group. Use one row at ordinary phone size; reflow for accessibility text sizes. Values are prominent, labels secondary. Do not repeat elapsed time or min/max as headline captions. Missing primary values show an em dash.
5. Topic groups containing the remaining recorded fields, each shown once.
6. Photos, when present.
7. On native iOS, **Edit activity**, **Show on map** (outside Map), **Share activity**, **Open in Strava** and **Export GPX** rows at the bottom of the scrolling detail, without an actions heading or explanatory paragraph below the rows. The GPX subtitle is “Route with elevation”, “Route only”, or “No GPS route”; sampling and offline details stay out of the action label. GPX includes elevation when the current cache contains paired GPS/altitude summary values, exporting a labelled sampled route with averaged elevation. These are the chart cache’s bucket averages, not raw per-point readings. Otherwise it preserves the chosen detailed/simplified cached route with elevation unavailable. There is no further interpolation, invented altitude or recorded timestamp output. Activities without any cached GPS have a disabled export row and an explanation in its subtitle. Sharing uses the native sheet on iPhone and a popover anchored to the export row on iPad.

Web **Download GPX** downloads a file; native **Share GPX** opens the system share sheet (the detail row remains labelled **Export GPX**). Native row menus and detail rows share one offline availability/export workflow. A current paired GPS/elevation summary can supply a route even when there is no activity polyline. The first menu opening uses a cheap availability preflight; detached validation chooses valid sampled data or the cached polyline fallback before writing. Invalid samples with no fallback produce the same explicit no-GPS explanation. Account scope, activity revision and summary freshness fence both successful and failed work. Temporary files remain leased by the native presenter until sharing/dismissal finishes.

Collapsed map details reuse the same sport icon, title typography, subtitle spacing and content padding in portrait and landscape. They use a single-line, tail-truncated title with the sport and activity-local date/time beneath it. The full title remains available in the open detail.

In pushed native List detail, Show on map is a labelled scrolling action row below the measurements and photos. It switches directly to Map and closes List inspection in one transaction without a Back animation; the retained Map results sheet must not appear over an outgoing List page. Failed/missing-route actions leave List detail open. Other Map/tab actions keep their existing behavior.

Explicit route fits ease the camera and final results-panel padding together over 500 ms. The viewport change runs in its own update after navigation/results layout commits, so that update cannot discard the Mapbox animation. Superseded camera transitions and transitions queued before tab departure, style changes or account-scope resets are discarded. Fitting switches to Mercator only when necessary. Rendered List-to-Map coverage checks intermediate cameras, retained renderer identity and final route containment with both Mercator and globe starting styles.

The landscape/iPad custom panel uses a stable scrolling viewport with the heading inside its content; the grabber shares the navigation row. Safe-area spacing belongs inside the scroll content, not a fixed bottom strip. Collapsing the panel cancels chart demand/cursors without discarding a valid decoded profile or the scroll position.

The iPhone medium sheet keeps title, graph and headline row together for short or absent descriptions; longer descriptions remain in the same scroll view while the map stays visible. Details continue below in the same scroll view; enlarging the sheet reveals more content. No “All recorded details” or stats disclosure, no separate preliminary summary row above the graph. The compact sheet detent fits only the activity heading or one selection count; omit repeated counts and expansion instructions. Hide detail navigation only while collapsed. Pull-for-next works at the normal opening height and the fully expanded height, using the same shared scroll policy as List. Portrait lists scroll through the bottom safe area, with end spacing inside the scroll content rather than a fixed empty strip. Explicit Fit route/selection commands use the medium (normal opening) detent: keep the profile/results visible and fit the route into the remaining map space. A fully expanded phone sheet returns to this height, never to the collapsed summary.

On web, keep the chart, description and headline row visible when a table row opens. Everything after the headline row (topic groups and photos) goes inside one **Activity details** disclosure, collapsed by default. This keeps inline Map/List rows compact. Individual topic groups have no additional collapsing. iOS keeps all groups open in the scrolling sheet. Map framing is an icon beside the selection close control, not a separate toolbar row.

## Topic groups

Groups have one small neutral icon beside the group title. Substats have no icons. Every substat uses the same compact value-over-label treatment, with two columns in a narrow panel and a single column at accessibility text sizes. Web can put whole groups side by side in a wide card. Group headings and subtle separators establish hierarchy; there are no nested cards or repeated measurements.

| Group                                     | Icon meaning | Fields, in order                                                     |
| ----------------------------------------- | ------------ | -------------------------------------------------------------------- |
| Time & speed (Time & pace for runs/swims) | Speedometer  | Best pace for runs/swims, Elapsed time, Average speed, Maximum speed |
| Elevation                                 | Mountain     | Minimum, Maximum                                                     |
| Power                                     | Bolt         | Average, Maximum, Weighted average, Work                             |
| Heart rate                                | Heart        | Average, Maximum                                                     |
| Energy                                    | Flame        | Calories                                                             |
| Social                                    | People       | Kudos, Achievements, Comments, Photos                                |
| Activity                                  | Information  | Commute, Private, Indoor, Manual, Flagged, Geometry status           |

Short labels are scoped by their visible group heading. Accessibility combines the group and label where necessary. “Weighted average” refers to the recorded `weighted_average_watts`; do not relabel it “Normalized power” or calculate a replacement.

## Data and formatting

- Use actual activity fields. Moving time is `moving_time`, never `elapsed_time` or a calculated replacement. Elevation gain is `total_elevation_gain`, not profile maximum minus minimum.
- Each field is independently present. Omit missing/nonfinite secondary measurements and empty groups, but preserve measured zero, negative altitude, and recorded false flags (“No”). Missing siblings cannot suppress a valid average, maximum or minimum.
- Headline measurements and activity-local date already shown above are excluded from groups. Do not repeat flags as badges. Description remains available without a duplicate metadata cell.
- Run/TrailRun/VirtualRun pace uses min/km or min/mi; Swim uses min/100 m or min/100 yd. Round the reciprocal of recorded speed to whole seconds before splitting into m:ss. Average pace is the headline, best pace derives from maximum speed, and original speed remains secondary. Non-positive/non-finite/missing speed has no pace.
- Honor saved display preferences: distance uses km/mi with one decimal, speed uses km/h or mph with one decimal, and elevation uses m/ft; power: W; work: kJ; heart rate: bpm; calories: kcal. Put a space between number and unit. Locale controls decimal/grouping separators. Duration uses abbreviated hours/minutes (days/hours for long activities).
- Photo count uses total photo count when supplied, falling back to photo count. Photo thumbnails remain a separate media section.
- Omit internal activity IDs from user-facing details. Keep Edit as a top-level action, without duplicating it in the overflow menu.
- Retain recording/context fields in the final Activity group. Do not silently drop previously accessible fields to make the card shorter.

Native editing is available from the shared Edit activity row at the bottom of Map, List and Stats detail. Headers reserve space for identity and direct navigation. The form edits name, description and sport, with validation, explicit saving/error states, unchanged-field omission and deliberate empty-description clearing. Its submitted write finishes even if the committed sport/name makes the source detail filter-hidden. Cancel confirms discarding a changed draft; saving blocks dismissal and duplicate submission. See [the native editing behavior](../ios/ActivityMap/README.md#edit-an-activity-in-strava).

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
