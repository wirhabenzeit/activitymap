# API compatibility and deprecation policy

This document defines what "breaking" means for `/api/v1`, how long a
deprecated endpoint or field stays supported before removal, and how CI
enforces both. It exists so a native (SwiftUI) client can be released
without relying on undocumented behavior - see
docs/swiftui-backend-preparation-plan.md's exit criteria for issue #127.

## Versioning

- Base path: `/api/v1`. The version is a path segment, not a header or a
  query parameter, so it is unambiguous from the URL alone and cacheable/
  routable by ordinary infrastructure.
- Every success response is wrapped in the stable envelope
  (`src/contracts/v1/envelope.ts`):

  ```json
  {
    "schemaVersion": "1",
    "serverTime": "2026-09-20T12:00:00.000Z",
    "data": { ... }
  }
  ```

  `schemaVersion` (`SCHEMA_VERSION` in `src/contracts/v1/primitives.ts`,
  currently `"1"`) is a data-shape version, independent of the `/api/v1`
  path: the path changes when the whole API gets a new major version
  (`/api/v2`); `schemaVersion` exists so a client can detect, defensively,
  that a response's shape does not match what it expects even within the
  same path version - it is not currently incremented on its own schedule,
  and no field has needed a `schemaVersion` bump yet.
- Every error response uses the stable envelope
  (`src/contracts/v1/error.ts`):

  ```json
  {
    "error": {
      "code": "not_authenticated",
      "message": "Authentication is required.",
      "retryable": false,
      "requestId": "...",
      "details": { }
    }
  }
  ```

  `code` is the machine-readable, documented, stable part - safe to branch
  on in client code. `message` is for humans/logs and may be reworded at
  any time without that being a breaking change. `requestId` (issue #127)
  identifies the exact server-side request, for support/bug reports; it is
  also echoed as an `X-Request-Id` response header on every response,
  success or failure (see `src/server/api/observability.ts`).

### Documented error codes

Every code currently in use, so a client can rely on this list rather than
grepping route handlers. A new code may be added at any time (that is
additive, see below); an existing one's meaning never changes, and none is
removed while any shipped client might still depend on it.

| Code | Status | Meaning |
| --- | --- | --- |
| `not_authenticated` | 401 | No valid session or bearer credential was presented. |
| `validation_failed` | 400 | The request body or query parameters failed contract validation; see `details`. |
| `sync_rebootstrap_required` | 409 | The sync cursor is malformed, unsupported, belongs to a different athlete, or is older than the retained change history - see "Forced rebootstrap" in docs/operational-runbook.md. |
| `rate_limited` | 429 | The caller's per-session or per-IP rate limit was exceeded (issue #127); see `Retry-After`. |
| `internal_error` | 500 | The request could not be completed; always `retryable: true`. |

## What counts as a breaking change

A change to `src/contracts/v1/*` (and therefore to `openapi/v1.json`,
generated from it - see `scripts/generate-openapi.ts`) is **breaking** if
an already-shipped client, written against the previous contract, could
misbehave or fail after the change ships server-side, without the client
itself changing. Concretely, for this API:

- Removing a path or an operation (HTTP method on a path).
- Removing a documented response status code from an operation (e.g. a
  client that pattern-matches on `409` for `sync_rebootstrap_required` and
  that response code disappears).
- Removing a field from a response DTO, or renaming one (a rename is a
  remove-plus-add, not an in-place change).
- Tightening a previously-optional request parameter or response field to
  required.
- A field that allowed `null` no longer allowing it (a client that checks
  for `null` and now gets a value it never expected is usually fine; the
  reverse - a field a client always dereferenced now coming back `null` -
  is exactly the "loosened, not tightened" direction and is **not**
  breaking, see below).
- Changing a field's or parameter's declared type (e.g. `string` to
  `number`).
- An endpoint that was public newly requiring authentication.
- Narrowing the accepted values of an enum, or narrowing a numeric/string
  constraint (e.g. a smaller `maximum`, a stricter `pattern`) below what a
  client may already be sending.

The following are **not** breaking - they are the normal, encouraged way to
extend the API, and ship without a version bump:

- Adding a new path, operation, or response status code.
- Adding a new optional request parameter or response field.
- Loosening a previously-required field to optional, or a previously
  non-nullable field to nullable.
- Widening an enum or a numeric/string constraint.
- Adding a new error `code` (an existing one's meaning never changes, but
  the set of codes a client might see can grow).

When a genuinely breaking change is unavoidable, it ships as a new major
version (`/api/v2/...`) alongside the still-supported `/api/v1`, never as
an in-place change to a released `/api/v1` operation or schema.

## Enforcement: the OpenAPI breaking-change check

`openapi.test.ts` already proves the checked-in `openapi/v1.json` matches
what `src/contracts/v1/openapi.ts` currently generates - that is drift
detection, not breaking-change detection. Issue #127 adds the latter:

- `src/contracts/v1/breaking-changes.ts`'s `findBreakingChanges(before,
  after)` compares two versions of the OpenAPI document for the specific
  patterns listed above (removed paths/operations/responses, an endpoint
  that newly requires auth, a parameter or field tightened to required or
  removed outright, a field that stopped allowing `null`, and type
  changes). See that module's doc comment for its precise, honestly-scoped
  coverage - it is a hand-written comparison, not a claim of full OpenAPI/
  JSON-Schema semantics (for example, it does not detect enum-value
  removal or numeric/string constraint tightening, even though those are
  listed as breaking above; those currently rely on review).
- `scripts/check-openapi-breaking-changes.ts` is the CI entry point: it
  compares `openapi/v1.json` as of `origin/main` against the working
  tree's copy and fails the build if anything is found. It is wired into
  `.github/workflows/ci.yml`'s `quality` job, so it runs on every pull
  request and push to `main` - the same gate that actually matters for
  this repository (see docs/database-migrations.md's CI section for the
  sibling migration-safety checks in the same workflow file).
- This is a safety net, not a substitute for judgment: a change the
  checker does not flag can still be breaking in practice (e.g. a
  behavioral change with no schema-visible symptom), and the policy above
  is what a reviewer should apply regardless of what the automated check
  catches.

## Deprecation timeline

There is no shipped native client yet, so no `/api/v1` endpoint or field
has been deprecated so far - this section states the policy for when one
is.

1. **Announce.** Add a `deprecated: true` note to the field/operation in
   `src/contracts/v1/openapi.ts` (OpenAPI's own `deprecated` keyword) and a
   short explanation of the replacement, plus an entry in this document's
   changelog-style list below once one exists.
2. **Dual-support window.** The deprecated surface keeps working, unchanged
   in behavior, for **at least 90 days** after the replacement ships and is
   documented - the same 90-day figure as the sync change-feed's own
   retention window (`DEFAULT_RETENTION_DAYS`,
   `src/server/repositories/changes.ts`), chosen for the same reason: it
   comfortably exceeds how long a mobile client might plausibly go without
   an app update reaching users. A field used by an already-reviewed App
   Store binary should get the longer of 90 days or one full App Store
   review-and-rollout cycle from the deprecation announcement.
3. **Removal.** Only after the window elapses, and only as a breaking
   change following the enforcement path above (i.e. the OpenAPI
   breaking-change check will correctly flag the removal - that check
   failing on a planned, announced removal is expected and is overridden
   deliberately, not silently bypassed).

A deprecated field or operation is never removed early because it looks
unused from server-side telemetry alone: a client that has not made a
request recently is not the same as a client that no longer exists.
