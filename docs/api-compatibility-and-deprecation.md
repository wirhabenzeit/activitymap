# API compatibility and deprecation

`/api/v1` is the compatibility boundary for released clients. Successes use
the `schemaVersion`/`serverTime`/`data` envelope; failures use the stable
`error` envelope. `schemaVersion` is currently `"1"` and is a defensive
shape marker, not a separate versioning schedule.

Clients must treat unknown response fields and unknown error codes as
forward-compatible additions.

## Stable error codes

| Code                        | Status | Client action                                      |
| --------------------------- | ------ | -------------------------------------------------- |
| `invalid_request`           | 400    | Fix missing mobile-auth parameters.                |
| `redirect_not_allowed`      | 400    | Use an allow-listed mobile redirect URI.           |
| `validation_failed`         | 400    | Fix the request using `details` when present.      |
| `not_authenticated`         | 401    | Sign in again.                                     |
| `invalid_code`              | 401    | Restart mobile sign-in.                            |
| `expired_code`              | 401    | Restart mobile sign-in.                            |
| `replayed_code`             | 401    | Restart mobile sign-in; codes are single-use.      |
| `state_mismatch`            | 401    | Reject the exchange and restart mobile sign-in.    |
| `pkce_mismatch`             | 401    | Reject the exchange and restart mobile sign-in.    |
| `sync_rebootstrap_required` | 409    | Discard the local sync cursor and bootstrap again. |
| `rate_limited`              | 429    | Wait for `Retry-After`, then retry.                |
| `internal_error`            | 500    | Retry with backoff and retain the request ID.      |

The response `message` is human-readable and may change. `error.requestId`
and the `X-Request-Id` header identify the request in server logs.

## Compatibility rules

A breaking change requires a new major path such as `/api/v2`.

Breaking request changes include removing accepted input, adding a required
input, changing optional input to required, disallowing `null`, narrowing an
enum or constraint, and changing a type.

Breaking response changes include removing a path, operation, status, media
type, schema, or field; changing a required field to optional; newly allowing
`null`; changing a type; and newly requiring authentication.

Adding endpoints, statuses, optional inputs, optional response fields, or new
error codes is non-breaking. For responses, optional-to-required and
nullable-to-non-null are also non-breaking because they strengthen what the
server guarantees.

## Deprecation and CI

Mark deprecated operations or fields in OpenAPI, document the replacement,
and keep them working for at least 90 days. Removal still requires a new major
API version.

CI compares `openapi/v1.json` with `main` and rejects the structural breaking
changes it understands. Enum/constraint changes and behavioral compatibility
still require review.
