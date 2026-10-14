# Native activity editing — #220

The shared Map/List/Stats detail now exposes a name/description/sport editor. Wide headings show Edit beside Show on map; compact headings and pushed toolbars use the activity-actions menu. The form sends only changed fields to the existing authenticated PATCH endpoint, including an explicit empty description when clearing it.

Saving waits for an existing activity sync, then commits the authoritative result without moving the feed cursor. Older activity rows in a delayed feed or replacement snapshot cannot regress the committed result; later rows and tombstones still apply. Existing source-change invalidation, filter membership, map sport colors, inspection and selection reconciliation remain authoritative.

## Automated evidence

Xcode 27 / iOS 27 simulators, unsigned test host, synthetic activity/HTTP fixtures:

- iPhone 18 Pro: editing model, HTTP transport, rendered form and affected LocalStore, SyncController, SyncEngine, snapshot and summary-cache suites passed. Result: `/tmp/activitymap-editing-final.xcresult`.
- iPad Pro 11-inch (M5): rendered editor/action-layout suite passed, including normal phone/tablet sizes, larger accessibility text and preserved server-error input. Result: `/tmp/activitymap-editing-ipad-final.xcresult`.
- Rendered PNGs under `/tmp/activitymap-editing-preview` were visually inspected. These show the form and action placement; they do not certify tapping through every production presentation host.
- `git diff --check` passed. The generated DTO and backend contract are unchanged.

Tests cover changed-field omission and clearing a description; API validation limits; rate-limit and 503 deadlines; offline drafts; ambiguous-save recovery; duplicate submission; durable reopen; unchanged cursors; older/newer activity ordering; deletion/recreation and account switching; session expiry and 401 cleanup; and failed local-write rollback.

## Remaining owner/device review

- Open Edit from phone Map sheets, pushed List/Stats detail and the iPad pane; test sport-picker navigation, keyboard handling, cancellation/discard confirmation, and rotation.
- Save a chosen test activity to real Strava; verify name, cleared description and sport there, after native relaunch and on web. Check filter-hidden detail closure and route color after a sport change.
- Review VoiceOver traversal, error/success announcements and keyboard/large-text behavior on a physical device. This implementation's rendered checks are supporting evidence for #387, not accessibility acceptance.

No real Strava activity was modified during automated validation. Per-activity refresh, GPX/Open in Strava and private sharing retain their separate owners.

## Device-feedback polish — 14 October

The owner's Dev 3951 screenshot exposed inherited white toolbar styling, including unreadable Cancel and sport values. The editor now owns its semantic foreground, brand tint and navigation-bar appearance. Cancel stays blue; enabled Save is a blue capsule with white text, and disabled Save retains a readable label. Toolbar labels stay on one line, with native-sized scaling independent of the larger form text.

Name is explicitly labelled, Sport has the category icon and a visible selected value, and a searchable grouped sport screen replaces the automatic picker. Description uses a shorter growing input. Rendered regression scenarios include inherited white foreground/tint, Ride, light/dark appearance, larger text, unsaved changes and a retained server-error draft; captures were visually inspected. Follow-up test result: `/tmp/activitymap-editing-polish-final.xcresult`.
