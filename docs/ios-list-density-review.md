# Activity-list density (#255)

Baseline: merged main `c1e8e1d`. Default row spacing is reduced while preserving aligned columns and directly sortable column headers on phones and tablets whenever the configured metrics fit. Comfortable density still permits wrapped names, while compact density remains available. The sport badge retains its separate selection action and selected state. No persisted preferences are changed.

Additional metric configurations retain adaptive stacking when columns cannot fit. Fallback rows place name/local date above aligned primary values; accessibility text keeps full sport/date/time information and stacked labelled values. Unknown and recorded-zero formatting remain unchanged.

Table rows retain their visible actions menu. Tap inspects without selecting. Show on map is also available through a non-full-swipe action, the native long-press menu and VoiceOver actions; GPS-less activities cannot issue it. Swipe actions are omitted in horizontally scrolling-metric mode to preserve that gesture. The View menu retains complete sort/column/density options, alongside the direct column sorting controls.

Summaries were deliberately removed by the earlier `b0f5ddf` change. That behavior is preserved rather than reintroducing the stale summary scope in #255. No map-sheet transition work (#284/#285), tablet detail-host redesign (#273), or navigation sizing change is included.

## Matched screenshots

Eight scenes per revision use the same 20-activity fixture. Screenshots compare the current merged UI with reduced row padding and restored sortable headers. Long names and large text may naturally use more height.

| Variant | Before | After |
| --- | --- | --- |
| Phone | ![Before phone](ios-list-density/before-phone.jpg) | ![After phone](ios-list-density/after-phone.jpg) |
| Dark | ![Before dark](ios-list-density/before-phone-dark.jpg) | ![After dark](ios-list-density/after-phone-dark.jpg) |
| Large text | ![Before large text](ios-list-density/before-small-large-text.jpg) | ![After large text](ios-list-density/after-small-large-text.jpg) |
| Tablet | ![Before tablet](ios-list-density/before-tablet.jpg) | ![After tablet](ios-list-density/after-tablet.jpg) |

## Validation

After restoring phone headers, targeted simulator suites passed: **40 tests (109 parameterized runs), zero failures**. Coverage includes phone column fit, display-sheet retention across layout changes, sorting, preference persistence, null/zero metrics, independent inspection/selection and exact scroll retention with 2,000 lazy rows.

Result: `/tmp/activitymap-navigation-build/Logs/Test/Test-ActivityMap-2026.10.03_09-50-53-+0200.xcresult`. The earlier iteration also passed the full suite (218 tests, 348 runs); current screenshots and targeted results supersede that iteration's phone layout. Simulator evidence does not replace physical-device touch/VoiceOver acceptance.

Reproduce: `scripts/ios-gallery.sh list-density-review --scene list,list-detail --variant phone,phone-dark,small-large-text,tablet`.
