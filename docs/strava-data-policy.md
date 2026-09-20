# Strava Data Policy

Status: **Accepted**

## 1. Access and credentials

- ActivityMap accesses Strava data only for the athlete who authorized it.
- Strava credentials remain server-side. Clients receive only ActivityMap
  credentials and approved response data.
- ActivityMap does not expose Strava data through feeds, search, discovery, or
  a general public API.

## 2. Retention and freshness

- Cached Strava data must be revalidated within seven days.
- Webhooks provide the prompt update path; periodic reconciliation is the
  safety net.

## 3. Deletion and deauthorization

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

## 5. Athlete-directed private sharing

ActivityMap treats deliberate private sharing by the authenticated athlete as
covered by the API Agreement's express-consent provisions.

A private share must:

- contain only activities and fields explicitly selected by the athlete;
- require a separate confirmation before creation;
- use an unguessable token stored server-side only as a hash;
- have a finite expiry and immediate athlete-controlled revocation;
- exclude sensitive and social fields by default;
- be non-indexed and absent from analytics, logs, and referrer headers; and
- grant no account, API, discovery, list, or unrelated-activity access.

The athlete chooses recipients by deciding who receives the link. Broader or
public sharing requires a new policy decision.
