// ─────────────────────────────────────────────────────────────────────────────
// AppError — the operational-error taxonomy, TRD §6/§7.1, task 2.3.
//
// Every error a service raises deliberately is an AppError. The global handler in
// app.js keys on exactly two of its fields — `statusCode` for the HTTP status and
// `isOperational` to decide whether the message is safe to show a client — so a
// route can `throw NotFoundError()` and never touch res, and a service can stay
// ignorant of HTTP entirely (plan:1021).
//
// ── isOperational is the security boundary, not decoration ───────────────────
//
// An operational error is one this code raised on purpose: a 404 for a missing
// row, a 409 for a duplicate. Its message was authored to be read by a client, so
// the handler forwards it verbatim. Anything else reaching the handler — a
// TypeError, a Prisma failure, a bug — is NON-operational: its message names
// internal paths, table names, dependency versions, and must never reach a client.
// The handler answers those with a generic 500 and logs the real error. `throw new
// Error('cannot read property id of undefined')` must not become a 500 response
// body with that text in it. That decision is made by reading this one boolean, so
// it is set on every AppError and never left to chance.
//
// ── status is 'error', never 'fail' ─────────────────────────────────────────
//
// The scaffold set status to 'fail' for 4xx. apidoc §1 is explicit that the
// envelope carries `status: "success" | "error"` and that a third value "appears
// nowhere in this API"; TRD §1679 pins the error envelope as `{ status: "error",
// message, errors? }`. 'fail' is a jsend habit this contract does not use, and a
// client asserting on the two documented values would break on it. Every AppError
// is an error, so `status` is the constant 'error' — the 2xx envelopes are built
// by api-response.js and never flow through here.
//
// ── The taxonomy is named constructors, not raw `new AppError(msg, 404)` ─────
//
// Call sites say what went wrong (NotFoundError), not what number it is (404). The
// number is policy that belongs here: apidoc §5 maps ownership misses to 404 not
// 403, and if that ever changes it changes in one place. Each constructor defaults
// its message to the shared string from system_messages.js so an un-argumented
// `ForbiddenError()` still answers with the one agreed wording.
//
// The set is exactly the statuses a service throws BY HAND. Three of apidoc §5's
// codes are deliberately not constructors here:
//
//   500 — a service never throws "internal error"; it throws its real bug, and the
//         handler converts any non-operational throw into a 500.
//   413 — Express's json parser and multer raise this themselves on an oversized
//         body; no service code throws it. The handler normalizes their error into
//         the canonical envelope, so a thrown constructor would have no caller.
//   423 — the sequential-unlocking engine (Day 7) both raises this and supplies the
//         `nextAccessibleLessonId` its body carries (apidoc §8.6). That pointer
//         extends the base `{ status, message, errors? }` envelope with a domain
//         field this task cannot produce; forcing it into `errors[]` (an array of
//         `{ field, message }`) would misrepresent that array. Day 7 owns both.
// ─────────────────────────────────────────────────────────────────────────────

import { MESSAGES } from '../config/system_messages.js';

export class AppError extends Error {
  /**
   * @param {string}  message       client-facing message (operational errors only)
   * @param {number}  statusCode    HTTP status the handler will send
   * @param {object}  [options]
   * @param {Array<{field: string, message: string}>} [options.errors]
   *        field-level detail for a 422; becomes the envelope's `errors[]`
   * @param {boolean} [options.isOperational=true]
   *        false marks an error whose message must NOT reach a client
   */
  constructor(message, statusCode, { errors, isOperational = true } = {}) {
    super(message);
    // Always the literal 'AppError', because the taxonomy below is factory
    // functions rather than subclasses — `this.constructor` is AppError at every
    // call site. That is deliberate (the taxonomy is about status codes, not about
    // a class hierarchy nothing branches on), so do not read this as
    // 'NotFoundError'. It still beats Error's default of 'Error' in a log line,
    // and the statusCode beside it is what identifies the case.
    this.name = 'AppError';
    this.statusCode = statusCode;
    // Always 'error' — see the header. Never 'fail', never derived from the code.
    this.status = 'error';
    this.isOperational = isOperational;
    // Only set when present, so `'errors' in err` is a clean test for "is this a
    // validation error carrying field detail" in the handler.
    if (errors !== undefined) {
      this.errors = errors;
    }
    // Omit this frame (the constructor) from the captured stack, so the trace
    // points at the throw site rather than at this file.
    Error.captureStackTrace(this, this.constructor);
  }
}

// ── The taxonomy ─────────────────────────────────────────────────────────────
// One constructor per client-triggerable status in apidoc §5. Each takes an
// optional message and falls back to the shared wording, so a bare call is valid.

/** 400 — malformed payload / invalid JSON (apidoc §5). */
export const BadRequestError = (message = MESSAGES.COMMON.VALIDATION_FAILED) =>
  new AppError(message, 400);

/** 401 — missing, invalid, or expired authentication (apidoc §5). */
export const UnauthorizedError = (message = MESSAGES.COMMON.UNAUTHENTICATED) =>
  new AppError(message, 401);

/** 403 — insufficient role, non-owner mutation, banned account (apidoc §5). */
export const ForbiddenError = (message = MESSAGES.COMMON.FORBIDDEN) =>
  new AppError(message, 403);

/**
 * 404 — record absent, soft-deleted, or owned by another user. apidoc §5 routes
 * ownership misses here rather than to 403 so the response cannot confirm the
 * record exists, so the default message must not hint at it either.
 */
export const NotFoundError = (message = MESSAGES.COMMON.NOT_FOUND) =>
  new AppError(message, 404);

