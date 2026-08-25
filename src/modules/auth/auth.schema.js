// ─────────────────────────────────────────────────────────────────────────────
// Auth request schemas — apidoc §8.2, TRD §6.1, task 3.1.
//
// The six bodies the auth module accepts. Every one is `.strict()`, so a key the
// schema does not name is a 422 rather than a value that reaches the service and
// gets spread into a Prisma call: TRD §7 mass assignment, and the reason
// validate.middleware.js reports one `errors[]` entry per refused key.
//
// ── THE RULE THIS FILE EXISTS TO ENFORCE ─────────────────────────────────────
//
// `role` on register accepts STUDENT and INSTRUCTOR. ADMIN is refused HERE, at
// the boundary, so self-registration cannot mint an administrator (plan:342).
// Enumerating the two allowed values is what makes that structural: a check
// written as `role !== 'ADMIN'` is one future enum member away from being wrong,
// while a list of the roles a stranger may claim is wrong only if edited.
//
// ── ONE PROBLEM, ONE errors[] ENTRY ──────────────────────────────────────────
//
// The obvious spelling of the password policy is a chain -- `.min(8)` then three
// `.regex()` calls, all sharing PASSWORD_WEAK. Measured on zod 3.25.76, that is
// wrong: Zod runs EVERY string check and collects every failure, so 'abc' emits
// the same sentence three times, and a `.refine()` placed after a failed
// `.min()` still runs rather than being skipped. A client rendering errors[]
// under its password field would print the policy three times.
//
// So the policy is a single lookahead regex. One check, one issue, whatever is
// wrong with the password.
//
// The `/s` flag is not decoration. `.` excludes newlines by default, so without
// it 'AB1\nabcdefg' -- 11 characters, all three classes present -- is refused
// while being told it needs uppercase, lowercase and numbers. Measured: fails
// without the flag, passes with it. A message that describes a rule the input
// already satisfies is worse than no message.
//
// The byte cap is a separate `.refine()` on purpose. It is a different fact
// about the password, so a value that is both weak and overlong should report
// both -- measured, that produces exactly two entries, one per problem, not two
// copies of one. See FIELD_LIMITS.PASSWORD_MAX_BYTES for the bcrypt truncation
// that makes the cap a correctness requirement rather than hygiene.
//
// ── WHERE THE POLICY IS DELIBERATELY NOT APPLIED ─────────────────────────────
//
// loginSchema checks that a password is PRESENT and nothing else. Re-applying
// the policy at login would mean that tightening it later locks every existing
// account out of its own credentials, with a 422 that names the rule instead of
// the 401 that a rejected credential is supposed to produce. The same reasoning
// covers the byte cap: a password stored before the cap existed must still be
// typed in full and matched, which bcrypt does by truncating the comparison the
// same way it truncated the hash. Presence-only is also not a cost risk -- work
// is constant past 72 bytes, and express.json caps the body at 100kb anyway.
//
// ── NORMALISATION, AND WHY IT IS NOT COSMETIC ────────────────────────────────
//
// `email` is trimmed and lowercased before validation. schema.prisma declares it
// `String @unique`, which is a case-SENSITIVE PostgreSQL unique index: without
// this, 'Alex@example.com' registers a second account alongside 'alex@example.com'
// and then fails to log in against the row it did not create. Register, login and
// forgot-password therefore share one builder rather than each spelling it out,
// because the normalisation is only correct if all three agree.
//
// `fullName` is trimmed, which also makes '  ' a length failure rather than a
// two-character name. No character-class check: names carry apostrophes, hyphens,
// accents and scripts this codebase has no business ruling on, and the column is
// escaped by the driver, not by a regex here.
//
// ── WHY refreshSchema IS NOT z.object({}).strict() ───────────────────────────
//
// POST /auth/refresh takes no body at all; the token is cookie-borne, and
// accepting one in the body would hand back the property HttpOnly buys. An empty
// strict object is the natural spelling and it 422s every real call: measured on
// express 5.2.1 / body-parser 2.3.0, a POST with no Content-Type leaves
// `req.body` UNDEFINED -- body-parser 2 dropped the `req.body = req.body || {}`
// line that 1.x ran before skipping -- and parsing undefined against an object
// gives `invalid_type`, which the middleware reports as `{field: 'body'}`. That
// is `fetch(url, {method: 'POST'})` with no options, i.e. the ordinary way a
// browser calls this endpoint. The preprocess maps a missing body to {} while
// still refusing a body that is present and wrong.
//
// ── NOT HERE ─────────────────────────────────────────────────────────────────
//
// POST /auth/logout and GET /auth/me take no input beyond the credential the
// auth guard reads, so they get no schema: mounting validate({body: empty}) on
// logout would only add a way for it to fail.
//
// ── THE TOKEN ALPHABET, PINNED BY TASK 3.3 ───────────────────────────────────
//
// Earlier this builder bounded length and rejected blanks without asserting an
// alphabet, because task 3.3 had not yet decided what a token looks like. It has:
// `generateToken()` in auth.service.js returns `randomBytes(TOKEN.BYTES)` as hex,
// so a real token is exactly TOKEN.LENGTH lowercase hex characters, and anything
// else was never issued by this application.
//
// One `.regex()` REPLACES the old `.min(1).max(...)` pair rather than joining it.
// Zod runs every string check and collects every failure (see the password note
// above), so keeping a length bound beside an exact-length pattern would report
// the same sentence twice for one overlong token. The pattern subsumes both: ''
// fails it, and so does a megabyte of junk.
//
// This does mean a malformed token now gets 422 from the schema where an unknown
// one gets 400 from the service. That is not an enumeration oracle: it separates
// "this cannot be a token" — which the caller can determine from the format
// without asking — from "this is not a live token", which is the answer worth
// hiding, and TOKEN_INVALID keeps that second answer identical for unknown,
// consumed and expired alike.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { FIELD_LIMITS, TOKEN, UserRole } from '../../config/constants.js';
import { MESSAGES } from '../../config/system_messages.js';

