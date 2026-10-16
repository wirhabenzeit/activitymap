# Display preferences and metric semantics

Implementation reference for #199 and #299. Login work (#303/#304) and the sync dashboard remain separate.

## Settings

Web and iOS expose these working preferences in Settings → Display:

| Preference | Default | Choices |
| --- | --- | --- |
| Appearance | System | System, Light, Dark |
| Units | Metric | Metric, Imperial |
| Date format | System | System, Day first (31.12.2026), Month first (12/31/2026), ISO (2026-12-31) |

Preferences apply immediately and persist in the current browser/device, independently of account sign-in. They are not synchronized between devices. Web preserves existing theme selections through the existing theme provider; the toolbar theme toggle is removed. System appearance follows OS changes; explicit Light/Dark override it.

System dates follow the browser/device locale. Fixed date formats use Gregorian calendar dates. Activity dates retain the API's activity-local wall time, encoded as UTC; formatting never converts them into the viewer's day. Time-of-day formatting remains locale-controlled. Full dates in activity lists, details, web sharing and Stats honor the preference, including calendar accessibility labels. Compact contextual labels such as chart months, week ranges and month pickers retain their abbreviated presentation. Machine dates, filter boundaries and chronology do not change.

## Measurement contract

| Quantity | Metric | Imperial | Activity precision |
| --- | --- | --- | --- |
| Distance | km | mi | 1 decimal |
| Elevation, including extrema | m | ft | whole number |
| Speed | km/h | mph | 1 decimal |
| Running pace | min/km | min/mi | nearest second, m:ss |
| Swimming pace | min/100 m | min/100 yd | nearest second, m:ss |
| Stats hilliness | m / km | ft / mi | 1 decimal |

A mile is exactly 1609.344 metres; a foot is exactly 0.3048 metres. Durations, power, heart rate and counts retain their existing units. Stats retains its existing whole-number / daily-rate presentation precision, applying conversion before rounding. Native numeric separators remain locale-aware. Compact chart-axis precision follows the interval between ticks after unit conversion, preserving fractional labels (for example 0, 0.5, 1 hours) while retaining thousands abbreviations. Measurements that round to zero never display a negative zero on either platform.

Conversion happens only at presentation and numeric-input boundaries. Activity/API/storage values remain metres, metres/second and seconds; Stats calculation values remain kilometres, metres and hours. Filters preserve their physical thresholds when units change: 10 mi becomes 16.09344 km. Charts retain canonical data and convert labels. Run, TrailRun and VirtualRun details use average pace as a headline; Swim details use pace per 100 metres or 100 yards. Speed stays available in secondary details. The displayed pace is the reciprocal of the recorded speed, with no replacement moving/elapsed-time calculation. Missing, non-finite or non-positive speeds have no usable pace. The hilliness minimum distance remains 5 km (displayed as its imperial equivalent).

## Web list reconciliation

The list follows the shared `shared/parity/activity-fixtures.v1.json` sort and summary examples:

- Default order is numeric ID descending. Missing values sort last in either direction; ties use numeric ID descending.
- Strings compare normalized NFC lowercase Unicode scalar sequences. Geometry states order summary, detailed, refresh_required. Photos sort by metadata count, independently of loaded images.
- Sorting compares unrounded values. Changing units or date format cannot reorder activities. Run-only and swim-only result sets display and sort the existing speed fields as pace (ascending means lower pace first); mixed, other-sport and empty result sets keep speed. Scope is the complete filtered result set, before pagination, and running variants share one pace unit. No preference/schema migration is needed.
- Pace summaries average valid per-activity pace values, excluding non-positive speed. A selected summary containing filter-hidden sports falls back to explicitly labelled speed units when its scope differs from the pace table.
- Summaries distinguish Filtered activities (before pagination), Selected activities (including hidden selections), and This page (data rows only). Labels report scope and hidden-selection counts.
- Means are arithmetic means over recorded values. Empty sums are zero; a nonempty all-unknown scope is unknown. Partial aggregates expose recorded-value coverage through accessible text and tooltips, with an asterisk in the summary.
- Detail fields render independently: missing average power/heart rate/elevation does not hide an available maximum or normalized value. Zero is recorded, not missing.

The web column controls cover ID, name, description, date, distance, moving/elapsed time, elevation gain/high/low, average speed, average/weighted-average/max power, average/max heart rate, photos, geometry, and Edit (unsortable). Native equivalents and continuous-list summary scope are documented in [the parity contract](map-list-parity-contract.md#sort-metrics-and-summary-scope). Only one primary sort is exposed; clearing it restores ID descending.

Native list sorting and aggregation retain their existing implementations; the same display formatters now apply the unit/date preferences.

## Verification

`shared/parity/display-units.v1.json` supplies shared web/Swift measurement and date examples, including zero, missing values, negative elevation, leap day and a year boundary. Web also executes existing shared sort/summary fixtures and checks filter conversion and Stats conversion. Stats rendering tests exercise imperial record values, dates, calendar accessibility and hilliness labels.

Browser review used synthetic gallery activities: preferences persisted after reload; System followed emulated light/dark and Light remained an override; ISO/day-first dates changed immediately; converting a 10-mile filter preserved its physical threshold; a selected activity hidden by filters remained in the selected summary; imperial Stats headlines and axes rendered correctly.

Simulator review captured Settings and list detail in phone, dark and large-text variants. Focused native preferences/list/filter/Stats tests pass. These checks do not replace the broader physical-device, VoiceOver, iPad or performance acceptance tracked separately in #196/#227/#228/#229. Live production map tiles and account/sync operations were not exercised.

Pace examples and mixed-sport scope cases are shared by web and native in `shared/parity/speed-display.v1.json`. Stats tiles and elevation charts currently expose no speed/pace axis, so their metrics are unchanged.
