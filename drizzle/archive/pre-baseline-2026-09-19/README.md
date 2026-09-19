# Archived pre-baseline schema history

These files describe the database state before ActivityMap adopted replayable
migrations. They are retained for archaeology only and are intentionally outside
the active `drizzle/meta/_journal.json`.

- `0000_lean_warbound.sql` is commented out and could not create an empty
  database.
- `0001_flippant_talon.sql` assumes the commented-out migration already ran.
- `better-auth-migration.sql` was a one-off manual migration.
- `schema.ts`, `relations.ts`, and `meta/` were generated from that obsolete
  history.

Never execute these files as part of the active migration chain.
