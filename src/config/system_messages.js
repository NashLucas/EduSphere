// ─────────────────────────────────────────────────────────────────────────────
// User-facing message strings — TRD §6, task 2.2.
//
// Every string a client can read lives here rather than at the call site that
// happens to need it. Three reasons, in order of how much they matter:
//
// 1. SOME OF THESE STRINGS ARE PUBLISHED CONTRACT. docs/apidoc.md quotes them
//    verbatim in its response examples, so rewording one silently breaks any
//    client asserting on it. Those are marked "apidoc" below and must not be
//    edited without editing the document too.
// 2. One name, one wording. Two endpoints that both fail to find a course should
//    not answer "Course not found" and "No course with that slug exists".
// 3. It is the only seam an i18n layer could ever hook. Strings scattered across
//    forty service files cannot be swapped for a translation lookup.
//
// ── VERBATIM vs AUTHORED ─────────────────────────────────────────────────────
//
// Marked "apidoc": copied character-for-character out of docs/apidoc.md, which is
// the endpoint contract. Treat as frozen.
//
// Marked "authored": apidoc §5 specifies the *meaning* of the status code but not
// a response string, so the wording here is this file's. Free to improve; keep it
// free of internals, because these reach unauthenticated callers. Deliberately
// vague where vagueness is the security property — INVALID_CREDENTIALS must not
// reveal whether the email exists.
//
// ── What this module deliberately does NOT hold ──────────────────────────────
//
// Interpolated messages. `Cannot GET /api/v1/nope` needs the method and path, and
// a constant cannot carry them; those stay template literals at the call site
// that has the values. A constant is for a string that is the same every time.
//
// Per-endpoint wording for Days 3–16. Populating messages for the ~90 endpoints
// that do not exist yet would mean inventing wording their own tasks own, and the
// guesses would be wrong in ways nobody notices until a client reads them. This
// file holds what the middleware pipeline needs now plus what apidoc already
// pins; each module task adds its own group as it lands.
// ─────────────────────────────────────────────────────────────────────────────

export const MESSAGES = Object.freeze({
  // Cross-cutting responses, used by the error handler, the 404 handler, the
  // validator (2.6) and the rate limiter (2.4).
  COMMON: Object.freeze({
    // apidoc §1 — the default success-envelope message.
    SUCCESS: 'Operation completed successfully',
    // apidoc §1 — the message on every 422 validation envelope, whose per-field
    // detail goes in `errors[]` rather than in this string.
    VALIDATION_FAILED: 'Validation failed',
    // authored — 500. Says nothing about the failure: the stack trace is gated on
    // development, and a 500's cause is for the logs, not the client.
    INTERNAL_ERROR: 'Internal Server Error',
    // authored — 404 on a resource. apidoc §5: ownership misses also answer 404
    // rather than 403, so this string must not hint that the record exists.
    NOT_FOUND: 'Resource not found',
    // authored — 401.
    UNAUTHENTICATED: 'Authentication required',
    // authored — 403 for a role or ownership failure.
    FORBIDDEN: 'You do not have permission to perform this action',
    // authored — 409.
    CONFLICT: 'The request conflicts with the current state of the resource',
    // authored — 413. apidoc §4 caps JSON bodies at 100kb.
    PAYLOAD_TOO_LARGE: 'Request body exceeds the maximum allowed size',
    // authored — 429 from a rate-limit tier. The response also carries
    // Retry-After; the quiz-attempt 429 is a different case with its own message
    // and no Retry-After (apidoc §4).
    RATE_LIMITED: 'Too many requests. Please try again later.',
    // authored — 503. The fail-closed answer when Redis is unreachable on a
    // security path (TRD §7.1): session lookup, email verification, password
    // reset. Never say "cache", which invites a client to retry as though the
    // read were optional.
    SERVICE_UNAVAILABLE:
      'Service temporarily unavailable. Please try again shortly.',
  }),

  // The auth strings apidoc already pins. The remaining auth messages arrive
  // with the module itself (Day 3).
  AUTH: Object.freeze({
    // apidoc §8.2 — POST /auth/register.
    REGISTERED: 'Account registered successfully',
    // apidoc §8.2 — POST /auth/logout.
    LOGGED_OUT: 'Logged out successfully',
    // authored — deliberately identical for an unknown email and a wrong
    // password. Distinguishing them turns the login form into an account
    // oracle, which is how credential-stuffing lists get validated.
    INVALID_CREDENTIALS: 'Invalid email or password',
  }),

  // Field-level strings apidoc quotes inside its `errors[]` example. They belong
  // to the Zod schemas that emit them (Day 3), but the wording is contract, so it
  // is pinned here rather than retyped there.
  VALIDATION: Object.freeze({
    // apidoc §1.
    EMAIL_INVALID: 'Invalid email format',
    // apidoc §1 — the password policy, stated as the user reads it.
    PASSWORD_WEAK:
      'Password must be at least 8 characters long with uppercase, lowercase, and numbers',
  }),
});

export default MESSAGES;