/** 409 — state or constraint conflict; also the mapped target of Prisma P2002. */
export const ConflictError = (message = MESSAGES.COMMON.CONFLICT) =>
  new AppError(message, 409);

/**
 * 422 — Zod schema validation failure. Carries field-level `errors[]`, which the
 * handler places in the envelope beside the message (apidoc §1). This is the one
 * constructor whose first argument is the error list rather than the message.
 */
export const ValidationError = (
  errors,
  message = MESSAGES.COMMON.VALIDATION_FAILED,
) => new AppError(message, 422, { errors });

export const UnprocessableEntityError = (message) => new AppError(message, 422);

/**
 * 423 - Locked. The resource is not yet accessible because previous steps have not been completed.
 */
export const LockedError = (message, details) => {
  const err = new AppError(message, 423);
  if (details) {
    err.details = details;
  }
  return err;
};

/**
 * 429 — the quiz attempt cap (apidoc §5). Rate-limit 429s come from
 * express-rate-limit itself (task 2.4), not from here; this is for
 * `Quiz.maxAttempts` exhaustion, which is a service decision.
 */
export const TooManyRequestsError = (message = MESSAGES.COMMON.RATE_LIMITED, details) => {
  const err = new AppError(message, 429);
  if (details) err.details = details;
  return err;
};

/**
 * 503 — a security-critical Redis path failing closed (apidoc §5, TRD §7.1). Not
 * "cache unavailable": these fail closed precisely because the read was not
 * optional, so the message must not invite a retry-as-though-optional.
 */
export const ServiceUnavailableError = (
  message = MESSAGES.COMMON.SERVICE_UNAVAILABLE,
) => new AppError(message, 503);

// ── normalizeError ───────────────────────────────────────────────────────────
//
// The global handler receives whatever was thrown, and most of it is not an
// AppError. This converts any throw into the four fields the handler needs, so
// app.js stays a wiring manifest and the mapping is unit-testable without HTTP.
//
// TRD §7 and apidoc §90 both require the two Prisma mappings — P2002 → 409,
// P2025 → 404 — "rather than surfaced raw, since raw Prisma errors leak table and
// constraint names". That is not a hypothetical. Measured against this schema:
//
//   P2002  message: "Unique constraint failed on the fields: (`slug`)"
//          meta:    { modelName: 'Subject', target: ['slug'] }
//   P2025  message: "...prisma.subject.update() ... No record was found"
//          meta:    { modelName: 'Subject', cause: 'No record was found...' }
//
// Both name the model, the operation and the column. So the mapped message is a
// generic one from system_messages.js and the raw text is dropped — the original
// error still goes to the log, where it belongs.
//
// Also measured: Prisma errors carry NO `statusCode`. Reading `err.statusCode || 500`
// alone would answer every duplicate-key conflict with a 500 instead of the
// documented 409, which is why this function exists rather than a fallback chain.
//
// Detection is duck-typed on `/^P\d{4}$/` rather than `instanceof
// PrismaClientKnownRequestError`, to keep this module free of @prisma/client — it
// is imported by middleware that never touches the database. The pattern is tight
// enough to be safe: Node's own system errors use string codes like 'ENOENT' and
// 'ECONNREFUSED', which do not match (verified).
//
/**
 * @param {unknown} err
 * @returns {{statusCode: number, message: string, errors?: Array, isOperational: boolean}}
 */
export function normalizeError(err) {
  // Our own deliberate throws. The `isOperational` duck-type is a fallback for the
  // case where two copies of this module exist in one process (mixed module
  // formats, or a test that mocks it), which would make `instanceof` false for an
  // error that genuinely is one of ours.
  if (err instanceof AppError || err?.isOperational === true) {
    return {
      statusCode: err.statusCode ?? 500,
      message: err.message,
      errors: err.errors,
      details: err.details,
      isOperational: true,
    };
  }

  // Prisma known request errors.
  if (typeof err?.code === 'string' && /^P\d{4}$/.test(err.code)) {
    if (err.code === 'P2002') {
      return {
        statusCode: 409,
        message: MESSAGES.COMMON.CONFLICT,
        isOperational: true,
      };
    }
    if (err.code === 'P2025') {
      return {
        statusCode: 404,
        message: MESSAGES.COMMON.NOT_FOUND,
        isOperational: true,
      };
    }
    // Every other P-code is a bug in a query this code wrote, not something a
    // client did. Generic 500, full detail to the log.
    return {
      statusCode: 500,
      message: MESSAGES.COMMON.INTERNAL_ERROR,
      isOperational: false,
    };
  }

  // express.json() failures. `type` is body-parser's own discriminator; both cases
  // arrive with statusCode already set, but the message is replaced so the wording
  // matches the rest of the API rather than being body-parser's ("request entity
  // too large"). Note PrismaClientValidationError reaches neither branch — it has
  // no `code` at all (measured) — so a missing required field becomes a generic
  // 500, which is right: its message dumps the model's field shape.
  if (err?.type === 'entity.too.large') {
    return {
      statusCode: 413,
      message: MESSAGES.COMMON.PAYLOAD_TOO_LARGE,
      isOperational: true,
    };
  }
  if (err?.type === 'entity.parse.failed') {
    return {
      statusCode: 400,
      message: MESSAGES.COMMON.MALFORMED_JSON,
      isOperational: true,
    };
  }

  // Anything else: a TypeError, a thrown string, a dependency's error. Its message
  // was never written for a client to read.
  return {
    statusCode: 500,
    message: MESSAGES.COMMON.INTERNAL_ERROR,
    isOperational: false,
  };
}

export default AppError;
