# Stats header layout review — #403

Reviewed on 18 October 2026 against baseline `cea818c1`.

Compact Training volume, This month, Year to date and Year-end projection now place their metric switch beside the headline value and unit. The period caption supplies “last 28 days”, “so far” or “projection”, avoiding repeated suffixes and keeping the reporting meaning visible. Web wraps the row when it does not fit; native uses `ViewThatFits` and a stacked layout at accessibility text sizes. Existing focus-page headers and calculations remain in place.

Sport mix retains the range switch beside “Moving time”. The switch already names This year / All time, so repeating that range in the caption adds no information. Its full dated caption remains in focus.

## Dashboard audit

| Tile | Decision |
| --- | --- |
| Training volume | Pair headline and metric switch; caption distinguishes the 28-day total from the 12-week chart. |
| This month | Pair headline and metric switch; caption names the months and “so far”. |
| Year to date | Pair headline and metric switch; caption names the years and “so far”. |
| Year-end projection | Pair headline and metric switch; caption names the projection year. |
| Sport mix | Keep caption and range switch together; remove duplicate range text. |
| This week | Retain dates and metric switch together; dates add useful context to the title. |
| Activity calendar | Separate weekday-calendar work owns this tile. |
| Records | No dashboard switch to relocate. |
| Hilliness | No switch to relocate. |
| Typical week | No switch to relocate. |

## Matched captures

Both clients use the 20-activity gallery fixture, reporting day 2026-09-22, and the distance option. Native captures are production tiles at 378pt and default text size; web captures are production cards in the 390px fixture preview.

| Example | Before | After |
| --- | --- | --- |
| Web Training volume | [Before](stats-header-layout-review/before-web-390-weeklyVolume.png) | [After](stats-header-layout-review/after-web-390-weeklyVolume.png) |
| Web This month | [Before](stats-header-layout-review/before-web-390-monthVsLastMonth.png) | [After](stats-header-layout-review/after-web-390-monthVsLastMonth.png) |
| iOS Training volume | [Before](stats-header-layout-review/before-ios-weeklyVolume-collapsed.png) | [After](stats-header-layout-review/after-ios-weeklyVolume-collapsed.png) |
| iOS This month | [Before](stats-header-layout-review/before-ios-monthVsLastMonth-collapsed.png) | [After](stats-header-layout-review/after-ios-monthVsLastMonth-collapsed.png) |
| iOS calendar picker | [Before](stats-header-layout-review/before-ios-activityCalendar-collapsed.png) | [After](stats-header-layout-review/after-ios-activityCalendar-collapsed.png) |

At matched native width, Training volume changes from 326pt to 307pt, This month from 326pt to 317pt, Year to date from 336pt to 317pt, and Year-end projection from 280pt to 270pt. Sport mix remains 282pt. Dashboard grid minimums remain intact; additional space goes to charts where the card height is constrained.

## Verification

- 27 existing web Stats tests, TypeScript and focused ESLint checks passed.
- Chrome: 40 combinations of five tiles, 320/390/834/1440px viewports and metric/imperial units. Every available option responds to keyboard activation, exposes its selected state, and stays on the dashboard. Expansion, focus metric switching and Back work where available. No card horizontal overflow or browser exceptions occurred. A 150% CSS zoom stress pass also fits; this is distinct from a physical-device or assistive-technology review.
- Native simulator: dashboard calculation/state suite (16 tests) and all ten tiles' compact/expanded gallery captures passed. Rendered dashboard checks cover phone, dark mode, 375pt accessibility text, tablet and landscape; overview checks cover phone, accessibility text and wide layouts; the imperial-axis check passed.
- Native navigation passed in portrait, landscape and accessibility text, retaining metric choices through focus and Back. The final pending-metric check passed with stable dashboard height and scroll position. These rendered checks total five test functions with 13 cases.
- This is simulator and browser evidence. Physical iPhone/iPad and VoiceOver acceptance remains separate.

Local full capture matrix and browser interaction details are generated under `/tmp/activitymap-stats-headers`; the portable review entry is `index.html` alongside its before/after folders. The repository examples above retain the representative captures independently of that temporary directory.

## Native picker refinement after device review

The owner accepted the header arrangement and requested less empty space and a more polished picker treatment. Stats choices now size to their labels, with a shallow rounded track and a subtle blue selected state. The forced equal-width metric and Sport mix frames are removed. Each choice retains a separate 44pt touch target and its full accessible label and selected trait. Accessibility text sizes, or widths too narrow for the choices, use a native menu. The calendar's content and layout remain with its separate workstream; only its shared control styling changes here.

Updated native tile captures are under `/tmp/activitymap-stats-pickers/after`; the native After examples above show the refined controls. Existing dashboard and overview rendering checks passed again for phone, tablet, dark mode, landscape and accessibility text.

A focused rendered interaction check also passed: the full metric labels are exposed, every button's accessibility frame is at least 44×44pt, activating Moving time updates the binding, and the selected trait moves from Distance to Moving time.

## Combined calendar build

The initial Dev installs were based on main `cea818c1`, which predates the scrolling calendar in open PR #404. After the owner reported the older calendar, this branch was based on PR #404 head `6bade03e` and the header/picker work was reapplied. The resulting build includes weekday calendar rows, scrollable expanded history, compact active-day/control pairing and the refined picker styling together. The earlier calendar captures above isolate the picker styling before that integration; combined native captures are under `/tmp/activitymap-stats-combined`.

[Combined calendar and picker preview](stats-header-layout-review/combined-ios-activityCalendar-collapsed.png).

Combined validation passed: 34 web Stats/series tests, TypeScript, targeted lint, the browser Stats focus/navigation suite (including weekday alignment, cross-year scrolling, selection, keyboard use and retained scroll), and seven native test functions with ten cases across layout, calendar rendering/scroll retention, picker interaction and tile captures. The native test hosts now wait for the app's window scene so cold-start timing does not cause false failures before rendering begins.
