# Web List activity inspector — #352

Review: 2026-10-08. Implements the web List activity-detail part of [#351](https://github.com/wirhabenzeit/activitymap/issues/351), as specified in [#352](https://github.com/wirhabenzeit/activitymap/issues/352).

The inspector uses the same activity card and `ActivityDetailStats` as the push view. At **760 px of available content width**, after the filters sidebar or rail, it opens beside the interactive table. Its width is 420–520 px. The table preserves the user's width mode: Fit hides columns that do not fit while reserving name/date; Pin and Scroll retain horizontal scrolling. Width controls work immediately with detail open and keep the selected mode on Close and resize. Fit remains the default. This behavior was requested during review on 2026-10-09. Inspection temporarily reveals name/date and restores saved column visibility on Close. The inspected row has a blue tint, border and leading marker, independently of selection.

The first open in push mode adds a history entry; panel opens and all subsequent inspection steps replace the current entry. `?activity=` restores inspection on reload and preserves unrelated query parameters and the hash. Close on a direct link clears inspection in place. Narrowing shows full-page detail; widening restores the interactive list beside the same activity. This web resize behavior was requested during review on 2026-10-09 and supersedes #352's original iOS push-lock rule. Resizing does not add history entries. An activity opened narrow still returns to the list with Back or Close after widening; Forward restores it using the current width.

Previous/next and ↑/↓ use the filtered, sorted row model before pagination. They cross page boundaries and scroll the inspected row into view. Escape/Close returns focus to the latest inspected row, even if the table was manually paged elsewhere. Menus, Edit, text fields and other widgets retain their own keyboard handling. Filtering out the inspected activity closes detail; a deep link into a later streamed page waits for loading before dismissing a missing identity.

## Captures

| Viewport | Presentation | Capture |
| --- | --- | --- |
| 1440 × 1000 | Side panel | [Desktop](list-inspector-352/web-list-detail--1440x1000.png) |
| 1024 × 768 | Side panel | [Tablet](list-inspector-352/web-list-detail--1024x768.png) |
| 760 × 768 | Push | [Narrow](list-inspector-352/web-list-detail--760x768.png) |
| 402 × 874 | Push | [Phone](list-inspector-352/web-list-detail--402x874.png) |

Captures use the committed 20-activity navigation/gallery fixture, including Lunch Ride from the navigation reference, in Chrome 155.0.8059.39, light appearance, default text size and reduced motion. The temporary fixture route renders the production List, detail, header and sidebar without an account or backend; its navigation tab highlight differs from `/list`. Traversal tests additionally use 205 synthetic copies to exercise the 200-row page boundary.

Pinned scrolling regression captures use the dense fixture at 1440 × 1000: [light](list-inspector-352/web-list-pinned--light.png), [light selected](list-inspector-352/web-list-pinned--light-selected.png), [dark](list-inspector-352/web-list-pinned--dark.png), [dark selected](list-inspector-352/web-list-pinned--dark-selected.png). Inspected cells blend the blue tint into an opaque surface, and pinned cells paint above scrolling cells while staying below the sticky header.

Fixture SHA-256: `4e111e55d17cc53769e5a38fb08c3d50e9d9109be8c208a60c7c4f0e26d0b396`.

## Verification

- 70 focused unit tests pass: inspector threshold, URL parsing, traversal order, activity presentation/detail stats, filters and selection parity.
- Final web CI checks pass: 791 unit tests, 20 Stats UI tests, 2 settings UI tests, repository ESLint and the production build.
- Browser checks pass at all four viewport sizes: keyboard open/close, independent inspection and selection, responsive columns, saved column restoration, sorted/filtered traversal, cross-page stepping, scroll preservation, manual pagination, reload, split-view restoration on widening and Back/Forward. Fit/Pin/Scroll retain the chosen mode across opening, resizing and closing; header and dropdown changes apply immediately, with horizontal scrolling and Name pinning verified.
- Actions-menu and Edit-dialog keyboard checks pass; Show on map remains available in detail. No edit is submitted by the tests.
- TypeScript, targeted ESLint and the Next production build pass. Browser checks report zero page errors; [capture metadata](list-inspector-352/verification.json) records the browser version and run time.

## Reproduce

Start this checkout's Next development server with the local runtime environment configured:

```sh
pnpm exec next dev --hostname 127.0.0.1 --port 3002
```

In another terminal:

```sh
pnpm test:list-ui http://127.0.0.1:3002 /tmp/activitymap-list-inspection
node --import tsx --test src/components/list/inspection.test.ts src/lib/activity-presentation.test.ts src/lib/activity-detail-stats.test.ts src/store/selection.test.ts src/store/filter.test.ts
```

The UI check creates `src/app/list-inspection-test/page.tsx` for the run and removes it on completion or failure. It refuses to overwrite an existing route. Set `CHROME_PATH` when Chrome is installed somewhere other than the default macOS path.
