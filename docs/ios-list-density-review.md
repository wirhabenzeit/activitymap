# Activity-list density (#255)

Baseline: merged main `c1e8e1d`. Phone rows now put the activity name/local date above aligned primary metric values. The sport badge retains its separate selection action and selected state. Default row spacing is reduced; comfortable density still permits wrapped names, while compact density remains available. No persisted preferences are changed.

Rows below 600pt use this layout; wider lists keep sortable table columns when configured metrics fit. Additional metric configurations retain labels and adaptive stacking. Accessibility text uses the existing full sport/date/time information and stacked labelled values. Unknown and recorded-zero formatting remain unchanged.

The repeated phone overflow button is removed. Tap inspects without selecting. Show on map is available through a non-full-swipe action, the native long-press menu and VoiceOver actions; GPS-less activities cannot issue it. Swipe actions are omitted in horizontally scrolling-metric mode to preserve that gesture. Wide table rows retain their visible actions menu. Phone headers now show selection/count actions and the single View menu for complete sort/column/density options; hidden selection remains disclosed there.

Summaries were deliberately removed by the earlier `b0f5ddf` change. That behavior is preserved rather than reintroducing the stale summary scope in #255. No map-sheet transition work (#284/#285), tablet detail-host redesign (#273), or navigation sizing change is included.

## Matched screenshots

Eight scenes per revision use the same 20-activity fixture. The 402×874 default phone capture shows about one additional complete row (12 instead of 11), plus the next partial row. This is a comparison against the current merged UI, which had already improved on the issue’s original nine-row baseline. Long names and large text may naturally use more height.

| Variant | Before | After |
| --- | --- | --- |
| Phone | ![Before phone](ios-list-density/before-phone.jpg) | ![After phone](ios-list-density/after-phone.jpg) |
| Dark | ![Before dark](ios-list-density/before-phone-dark.jpg) | ![After dark](ios-list-density/after-phone-dark.jpg) |
| Large text | ![Before large text](ios-list-density/before-small-large-text.jpg) | ![After large text](ios-list-density/after-small-large-text.jpg) |
| Tablet | ![Before tablet](ios-list-density/before-tablet.jpg) | ![After tablet](ios-list-density/after-tablet.jpg) |

## Validation

Full simulator suite: **218 tests passed (348 parameterized runs), zero failures**, two opt-in tests skipped. Existing display-sheet coverage now exercises phone and wide layouts, including switching between table/grid while the sheet stays mounted. Coverage includes sorting, preference persistence, null/zero metrics, independent inspection/selection and exact scroll retention with 2,000 lazy rows.

Result: `/tmp/activitymap-navigation-build/Logs/Test/Test-ActivityMap-2026.10.03_09-43-39-+0200.xcresult`. Both eight-capture galleries validated; phone light/dark and large-text captures visually inspected. `git diff --check` passed. Simulator evidence does not replace physical-device touch/VoiceOver acceptance.

Reproduce: `scripts/ios-gallery.sh list-density-review --scene list,list-detail --variant phone,phone-dark,small-large-text,tablet`.
