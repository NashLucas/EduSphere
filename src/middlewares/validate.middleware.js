// ─────────────────────────────────────────────────────────────────────────────
// Zod request validation — TRD §3.2/§7, apidoc §1/§5/§6, task 2.6.
//
// Two exports:
//
//   validate({ body?, params?, query? })   route middleware; parses each supplied
//                                          section, replaces it on req with the
//                                          PARSED value, and answers 422 with
//                                          apidoc's field-level errors[] on failure
//   paginationSchema                       the one shared page/limit schema every
//                                          list endpoint composes (TRD §6)
//
// Position in the chain is fixed by TRD §3.2: validate(schema) -> requireAuth ->
// requireRole([...]) -> controller. Validation first, so a malformed payload costs
// a schema parse rather than a JWT verification and a role lookup.
//
// ── MOUNT IT ON THE ROUTE, NEVER WITH app.use ───────────────────────────────
//
// Measured: inside an `app.use` middleware req.params is `{}` — Express fills it
// per matched layer, so a validator mounted application-wide sees no path
// parameters at all and a `params` schema silently validates an empty object.
// Route-level is the only correct position, which is also where TRD §3.2 puts it.
//
// ── req.query CANNOT BE ASSIGNED IN EXPRESS 5 ───────────────────────────────
//
// This is the fact the whole file is shaped around. Express 5 exposes req.query
// through a GETTER on the prototype with no setter (measured: prototype depth 2,
// `hasSet: false`). Every module here is ESM, so it runs in strict mode, and in
// strict mode assigning to an accessor with no setter THROWS:
//
//   TypeError: Cannot set property query of #<IncomingMessage> which has only a getter
//
// The Express 4 idiom `req.query = parsed` therefore does not "fail to stick" — it
// raises a 500 on every single validated request carrying a query schema. The
// getter is `configurable: true`, so Object.defineProperty shadows it with an own
// property, which is what writeSection does. body and params both accept plain
// assignment (measured), but they go through the same call: one code path is worth
// more than saving a defineProperty on two of three sections.
//
// ── WHY WRITE BACK AT ALL ───────────────────────────────────────────────────
//
// Because the parsed value is the only safe one, and because plan:1022 forbids
// raw req.body access without prior validation:
//
//   * Coercion. Query values arrive as strings, always (measured — `?limit=10`
//     gives '10'). Without write-back a controller receives '10' and every
//     arithmetic use of it is a string operation; `?limit=500` would also arrive
//     unclamped, defeating the cap.
//   * Unknown-key stripping. Zod returns a FRESH object holding only declared
//     keys. Replacing the section is what makes that protective: on a `.strict()`
//     schema an unknown key is a 422, and on a lax one it is dropped rather than
//     forwarded to Prisma. Both block the mass-assignment TRD §7 names, and both
//     neutralise a `__proto__` key in a JSON body — measured: `.strict()` reports
//     it as unrecognized_keys, and a lax schema's output simply does not contain
//     it.
//
// Nothing is written back unless EVERY section parsed. A request that fails
// validation reaches the error handler with req untouched, so there is no
// half-coerced state for a later handler to misread.
//
// ── MAPPING ZodError ONTO apidoc's errors[] ─────────────────────────────────
//
// apidoc §1 fixes the shape: `errors: [{ field, message }]`. `field` comes from
// the issue path, and all three measured path shapes need handling:
//
//   path: ['email']              -> 'email'
//   path: ['profile','city']     -> 'profile.city'
//   path: ['options',0,'label']  -> 'options.0.label'   (numeric segment)
//
// Two issue kinds carry NO path, and a naive `path.join('.')` reports them as the
// empty string — a client cannot act on `{ field: '', ... }`:
//
//   unrecognized_keys  from .strict(). path is [] (or the path of the enclosing
//                      object) and the offending names live in issue.keys.
//                      Measured: keys: ['role','isAdmin'] for a body that tried
//                      to set both. Each key becomes its OWN entry, so a caller
//                      is told exactly which fields were refused instead of
//                      receiving one blob naming several.
//   custom             from .refine()/.superRefine() without an explicit `path`
//                      — the cross-field rules TRD §4.2 requires: exactly one of
//                      courseId/lessonId on a bookmark toggle, the question-shape
//                      rules, 0 <= correctAnswerIndex < options.length. These
//                      fall back to the SECTION name ('body', 'query', 'params'),
//                      which is true and actionable. A schema author who wants a
//                      specific input highlighted passes `{ path: ['courseId'] }`
//                      to .refine(); that is honoured (measured).
//
// Every section is parsed even when an earlier one failed, and all issues are
// merged into one 422. One round trip shows a client everything wrong with the
// request rather than the first section's worth.
//
// safeParseAsync, not safeParse: measured, safeParse THROWS
// ("Async refinement encountered during synchronous parse operation") the moment
// any schema in the tree carries an async .refine(). safeParseAsync handles the
// purely synchronous schemas identically, so one path covers both and a later
// module adding an async rule cannot turn every request on that route into a 500.
//
// ── THE MISUSE GUARD IS DELIBERATE, AND IT CRASHES THE BOOT ─────────────────
//
// TRD §3.2 writes the pipeline as `validate(schema)`, singular, so passing a bare
// Zod schema instead of `{ body: schema }` is the natural mistake. Nothing about
// the resulting route looks wrong: it mounts, it serves traffic, and it validates
// NOTHING, because `schemas.body`, `.params` and `.query` are all undefined. That
// is an unvalidated route wearing a validator, on a codebase whose contract is
// "every route has a Zod schema" (plan:1022).
//
// So the argument is checked when validate() is called — at import time, while the
// routers are being built — and a bad call throws a TypeError that stops the
// process before the listener binds. Same principle as env.js: fail the deploy,
// not the first request.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

