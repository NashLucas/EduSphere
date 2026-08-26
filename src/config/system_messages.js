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
    // authored — 400. apidoc §5's 400 row is "Invalid JSON formatting or missing
    // mandatory request headers", which is a different failure from a 422: the
    // body never parsed, so there are no per-field errors to report.
    MALFORMED_JSON: 'Malformed JSON in request body',
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
    // authored — task 3.9. apidoc §8.2 gives POST /auth/login "same structure as
    // register", which pins the DATA shape and not the message: reusing
    // REGISTERED here would tell a returning user they had just created an
    // account. Phrased to match LOGGED_OUT below, which apidoc does pin, so the
    // two halves of one session read as a pair.
    LOGGED_IN: 'Logged in successfully',
    // apidoc §8.2 — POST /auth/logout.
    LOGGED_OUT: 'Logged out successfully',
    // authored — task 3.9. apidoc §8.2's 200 for POST /auth/refresh shows
    // `{ status, data: { accessToken } }` and no `message` at all, so any wording
    // here is a superset (see api-response.js on why the builders always send
    // one). Names what happened to the SESSION rather than to the token, because
    // the rotation replaces both halves and a client that reads "token issued"
    // has no reason to expect its cookie changed too.
    SESSION_REFRESHED: 'Session refreshed',
    // authored — deliberately identical for an unknown email and a wrong
    // password. Distinguishing them turns the login form into an account
    // oracle, which is how credential-stuffing lists get validated.
    INVALID_CREDENTIALS: 'Invalid email or password',
    // authored — task 3.4. The 403 of apidoc §8.2: "credentials valid but the
    // account is banned or soft-deleted. Distinct from 401 — the caller proved
    // identity; the account is denied."
    //
    // ONE string for both states, because apidoc gives them one row. It is not
    // an enumeration leak the way INVALID_CREDENTIALS would be — reaching this
    // message costs a correct password, so the reader owns the account.
    //
    // "Disabled" rather than "suspended" or "deleted": it has to be true of a
    // ban and of a soft deletion at once. Names an action the reader can take,
    // because they cannot fix this one themselves.
    ACCOUNT_DISABLED: 'This account has been disabled. Please contact support.',
    // authored — task 3.5. The ONLY 401 POST /auth/refresh ever returns, and it
    // has to cover every one of apidoc §8.2's three causes at once: "Cookie
    // absent, expired, or its session:<jti> key no longer exists in Redis
    // (revoked)". The service reaches four more: a signature that does not
    // verify, a `type` claim that is not 'refresh', claims it cannot use, and an
    // account banned between login and refresh.
    //
    // One string for all seven is the security property, exactly as
    // INVALID_CREDENTIALS is. Distinguishing "expired" from "revoked" tells the
    // holder of a stolen cookie whether it was ever a real session, and
    // distinguishing "banned" would make this endpoint the ban oracle that
    // login's 403 is careful to charge a password for.
    //
    // Says "no longer valid" rather than "expired", because it is read in cases
    // where nothing expired, and names the one action that always resolves it.
    SESSION_INVALID: 'Your session is no longer valid. Please sign in again.',
    // authored — task 3.7. POST /auth/forgot-password, which apidoc §8.2 gives a
    // 200 row and nothing else: the response is byte-identical whether or not an
    // account exists for the address (TRD:1480).
    //
    // That constraint is what fixes the wording. "We have sent you a link" would
    // be a lie on the branch where no account was found, and a true sentence on
    // one branch and a false one on the other is the enumeration leak the
    // identical status code was chosen to prevent — a reader who trusts the
    // message learns the answer anyway. The conditional clause is the only
    // phrasing that is honestly true of both branches at once.
    //
    // It does not say "check your inbox" for the same reason, and does not
    // mention the 15-minute expiry: the email itself carries that, and repeating
    // it here would promise a deadline to someone who is not getting a link.
    PASSWORD_RESET_SENT:
      'If an account exists for that address, a reset link is on its way.',
    // authored — task 3.7. POST /auth/reset-password, apidoc §8.2's 200.
    //
    // The second sentence is a statement of fact, not advice: a reset revokes
    // every refresh session the account had (TRD:1476), so the reader genuinely
    // must sign in again on every device. It is worth saying because the
    // alternative is a user who reads "password changed", switches to another
    // device, finds themselves logged out, and reads that as a break-in.
    //
    // "Changed" rather than "reset" — the reader just chose the new password, so
    // "reset" invites the question of what it was reset TO.
    PASSWORD_RESET: 'Your password has been changed. Please sign in again.',
    // authored — task 3.8. POST /auth/verify-email, apidoc §8.2's 200 row, which
    // says only "Email address marked verified" and pins no wording.
    //
    // Stated as a completed fact and nothing else. It deliberately does not say
    // "thank you for confirming" or "you can now enrol", because this one string
    // is also the answer to a REPLAY: verification is idempotent, so a token that
    // arrives after the flag is already true earns the same 200, and a message
    // that reads as a first-time welcome would be wrong on that path.
    //
    // Nor does it list what verification unlocks. TRD:1482 gates exactly three
    // surfaces on the flag, and 3.11 owns which ones; naming them here would put
    // a second, drifting copy of that list in front of the user.
    EMAIL_VERIFIED: 'Your email address has been verified.',
  }),

  // Field-level strings apidoc quotes inside its `errors[]` example. They belong
  // to the Zod schemas that emit them (Day 3), but the wording is contract, so it
  // is pinned here rather than retyped there.
  //
  // These are the `message` half of an `errors[]` entry, so each one is read
  // beside a field name and next to a form input. Written as an instruction the
  // user can act on ("must be...") rather than a verdict ("is invalid"), and
  // never mentioning a rule the form did not state.
  VALIDATION: Object.freeze({
    // apidoc §1.
    EMAIL_INVALID: 'Invalid email format',
    // apidoc §1 — the password policy, stated as the user reads it. This is the
    // sentence that fixes the policy at lower + upper + digit and NO symbol
    // requirement; the regex in auth.schema.js is written to match it exactly.
    PASSWORD_WEAK:
      'Password must be at least 8 characters long with uppercase, lowercase, and numbers',
    // authored — task 3.1. FIELD_LIMITS.NAME_MIN/MAX_LENGTH. One string for both
    // ends: a client that sent 1 character and one that sent 200 have the same
    // question, and two messages would only need keeping consistent.
    NAME_LENGTH: 'Full name must be between 2 and 100 characters',
    // authored — task 3.1. FIELD_LIMITS.EMAIL_MAX_LENGTH.
    EMAIL_TOO_LONG: 'Email address must be at most 254 characters',
    // authored — task 3.1. FIELD_LIMITS.PASSWORD_MAX_BYTES. Says bytes, not
    // characters, because that is what is measured and the two differ for any
    // non-ASCII passphrase -- 36 accented characters already spend 72 bytes.
    // Telling that user "at most 72 characters" while refusing their 40 would be
    // a message they cannot act on.
    PASSWORD_TOO_LONG: 'Password must be at most 72 bytes long',
    // authored — task 3.1. Login and forgot-password check presence only; the
    // policy is not re-applied there (see auth.schema.js).
    PASSWORD_REQUIRED: 'Password is required',
    // authored — task 3.1. A token that is empty or absurdly long never reaches
    // Redis. Deliberately identical to what apidoc's 400 reports for a token
    // that is unknown, consumed or expired, so the two answers cannot be
    // compared to learn whether a given token was ever real.
    TOKEN_INVALID: 'Invalid or expired token',
    // authored — task 3.1. `role` on register accepts STUDENT and INSTRUCTOR
    // only. Names both so the caller does not have to guess the third value is
    // the one being refused, but does not explain that ADMIN exists.
    ROLE_INVALID: 'Role must be either STUDENT or INSTRUCTOR',
  }),
});

export default MESSAGES;
