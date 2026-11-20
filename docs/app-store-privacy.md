# App Store privacy answers

Source for the App Store Connect **App Privacy** questionnaire and the app's
`ios/ActivityMap/ActivityMap/PrivacyInfo.xcprivacy` (issue #586). Keep this,
the manifest and the public [privacy policy](<../src/app/(legal)/privacy/page.tsx>)
in agreement: a change to what the app or server collects updates all three.

Public URLs for App Store Connect (production host `https://activitymap.cc`):

| Field            | URL                              |
| ---------------- | -------------------------------- |
| Privacy Policy   | `https://activitymap.cc/privacy` |
| Support URL      | `https://activitymap.cc/support` |
| Terms (optional) | `https://activitymap.cc/terms`   |

## Tracking

**No tracking.** `NSPrivacyTracking` is `false` with no tracking domains. The
app has no advertising identifier, no analytics SDK and no crash-reporting SDK,
and ActivityMap never links its data with data from other companies' apps or
websites. (The _website_ uses Vercel Web Analytics and Speed Insights; they are
cookieless and not part of the iOS app.)

## Data collected

"Collected" follows Apple's definition: data that leaves the device and is
stored on our servers beyond servicing the request. Every item is **linked to
the user** (it belongs to their account), **not used for tracking**, and has the
single purpose **App Functionality**.

| Apple category                      | Manifest type                                   | What it is                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contact Info > Name                 | `NSPrivacyCollectedDataTypeName`                | Display name from the Strava profile.                                                                                                                         |
| Contact Info > Email Address        | `NSPrivacyCollectedDataTypeEmailAddress`        | Only if Strava returns one with the profile (it normally does not); otherwise a synthetic placeholder is stored. Declared so the label stays true either way. |
| Identifiers > User ID               | `NSPrivacyCollectedDataTypeUserID`              | ActivityMap user ID and Strava athlete ID.                                                                                                                    |
| Health & Fitness > Fitness          | `NSPrivacyCollectedDataTypeFitness`             | Sport, distance, time, elevation, heart rate and power from imported Strava activities.                                                                       |
| Location > Precise Location         | `NSPrivacyCollectedDataTypePreciseLocation`     | GPS routes and streams of imported activities. This is recorded activity data, **not the phone's location**.                                                  |
| User Content > Photos or Videos     | `NSPrivacyCollectedDataTypePhotosorVideos`      | Photo records from the user's Strava activities, shown through Strava's image servers.                                                                        |
| User Content > Other User Content   | `NSPrivacyCollectedDataTypeOtherUserContent`    | Activity names and descriptions, share-link selections.                                                                                                       |
| Diagnostics > Other Diagnostic Data | `NSPrivacyCollectedDataTypeOtherDiagnosticData` | Server request logs (route, status, duration) with credentials and share tokens redacted.                                                                     |

Not collected: phone number, physical
or mailing address, contacts, browsing or search history, purchases, financial
or health records beyond the fitness data above, sensitive information,
advertising data, product-interaction analytics, crash data, or the device's
own location. **Locate me** asks iOS for one position and uses it on the device
to centre the map; it is never uploaded.

Judgement calls worth re-checking at submission: server logs include the
request's network address on the hosting provider's side; this is treated as
operational diagnostics rather than an identifier, and is disclosed in the
privacy policy.

## Required-reason APIs

Declared in the manifest after scanning the app's own sources and the symbols
of a Debug build (`nm -u` on `ActivityMap.debug.dylib`):

| Category                                     | Reason   | Why                                                                                            |
| -------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `NSPrivacyAccessedAPICategoryUserDefaults`   | `CA92.1` | Browsing, display and map preferences and the cached session identity, read by the app itself. |
| `NSPrivacyAccessedAPICategoryFileTimestamp`  | `C617.1` | File metadata of the app's own container (SwiftData store, photo cache).                       |
| `NSPrivacyAccessedAPICategorySystemBootTime` | `35F9.1` | Elapsed-time measurement (`clock_gettime_nsec_np`), for timeouts and the sync client.          |

`MapLibre.framework` ships its own `PrivacyInfo.xcprivacy`. `convex-swift` and
its Rust core do not, so their use of these APIs is covered by the app's
manifest above. The disk-space and active-keyboard categories are not used.

## Verify before each submission

1. Archive, then in Xcode Organizer choose **Generate Privacy Report** and compare
   it with the manifest. Anything the report adds, or any new SDK, means this
   page and the policy need updating.
2. `plutil -lint ios/ActivityMap/ActivityMap/PrivacyInfo.xcprivacy`
3. Re-answer the App Store Connect questionnaire from the table above whenever
   the manifest changes, and bump `LEGAL_LAST_UPDATED` in `src/lib/legal.ts`.
