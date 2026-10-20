# Activity details and mutation boundaries

Follow-up for #413, coordinated with #411, #417 and #420/#421.

## Client activity data

`src/lib/activity.ts` defines the client projection. It preserves numeric IDs and activity-local `Date` values for existing selection/navigation, explicitly carries stream metadata, and excludes persistence-only timestamps, legacy sharing tokens and completeness flags. DTO conversion happens in `src/lib/sync/v1-mappers.ts`; components do not fabricate database rows. Sport protocol IDs live in the UI-independent `src/contracts/sport.ts`.

Detail and edit components accept an activity and commands. TanStack row adaptation stays in table cells/render callbacks. Stats renders the same activity detail directly, without constructing a synthetic table.

## Editing

The form, v1 API and compatibility server action share editable-field validators. Names accept one non-whitespace character and enforce the same upper bound; descriptions retain deliberate empty strings; sports are checked against protocol IDs. Commands omit fields unchanged from the draft's opening baseline. A later library update must not turn an untouched draft field into an edit.

Saving disables duplicate submission and dismissal. Cancel/Close/Escape confirm a changed draft. User-authored names and descriptions stay verbatim. Server rejection retains the message, request ID, retry deadline and recovery facts. A response indicating that Strava already accepted the edit requires a refresh before another save. This recovery rereads Strava instead of resubmitting the write.

A known denied Strava edit grant disables every Edit entry and Save, with a reconnect explanation. The command rechecks the current grant before sending; a draft opened before permission changed cannot bypass it. Read refresh remains available. Historical unknown grants remain usable, with the server retaining authority. An invalid or wrong-activity success response also requires confirmation by refresh before another edit submission.

## Reconciliation

Focused TanStack mutation hooks use authenticated v1 PATCH/refresh responses, including committed activity data and authoritative complete photo sets. Partial photo responses preserve cached photos and retain their retry metadata.

Response persistence runs through the existing library writer, serialized after any older download and before the next delta pass. One IndexedDB transaction updates the activity, replaces photos only for a complete response, and invalidates its stream summary. It does not advance a sync checkpoint. Missing/deleted activities are not recreated; a response older than the current cached activity cannot overwrite it. Library owners publish the resulting committed snapshot to all consumers.

A remote success followed by local reconciliation failure remains a remote success. The form resets to the returned committed data, and the notice offers local reconciliation retry. That retry never repeats the remote edit. Ordinary sync remains available after a failed response commit. Account/session fencing and the scoped command gate prevent stale work and overlapping same-activity writes; selection, filters and map navigation retain their existing owners.

## Validation

Form-to-command tests cover clearing descriptions, one-character/blank names, length bounds and invalid sports. Mutation tests cover committed responses, partial photos, cache failures, request/retry/recovery facts, serialized downloads and local retry. Session/gate tests cover overlapping commands and account retirement. The browser accessibility fixture exercises real detail/edit components with local API fixtures, including pending/failed saves, keyboard focus, compact/wide/landscape, enlarged text and RTL. See `docs/validation/activity-consistency-accessibility-2026-10-19.md` for evidence and the separate physical-device VoiceOver acceptance boundary.