import { PAGINATION } from '../config/constants.js';
import { ValidationError } from '../utils/app-error.js';

/**
 * The three request sections, in the order their errors are reported: the
 * resource identity, then the filter, then the payload. Fixed rather than derived
 * from Object.keys(schemas) so errors[] ordering does not depend on the literal
 * order a caller happened to type.
 */
const SECTIONS = Object.freeze(['params', 'query', 'body']);

/**
 * Flattens one section's ZodError issues into apidoc's `[{ field, message }]`.
 *
 * @param {Array<import('zod').ZodIssue>} issues
 * @param {string} section  'params' | 'query' | 'body' — the pathless fallback
 * @returns {Array<{field: string, message: string}>}
 */
function toFieldErrors(issues, section) {
  const errors = [];

  for (const issue of issues) {
    // .strict() rejection: one entry per refused key. issue.path is the path of
    // the object that held them, so a nested strict schema reports
    // 'profile.role' rather than a bare 'role'.
    if (issue.code === 'unrecognized_keys' && Array.isArray(issue.keys)) {
      for (const key of issue.keys) {
        errors.push({
          field: [...issue.path, key].join('.'),
          message: issue.message,
        });
      }
      continue;
    }

    errors.push({
      field: issue.path.length > 0 ? issue.path.join('.') : section,
      message: issue.message,
    });
  }

  return errors;
}

/**
 * Replaces a request section with its parsed value.
 *
 * defineProperty rather than assignment because req.query is a getter-only
 * accessor in Express 5 and `req.query = value` throws in strict mode — see the
 * header. The descriptor is left writable and configurable so the property
 * behaves like the plain own property body and params already are.
 */
