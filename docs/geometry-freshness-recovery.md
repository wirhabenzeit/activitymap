# Geometry freshness recovery

This one-off recovery repairs the false geometry invalidations caused by the
September 20, 2026 summary reconciliation incident.

The source must be a point-in-time Neon branch from before the incident. A row
is eligible only when it was historically detailed, is currently
`refresh_required`, and its owner, map ID, summary polyline, and retained
detailed polyline are all unchanged.

Run the **Recover geometry freshness** workflow against the protected
`Production` environment:

1. Run `audit` and review the aggregate counts and candidate digest.
2. Run `apply` with confirmation `RECOVER_2026_09_20_GEOMETRY`.
3. Run `audit` again; `exactRecoveryCandidates` must be zero.

Each repaired activity and its `sync_change` upsert are written in the same
transaction. Rows that changed after audit are skipped rather than overwritten.
The workflow never prints activity IDs or connection strings.

After verification, delete the recovery branch and remove its temporary GitHub
secret and variables. Rows without an exact historical match remain queued for
normal detail reconciliation.
