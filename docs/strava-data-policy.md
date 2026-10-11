# Strava Data Policy

Status: **Accepted**

## 1. Access and credentials

- ActivityMap accesses Strava data only for the athlete who authorized it.
- Strava credentials remain server-side. Clients receive only ActivityMap
  credentials and approved response data.
- ActivityMap does not expose Strava data through feeds, search, discovery, or
  a general public API.

## 2. Retention and freshness

- Cached Strava data must be revalidated within seven days. The server
  enforces this: the hourly summary reconciliation re-reads each connected
  athlete's activity summaries at least once every seven days (a new scan
  starts after six days, so a multi-run scan finishes inside the limit). A
  changed summary invalidates the affected detail geometry and streams, which
  are then fetched again.
- Webhooks provide the prompt update path; periodic reconciliation is the
  safety net.
- Clients do not enforce their own expiry. The web cache and the native app
  mirror the server: whenever they are connected they apply its upserts and
  tombstones from their saved change cursor. A device that stays offline keeps
  its last copy and receives changes, deletions and deauthorization when it
  next connects. Sign-out, sign-in expiry and Strava disconnection clear it.

## 3. Deletion and deauthorization

- Account settings on web and iOS offer **Delete account and data**, with an
  explicit permanent-deletion confirmation. `POST /api/v1/account/delete`
  authenticates the current session, requires `{ "confirmation": "DELETE" }`,
  and accepts no target user ID. Cookie requests require a same-origin `Origin`;
  native clients use signed bearer authentication.
- User-requested deletion runs immediately through the same transactional cleanup
  as scheduled erasure. It removes the account, all sessions, imported activities,
  photos, streams, share links, ingestion/sync state, webhook records and associated
  verification records. It does not delete original activities on Strava. A later
  sign-in creates a fresh ActivityMap account and import.
- The initiating client clears its offline data before finishing. Web also clears
  the service-worker shell/static caches and notifies other open tabs. Other
  devices learn of revoked sessions when they next contact the server; an offline
  device cannot receive the deletion immediately. In-flight imports recheck the
  original account identity before committing, so a fresh signup cannot receive
  work started for the deleted account.

- Data deleted or made unavailable on Strava must be removed promptly and no
  later than 48 hours after ActivityMap learns of the change.
- Deauthorization stops credential use immediately, invalidates share links,
  and schedules permanent deletion of Strava-derived data within 30 days.

## 4. Storage

- Better Auth-native account fields are the canonical Strava credential
  representation.
- Offline clients store only the authenticated athlete's scoped data and clear
  it on logout, account change, deauthorization, or server tombstones.
- Logs and analytics must redact credentials, private share tokens, and other
  secrets.

## 5. Athlete-directed private track sharing

The authenticated athlete can share a private, read-only map of the tracks of
activities they select. Shared tracks are still Strava-derived data;
ActivityMap treats deliberate private sharing by the athlete as covered by the
API Agreement's express-consent provisions.

A share discloses a fixed, track-level allow-list for each selected activity:
the route line, its elevation profile (elevation and position by distance),
name, sport type, start date and time, distance, moving time, elevation gain
and average speed. It never discloses heart rate, power or
calories; kudos, comments, achievements or other athletes; descriptions,
photos, gear or device metadata; or exact start and end coordinates. The
allow-list is enforced server-side in `src/contracts/share/activity.ts`.

A private share must:

- contain only activities explicitly selected by the athlete;
- require a separate confirmation before creation that restates what will be
  shown;
- hide the first and last 200 m of each route and elevation profile by
  default, trimmed before they leave the server; showing the full route is an
  explicit opt-in;
- use an unguessable token stored server-side only as a hash;
- have a finite expiry of at most 30 days and immediate athlete-controlled
  revocation;
- be non-indexed and absent from analytics, logs, and referrer headers; and
- grant no account, API, discovery, list, or unrelated-activity access.

The athlete chooses recipients by deciding who receives the link. Broader or
public sharing requires a new policy decision.