function writeSection(req, section, value) {
  Object.defineProperty(req, section, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Builds validation middleware for a route.
 *
 * @param {{body?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny}} schemas
 * @returns {import('express').RequestHandler}
 * @throws {TypeError} at mount time on a misuse that would leave the route unvalidated
 */
export function validate(schemas) {
  if (schemas === null || typeof schemas !== 'object') {
    throw new TypeError(
      'validate() expects { body?, params?, query? } — received ' +
        typeof schemas,
    );
  }

  const entries = SECTIONS.filter(
    (section) => schemas[section] !== undefined,
  ).map((section) => [section, schemas[section]]);

  if (entries.length === 0) {
    throw new TypeError(
      'validate() was given no body, params or query schema, so it would validate ' +
        'nothing. Pass validate({ body: schema }) rather than validate(schema).',
    );
  }

  for (const [section, schema] of entries) {
    if (typeof schema?.safeParseAsync !== 'function') {
      throw new TypeError(
        `validate(): the '${section}' schema is not a Zod schema (no safeParseAsync).`,
      );
    }
  }

  return async function validateRequest(req, res, next) {
    try {
      const errors = [];
      const parsed = [];

      for (const [section, schema] of entries) {
        // eslint-disable-next-line no-await-in-loop -- sections are ordered for
        // deterministic errors[]; three sequential parses of already-in-memory
        // objects, no I/O to overlap.
        const result = await schema.safeParseAsync(req[section]);

        if (result.success) {
          parsed.push([section, result.data]);
        } else {
          errors.push(...toFieldErrors(result.error.issues, section));
        }
      }

      if (errors.length > 0) {
        return next(ValidationError(errors));
      }

      for (const [section, value] of parsed) {
        writeSection(req, section, value);
      }

      return next();
    } catch (err) {
      // A schema that throws for a reason of its own — a broken transform, an
      // async refinement that rejects. next(err) keeps it on the one error path
      // instead of surfacing as an unhandled rejection.
      return next(err);
    }
  };
}

// ── The shared pagination schema (apidoc §6, TRD §6) ────────────────────────
//
// page and limit ONLY. `search` and `sort` are listed beside them in apidoc §6 but
// belong to each endpoint's own query schema — their allowed values differ per
// resource, while these two are platform-wide policy. Compose with
// `paginationSchema.extend({ search: ..., sort: ... })`.
//
// CLAMPED, NOT REJECTED. `?limit=500` serves 100 with a 200. The obvious spelling
// of a cap is `.max(MAX_LIMIT)`, and it is WRONG here — measured, `.min(1).max(100)`
// makes `?limit=500` a 422, which is exactly the behaviour apidoc §6 and plan:1023
// forbid. The cap has to be a transform.
//
// The forgiveness stops at these two fields. It is NOT a policy for query strings
// in general: plan:909 requires `?actionType=NONSENSE` to be a 422 rather than a
// silently empty page, so enum and id filters in per-endpoint schemas must stay
// strict and must not copy the .catch() below.
//
// Left non-strict on purpose. A strict pagination schema would 422 any request
// carrying an undeclared query key — a `utm_source`, a cache-buster, a filter a
// newer client sends to an older deploy — on public unauthenticated catalog reads.
// Unknown query keys are dropped by the write-back instead. An endpoint that wants
// them refused adds .strict() to its own composed schema; the mass-assignment risk
// TRD §7 is protecting against lives in the body, which is where .strict() belongs.

/** '' behaves as absent, so `?limit=` takes the default instead of coercing to 0. */
const blankToUndefined = (value) => (value === '' ? undefined : value);

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

export const paginationSchema = z.object({
  page: z.preprocess(
    blankToUndefined,
    z.coerce
      .number()
      .int()
      // .safe() is load-bearing, not decoration. page is only clamped from below,
      // so without it `?page=1e20` reaches Prisma as skip: 1e20 — measured to
      // raise PrismaClientValidationError, which carries no `code`, falls through
      // normalizeError untouched and becomes a 500 on a public endpoint.
      // Number.isInteger(1e20) is true, so .int() does not stop it. Inside the
      // safe-integer range the worst case is skip = (2^53-2) * MAX_LIMIT ~ 9.0e17,
      // comfortably within the i64 Prisma accepts (measured: 1e20 rejected,
      // 2147483648 accepted).
      .safe()
      .catch(PAGINATION.DEFAULT_PAGE)
      // Floor of 1, not DEFAULT_PAGE: the first page is a structural minimum
      // (offset 0), not a configurable default. `?page=0` and `?page=-3` serve
      // page 1 rather than computing a negative offset.
      .transform((n) => Math.max(n, 1))
      .default(PAGINATION.DEFAULT_PAGE),
  ),
  limit: z.preprocess(
    blankToUndefined,
    z.coerce
      .number()
      .int()
      .catch(PAGINATION.DEFAULT_LIMIT)
      // Clamped both ways. The ceiling is the DoS guard apidoc §6 describes; the
      // floor of 1 keeps `?limit=0` from reaching api-response.js's totalPages
      // division, which guards itself but should never be handed a zero.
      .transform((n) => clamp(n, 1, PAGINATION.MAX_LIMIT))
      .default(PAGINATION.DEFAULT_LIMIT),
  ),
});

export default { validate, paginationSchema };