const V = MESSAGES.VALIDATION;

// Lower + upper + digit + length, and no symbol requirement, because that is
// exactly what MESSAGES.VALIDATION.PASSWORD_WEAK promises the user and apidoc §1
// publishes. Built from the constant so the two cannot drift; `\\d` is escaped
// twice because this is a string, not a literal.
const PASSWORD_POLICY = new RegExp(
  `^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{${FIELD_LIMITS.PASSWORD_MIN_LENGTH},}$`,
  's',
);

// Exactly what generateToken() emits: TOKEN.LENGTH lowercase hex characters.
// Built from the constant for the same reason PASSWORD_POLICY is -- the generator
// and its validator must not be able to disagree. Case-sensitive on purpose:
// `toString('hex')` is lowercase, and a token that arrives uppercased was not
// copy-pasted, it was retyped or manufactured.
const TOKEN_PATTERN = new RegExp(`^[0-9a-f]{${TOKEN.LENGTH}}$`);

// ── Field builders ───────────────────────────────────────────────────────────
//
// Zod schemas are immutable, so these are shared instances rather than factory
// functions: `.strict()` and `.extend()` return new objects and cannot mutate one
// of these out from under another schema.

const fullName = z
  .string()
  .trim()
  .min(FIELD_LIMITS.NAME_MIN_LENGTH, V.NAME_LENGTH)
  .max(FIELD_LIMITS.NAME_MAX_LENGTH, V.NAME_LENGTH);

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email(V.EMAIL_INVALID)
  .max(FIELD_LIMITS.EMAIL_MAX_LENGTH, V.EMAIL_TOO_LONG);

// A password being SET: register, and reset-password's newPassword.
const password = z
  .string()
  .regex(PASSWORD_POLICY, V.PASSWORD_WEAK)
  .refine(
    (value) =>
      Buffer.byteLength(value, 'utf8') <= FIELD_LIMITS.PASSWORD_MAX_BYTES,
    V.PASSWORD_TOO_LONG,
  );

// A password being OFFERED: login. Presence only -- see the header.
const submittedPassword = z.string().min(1, V.PASSWORD_REQUIRED);

// An emailed single-use token: verify-email, reset-password. Trimmed because it
// arrives via copy-paste out of a mail client, and no token alphabet contains
// whitespace, so trimming can only rescue a valid token. One check, one issue --
// see the alphabet note in the header.
const token = z.string().trim().regex(TOKEN_PATTERN, V.TOKEN_INVALID);

// ── Schemas ──────────────────────────────────────────────────────────────────

/** `POST /auth/register` — apidoc §8.2. */
export const registerSchema = z
  .object({
    fullName,
    email,
    password,
    // Absent means STUDENT, which apidoc §8.2 states and schema.prisma repeats as
    // the column default. Defaulted here too so the service reads one shape
    // instead of branching on undefined. The plain `{ message }` form does reach
    // an invalid_enum_value in zod 3.25.76 -- verified, no errorMap needed.
    role: z
      .enum([UserRole.STUDENT, UserRole.INSTRUCTOR], {
        message: V.ROLE_INVALID,
      })
      .default(UserRole.STUDENT),
  })
  .strict();

/** `POST /auth/login` — apidoc §8.2. */
export const loginSchema = z
  .object({
    email,
    password: submittedPassword,
  })
  .strict();

/** `POST /auth/refresh` — apidoc §8.2. Cookie-borne; body must be empty. */
export const refreshSchema = z.preprocess(
  (value) => value ?? {},
  z.object({}).strict(),
);

/** `POST /auth/verify-email` — apidoc §8.2. */
export const verifyEmailSchema = z.object({ token }).strict();

/** `POST /auth/forgot-password` — apidoc §8.2. */
export const forgotPasswordSchema = z.object({ email }).strict();

/** `POST /auth/reset-password` — apidoc §8.2. */
export const resetPasswordSchema = z
  .object({
    token,
    newPassword: password,
  })
  .strict();

export default {
  registerSchema,
  loginSchema,
  refreshSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
};
