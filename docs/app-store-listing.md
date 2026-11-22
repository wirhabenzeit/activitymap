# App Store listing and review notes

Source of truth for what is entered in App Store Connect for ActivityMap 1.0
(issue #589). Copy from here, and change it here first so later releases start
from the same text. Character limits are Apple's; the counts below were
measured.

Related: [privacy answers](app-store-privacy.md), the
[iOS README](../ios/ActivityMap/README.md#testflight-releases) (releases), and
[Strava's brand guidelines](https://developers.strava.com/guidelines/).

## Naming and Strava

Strava's guidelines forbid using "Strava" in the app name and require that the
app does not suggest it is made or endorsed by Strava; Apple also rejects
other companies' trademarks in keywords. So **"Strava" does not appear in the
name, subtitle or keywords**. The description refers to it only in plain-text
factual statements and with the sanctioned phrase "Compatible with Strava".

## Metadata

| Field              | Value                                                                                         | Limit |
| ------------------ | --------------------------------------------------------------------------------------------- | ----- |
| App name           | `ActivityMap` (11)                                                                            | 30    |
| Subtitle           | `Your activities on the map` (26)                                                             | 30    |
| Promotional text   | see below (153)                                                                               | 170   |
| Keywords           | see below (94)                                                                                | 100   |
| Primary category   | Health & Fitness                                                                              |       |
| Secondary category | none (Navigation would suggest turn-by-turn directions the app lacks)                         |       |
| Price              | Free, no in-app purchases, no ads                                                             |       |
| Copyright          | `© 2026 Dominik Schröder`                                                                     |       |
| Support URL        | `https://activitymap.cc/support`                                                              |       |
| Privacy Policy URL | `https://activitymap.cc/privacy`                                                              |       |
| Marketing URL      | `https://activitymap.cc/about` (public page, no sign-in needed)                               |       |
| Terms of Use       | `https://activitymap.cc/terms` (optional; add under App Information)                          |       |
| What's New (1.0)   | `First release. Sign in with Strava to see your activities on a map, in a list and in stats.` |       |

**Promotional text**

```
See every run, ride, hike and ski tour on one map, then filter, search and measure them in a list and a stats dashboard. Free, private and offline-ready.
```

**Keywords** (comma-separated, no spaces; words already in the name or category
are not repeated)

```
gpx,routes,heatmap,hiking,running,cycling,skiing,stats,tracks,elevation,summit,peaks,swisstopo
```

## Description (2,262 of 4,000 characters)

```
ActivityMap puts every activity from your Strava account on one map, so you can see where you have really been.

MAP
• All your runs, rides, hikes and ski tours drawn together, colored by sport
• Tap routes to select them, fit them on screen and open their details
• Street, outdoor, satellite and dark maps, plus swisstopo and Norwegian topographic maps with ski, hiking and cycling route overlays
• Tilt to a 3D view, and tap Locate me to center the map where you are
• Photos from your activities appear on the map, with a swipeable gallery

LIST
• Sort and scan your whole history with distance, time and climb at a glance
• Step through activities with Previous and Next, or keep the list beside a detail view on iPad

STATS
• A dashboard of tiles and charts: totals, weekly volume, year to date, records, an activity calendar, sport mix, speed trend and more
• Open any chart to dig in, with the same filters as the map and list

FILTER AND SEARCH
• Filter by sport, date, distance, duration, elevation and activity details
• Search by activity name, or by the name of a summit, pass or hut you passed
• Matched places show which named places each route visited

ACTIVITY DETAILS
• Route, elevation profile and metrics for every activity, and a scrubber that follows your position along the route
• Edit an activity's name, sport or description and send the change back to Strava
• Export a route as GPX, or create a private, expiring link to a map of the tracks you pick, with the start and end of each route hidden by default

PRIVATE BY DESIGN
• Your data is used only to show it back to you: no ads, no tracking, no analytics in the app
• Your library is cached on your device, so you can browse it offline
• Delete your ActivityMap account and data at any time from Settings; your activities on Strava are never touched

ActivityMap works with your own Strava account. Sign in with Strava, approve access, and your activities start arriving right away; a long history can take longer because Strava limits how fast data can be requested.

Compatible with Strava. ActivityMap is an independent app and is not made, endorsed or sponsored by Strava. Maps, elevation and place names are for planning and reflection, not for navigation or safety decisions.
```

Every feature named above exists in the app today. Re-check this list against
the app before each release, and do not advertise anything that is behind a
flag (activity merge and web GPX export are admin-only on the web).

## App Review information

**Sign-in required:** yes. Demo account: `<DEMO ACCOUNT EMAIL>` /
`<DEMO ACCOUNT PASSWORD>` (the Strava account already used for TestFlight; keep
the credentials in App Store Connect only, never in this repository). Before
every submission confirm the account still signs in and still has activities.

**Contact:** the developer's name, phone and `support@activitymap.cc`.

**Notes** (paste into the review notes field):

```
ActivityMap is a viewer for the user's own Strava activities. It has no accounts of its own: users sign in with their Strava account.

How to sign in
1. Open the app and tap "Connect with Strava". If the Strava app is installed it opens there; otherwise a system sign-in sheet opens Strava's own page.
2. Sign in with the demo account above and tap Authorize. You are returned to ActivityMap automatically and the activities load. The first import can take a short while because Strava rate-limits data requests; the map fills in as activities arrive.

Sign in with Apple (guideline 4.8)
The app is a client for a single third-party service, and users must sign in directly to their Strava account to see their own content. It does not offer any other login method, and no personal account system of ours exists to substitute for it.

Account deletion (guideline 5.1.1(v))
Tap the profile picture (or person icon) at the top right to open Settings, then tap "Delete account and data" in the Account section and confirm. This permanently deletes the ActivityMap account, imported activities, photos and share links immediately. It does not delete anything on Strava.

Location
The only location use is the "Locate me" button on the map, which asks for one position while the app is in use and uses it on the device to center the map. It is never sent to us. All other features work if permission is denied.

Data and tracking
No advertising, no tracking, no analytics or crash-reporting SDK in the app, and no in-app purchases. Strava data is shown only to the athlete who authorized it. The privacy policy is at https://activitymap.cc/privacy.

Strava
The app uses Strava's official "Connect with Strava" button and "Powered by Strava" logo, links to activities with "View on Strava", and is approved by Strava for use by multiple athletes.

Devices
iPhone and iPad (universal), iOS 26 or later.
```

## Beta App Review (external TestFlight testers, issue #590)

The first build for an external group goes through Beta App Review, which
checks much of what App Review will. Fill the TestFlight "Test Information"
with:

- **Beta App Description:** `ActivityMap shows your Strava activities on a map, in a list and in stats. Sign in with Strava to try it.`
- **Feedback email:** `support@activitymap.cc`
- **What to Test:** the sign-in checklist from the release notes.
- **Sign-in information:** the same demo account as above.
- **Contact and review notes:** reuse the notes above.

## Age rating

Answer the questionnaire from what the app does. Expected result: **4+**.

| Question                                                     | Answer                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| Violence, sexual content, profanity, horror, drugs, gambling | None                                                          |
| Contests, in-app controls (parental controls, age assurance) | None                                                          |
| Unrestricted web access                                      | No (links open Strava or the website in the system browser)   |
| User-generated content shared with others                    | No: share links are private and the athlete's own tracks only |
| Medical or health-treatment information                      | No: it shows recorded exercise data, not diagnoses or advice  |

Judgement call to re-read at submission: Apple's newer questionnaire has a
"health or wellness topics" question. The app displays exercise metrics, such
as distance and heart rate, but gives no health guidance.

## Other App Store Connect answers

- **Content rights:** the app shows third-party content (the athlete's own
  Strava data, via the Strava API, and map data from OpenStreetMap, MapTiler,
  swisstopo and others). Answer yes and confirm the rights: Strava access is
  covered by the API agreement and the athlete's authorization, and map
  providers' attribution is shown in the map's info menu.
- **Export compliance:** only standard encryption (HTTPS, Keychain); already
  answered in the build through `ITSAppUsesNonExemptEncryption = NO`.
- **App Privacy:** answer from [app-store-privacy.md](app-store-privacy.md).
- **Availability:** all regions, unless a specific one raises a legal question.
- **Release:** choose **phased release for 1.0**: it rolls out over seven days
  and can be paused. Manual release is the alternative if a launch date matters.

## Screenshots

Required sizes: **iPhone 6.9"** (1320 × 2868) and **iPad 13"** (2064 × 2752),
at least three each and ideally five or six. Use the synthetic gallery library,
never a personal one, in light mode for most shots and one in dark. Suggested
scenes, in order:

1. Map with many routes and the layer picker closed
2. Map with a route selected and its results panel
3. Activity detail with elevation profile
4. Stats dashboard
5. List with filters open
6. Map with photos and a place

`scripts/ios-gallery.sh` drives the fixture and `shared/gallery-scenarios.json`
defines the scenes. Do not show the Strava logos in a way that suggests the app
is made by Strava, and do not add "Strava" to the captions (see Naming and
Strava above).

## Marketing page

`https://activitymap.cc/about` (`src/app/about/page.tsx`) is the public page
for the App Store Marketing URL, so anyone can see what ActivityMap looks like
before connecting Strava. Set `APP_STORE_URL` in `src/lib/legal.ts` when the
listing goes live: until then the page says the app is coming soon.

Its screenshots in `public/about/` come from the synthetic gallery library,
never a personal account. To regenerate them in English (the harness defaults to
Swiss German for the owner's reviews), use a throwaway simulator so no installed
build is replaced:

```sh
xcrun simctl create "Gallery" com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro \
  com.apple.CoreSimulator.SimRuntime.iOS-27-0
export TEST_RUNNER_ACTIVITYMAP_GALLERY_LOCALE=en_GB ACTIVITYMAP_GALLERY_LIVE_MAPS=1
scripts/ios-gallery.sh marketing --simulator Gallery \
  --scene map,map-results,list --variant phone,phone-dark
TEST_RUNNER_ACTIVITYMAP_GALLERY_STATS_TILE=records \
  scripts/ios-gallery.sh marketing-stats --simulator Gallery \
  --scene stats-expanded --variant phone,phone-dark
```

Convert the chosen JPEGs with `cwebp -q 82` to `public/about/<name>-light.webp`
and `-dark.webp`. Two quirks: the live map tiles sometimes have not loaded when
a capture is taken, so look at each image; and the dark variant keeps a light
map, so map shots ship without a dark version. `src/lib/legal.test.ts` checks
that every screenshot the page names exists.

## Before submitting

- [ ] Demo account signs in on a clean install of the exact build being submitted
- [ ] The build is one that has been through external TestFlight, and the
      `ios/v1.0.0` tag is cut from the same commit
- [ ] Privacy, support, terms and marketing (`/about`) URLs load without sign-in
- [ ] `APP_STORE_URL` set once the listing is live
- [ ] App Privacy answers match [app-store-privacy.md](app-store-privacy.md)
- [ ] Screenshots uploaded for iPhone 6.9" and iPad 13"
- [ ] Description checked against the app; no advertised feature is missing
- [ ] MapTiler plan, usage alerts and User-Agent restriction confirmed (#588)
