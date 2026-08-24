// ─────────────────────────────────────────────────────────────────────────────
// Response envelope builders — TRD §6, apidoc §1, task 2.3.
//
// Every JSON body this API sends is constructed here. That is the point: the
// envelope is a published contract, and a contract enforced by convention across
// ~90 route handlers is a contract that drifts. One handler writing
// `res.json({ course })` instead of `{ status, message, data }` is invisible in
// review and breaks every client's parser.
//
// ── What the scaffold got wrong ──────────────────────────────────────────────
//
// The version this replaces emitted `{ success: true, ... }` and named the
// pagination block `meta`. Both contradict apidoc §1, which is explicit: `status`
// is the string "success" | "error", "a `{ success: false }` shape appears nowhere
// in this API", and the pagination object is keyed `pagination`. A client written
// against the documentation could not read a single response from that version.
// Its three functions were also named sendSuccess/sendPaginatedSuccess/sendError
// rather than the success/created/paginated the task specifies.
//
// ── The payload key is always `data` ─────────────────────────────────────────
//
// Never `course`, `user`, or `resource` (plan:283). A client deserializing a list
// endpoint reads `body.data` whatever the resource is, so one generic parser works
// everywhere. Naming the key after the resource forces per-endpoint parsing, which
// is the cost this rule exists to avoid.
//
// ── paginated() COMPUTES the derived fields ──────────────────────────────────
//
// It takes `{ page, limit, totalItems }` and derives totalPages, hasNextPage and
// hasPrevPage. It deliberately does not accept a pre-built pagination object: with
// ~15 list endpoints, hand-passing derived values means fifteen chances to write
// `Math.floor` for `Math.ceil`, or to get hasNextPage wrong on the last page — an
// off-by-one that shows up as a client's infinite scroll never terminating. Three
// inputs in, six fields out, computed once.
//
// ── Why paginated() includes `message` when apidoc §1's example does not ─────
//
// apidoc §1's paginated sample shows only `{ status, data, pagination }`, while
// task 2.3 states that EVERY builder emits `{ status, message, data | errors }`.
// The task text wins here, and the disagreement is safe in this direction: the
// result is a superset — every key the document shows is present with the value it
// shows, plus a message. Omitting it would leave `body.message` undefined on list
// endpoints alone, so a client's shared response reader would need a special case
// for exactly one envelope. That asymmetry is a worse outcome than one extra
// documented-elsewhere key.
// ─────────────────────────────────────────────────────────────────────────────

import { MESSAGES } from '../config/system_messages.js';

/**
 * 200 with a payload.
 *
 * @param {import('express').Response} res
 * @param {*} [data={}]     the payload; apidoc §1 shows `"data": {}` when empty
 * @param {string} [message]
 */
export const success = (res, data = {}, message = MESSAGES.COMMON.SUCCESS) =>
  res.status(200).json({ status: 'success', message, data });

/**
 * 201 for a created entity (apidoc §5: User, Course, Module, Enrollment, Attempt).
 *
 * Identical envelope to success() — only the status code differs, which is exactly
 * why it is a separate builder rather than a `statusCode` argument: a call site
 * that has to pass 201 by hand is a call site that can pass 200 by mistake.
 */
export const created = (res, data = {}, message = MESSAGES.COMMON.SUCCESS) =>
  res.status(201).json({ status: 'success', message, data });

/**
 * 200 with a list and its pagination block (apidoc §1, §6).
 *
 * @param {import('express').Response} res
 * @param {Array} items    the page of results; `data` is an array here
 * @param {{page: number, limit: number, totalItems: number}} meta
 *        already coerced and clamped by the shared paginationSchema (task 2.6)
 * @param {string} [message]
 */
export const paginated = (
  res,
  items,
  { page, limit, totalItems },
  message = MESSAGES.COMMON.SUCCESS,
) => {
  // Guard the divisor rather than trusting the caller. limit arrives clamped to
  // [1, MAX_LIMIT] from paginationSchema, but a zero here would make totalPages
  // Infinity and serialize as null in JSON — a silent, hard-to-trace corruption.
  const perPage = Math.max(1, limit);
  const totalPages = Math.ceil(totalItems / perPage);

  return res.status(200).json({
    status: 'success',
    message,
    data: items,
    pagination: {
      page,
      limit,
      totalItems,
      totalPages,
      // Compared against totalPages, not against totalItems: on an empty result
      // totalPages is 0, so page 1 correctly reports no next page.
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  });
};

/**
 * The error envelope — `{ status: 'error', message, errors? }` (TRD §7, apidoc §1).
 *
 * A FOURTH builder, where task 2.3 names three. It is here because the same task
 * requires every builder to emit the canonical envelope and app.js's global
 * handler is what sends error bodies: leaving that one construction inline in
 * app.js would split a single published contract across two files, and app.js is a
 * wiring manifest. This keeps the rule "no module anywhere writes an envelope
 * literal" true without exception.
 *
 * `errors` is omitted entirely when absent rather than sent as null, because TRD
 * §7 pins the shape as `errors?` — optional. A 404 body is `{ status, message }`
 * with no third key; only a 422 carries the field list.
 *
 * @param {import('express').Response} res
 * @param {number} statusCode
 * @param {string} message
 * @param {Array<{field: string, message: string}>} [errors]
 * @param {string} [stack] included only outside production; app.js decides
 */
export const error = (res, statusCode, message, errors, stack) =>
  res.status(statusCode).json({
    status: 'error',
    message,
    ...(errors !== undefined && { errors }),
    ...(stack !== undefined && { stack }),
  });

export default { success, created, paginated, error };
