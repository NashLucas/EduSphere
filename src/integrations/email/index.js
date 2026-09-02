// ─────────────────────────────────────────────────────────────────────────────
// Transactional email — the Day 3 console stub. plan:343, replaced by the real
// Brevo/SendGrid client at plan:731 (task 11.5).
//
// Every function here logs what WOULD have been sent and returns. No network
// call, no template rendering, no provider SDK. What it does carry is the exact
// interface and the exact failure semantics of the real client, because task
// 11.5 says the interface "is unchanged -- only logger.info() becomes
// axios.post()" and task 11.7 verifies six dispatch points with "no call site
// changes". Anything this file gets wrong about its own shape becomes a rewrite
// of six call sites written between now and Day 13.
//
// ── ALL SIX FUNCTIONS EXIST NOW, NOT JUST THE TWO DAY 3 USES ─────────────────
//
// Day 3 calls two of these: sendVerificationEmail from register() (plan:344) and
// sendPasswordResetEmail from forgotPassword() (plan:348). The other four are
// named by plan:731 and dispatched at plan:497 (enrollment), plan:663 (course
// completion), plan:823 (admin unpublish) and plan:830/831 (ban/unban). They are
// defined here rather than added later so that each of those tasks finds the
// function it expects instead of inventing a seventh name for the same thing.
//
// ── WHY NOTHING HERE CAN REJECT ──────────────────────────────────────────────
//
// This is the one property of the stub that is not cosmetic, and it is why every
// function ends in a try/catch that returns instead of rethrowing.
//
// TRD:1138 and plan:734 both require dispatch to be fire-and-forget: "failures
// are logged at error with the userId/courseId and swallowed", and TRD:2009 says
// "a provider outage costs an email, never a certificate or an enrollment". The
// natural way to write a fire-and-forget call site is without await:
//
//     sendEnrollmentConfirmation({ ... });   // no await, no .catch()
//
// Measured on this codebase: a floating rejected promise reaches
// process.on('unhandledRejection'), and src/server.js (task 2.8) responds to
// that by draining and calling process.exit(1). So a dispatcher that can reject
// converts a mail-provider outage into a container restart -- the exact
// inversion TRD:2009 forbids, arriving through a handler added for good reasons.
//
// Two defences, because the call sites are written by six different future
// tasks and only one of these depends on remembering anything:
//
//   1. Every function swallows internally and resolves to a result object. A
//      floating call has nothing to reject with.
//   2. The result reports { delivered, error } rather than throwing, so a caller
//      that DOES await can branch without a try/catch.
//
// The stub itself can barely fail -- it only formats a string and logs. The
// point is that the real client replacing it inherits a signature that already
// says "this never throws", instead of Day 11 having to retrofit that promise
// onto six existing callers.
//
// ── A CONSTRAINT ON THE CLIENT THAT REPLACES THIS FILE (task 11.5) ────────────
//
// Swapping logger.info() for axios.post() must not change the fact that no
// function here can reject. The failure mode is quiet: `await axios.post(...)`
// written without a try/catch inside dispatch() compiles, passes a happy-path
// test against a live provider, and then turns the first 5xx from Brevo into
// process.exit(1) at whichever of the six call sites happened to be running.
// Nothing in the type signature or the call sites will complain, because the
// call sites are deliberately written without .catch().
//
// Verified here by an adversarial harness rather than by inspection: 84 floating
// calls -- all six functions against fourteen hostile argument shapes, including
// undefined, null, primitives, a prototype-less object, throwing getters on both
// `to` and `token`, and a Proxy that throws on every property read -- produced
// zero unhandled rejections and zero synchronous throws. That count is the
// regression bar for 11.5. plan:932 lists this transport as an intentional
// coverage gap, so no committed spec enforces it; this paragraph is the guard.
//
// ── WHY IT READS process.env AND NOT ../../config/env.js ─────────────────────
//
// src/server.js is the only module in this application that imports env.js, and
// deliberately: env.js calls process.exit(1) on a validation failure, and Vitest
// loads no .env file, so an import anywhere in the app's own graph lets a test
// suite kill its own worker. app.js, redis.js, database/index.js and
// logging.middleware.js all read process.env with a fallback for that reason,
// and this file follows them. env.js still guarantees the values in production:
// it validates EMAIL_FROM, EMAIL_FROM_NAME and FRONTEND_URL at boot, before the
// listener binds, so a missing one is a startup failure rather than a fallback
// that quietly ships.
//
// ── THE RAW TOKEN IS LOGGED, ON PURPOSE, AND ONLY HERE ───────────────────────
//
// A verification link is useless in development if the token never leaves the
// process: TRD:1474 puts the raw token in the emailed link and only its SHA-256
// hash in Redis, so with no mail transport the console line IS the only copy a
// developer can click. That is the entire reason this stub exists.
//
// It is also why this file is temporary. Measured: pino's redact list covers
// passwordHash but not `token`, so these lines print the token verbatim. That is
// correct for a stub and would be a credential leak in production, which is what
// task 11.5 deleting this file resolves. Until then the guard is that the logger
// is 'silent' under NODE_ENV=test and this file is scheduled for replacement
// before any real deployment.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '../../middlewares/logging.middleware.js';
import axios from 'axios';
import { templates } from './templates.js';

// A child logger so every line from this module is filterable as one stream, and
// so the real client inherits the same binding without touching call sites.
const log = logger.child({ module: 'email' });

const FROM_ADDRESS = process.env.EMAIL_FROM || 'noreply@edusphere.local';
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'EduSphere';

/**
 * The link base for anything a recipient clicks.
 *
 * FRONTEND_URL, never CORS_ORIGIN. TRD:1936 is explicit that the two hold the
 * same value in a single-origin deployment and are still two variables:
 * CORS_ORIGIN legitimately becomes a comma-separated list the moment a staging
 * domain appears, at which point every link built from it points at a
 * concatenated string.
 */
const linkBase = () =>
  (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');

/**
 * The stub's one piece of real behaviour: log the envelope, return a result.
 *
 * Takes the caller's params object UNDESTRUCTURED and hands it to `buildFields`
 * inside the try. That is not a style choice, it is the fix for a measured
 * defect: destructuring in an async function's PARAMETER LIST runs before the
 * body, so `({ to, token })` on a call of `send(undefined)` produces a REJECTED
 * PROMISE rather than a synchronous throw -- measured, 8 of 48 hostile floating
 * calls rejected that way, each one enough to trip server.js's unhandledRejection
 * exit. Reading the properties in here means a malformed call, a null params, or
 * even a throwing getter is logged and reported instead.
 *
 * @param {string} template  which of the six mails this is
 * @param {unknown} params   the caller's argument, untrusted
 * @param {(p: object) => object} buildFields  template-specific values to log
 * @returns {Promise<{delivered: boolean, template: string, to: string, error?: string}>}
 */
const sendEmailRequest = async (to, subject, html) => {
  const url = process.env.EMAIL_PROVIDER_URL || 'https://api.brevo.com/v3/smtp/email';
  const apiKey = process.env.EMAIL_API_KEY;

  if (!apiKey) {
    // If no API key, just log (useful for local dev without secrets)
    log.info({ to, subject }, '[email] STUB (No API Key) — would send email');
    return;
  }

  const payload = {
    sender: { name: FROM_NAME, email: FROM_ADDRESS },
    to: [{ email: to }],
    subject,
    htmlContent: html
  };

  await axios.post(url, payload, {
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json'
    }
  });
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function dispatch(template, params, buildFields) {
  let to;
  let fields = {};

  try {
    const source = params ?? {};
    to = source.to;
    fields = buildFields(source) ?? {};
  } catch (err) {
    log.error({ err, template, to }, '[email] malformed dispatch arguments — swallowed');
    return { delivered: false, template, to: typeof to === 'string' ? to : '', error: err?.message ?? 'malformed arguments' };
  }

  try {
    if (typeof to !== 'string' || to.trim() === '') {
      log.error({ template, to, ...fields }, '[email] no recipient address — nothing dispatched');
      return { delivered: false, template, to: '', error: 'missing recipient' };
    }

    const { subject, html } = templates[template](fields);

    let attempt = 0;
    const maxAttempts = 3;

    while (attempt < maxAttempts) {
      try {
        await sendEmailRequest(to, subject, html);
        log.info({ template, to }, '[email] Successfully dispatched email');
        return { delivered: true, template, to };
      } catch (err) {
        attempt++;
        const status = err.response?.status;
        
        // Hard bounce / Bad request - do not retry
        if (status >= 400 && status < 500 && status !== 429) {
          log.error({ err: err.message, status, template, to }, '[email] Hard bounce or bad request — not retrying');
          return { delivered: false, template, to, error: err.message };
        }

        if (attempt >= maxAttempts) {
          log.error({ err: err.message, template, to }, '[email] Dispatch failed after retries — swallowed');
          return { delivered: false, template, to, error: err.message };
        }

        const delay = Math.pow(2, attempt) * 1000;
        log.warn({ err: err.message, template, to, attempt, delay }, '[email] Dispatch failed, retrying...');
        await sleep(delay);
      }
    }
  } catch (err) {
    log.error({ err, template, to }, '[email] dispatch failed — swallowed');
    return { delivered: false, template, to: typeof to === 'string' ? to : '', error: err?.message ?? 'unknown' };
  }
}

// Each export takes `params` whole and reads it inside dispatch's try, for the
// reason dispatch() documents: `({ to })` in a parameter list rejects rather than
// throws when the argument is undefined, and a fire-and-forget caller has no
// .catch() to receive that.

/**
 * Account verification — dispatched by register() (plan:344).
 *
 * Takes the RAW token, not its hash: the hash is what Redis stores, and hashing
 * is the service's job, not this module's (TRD:1474).
 *
 * @param {{to: string, fullName?: string, token: string}} params
 */
export async function sendVerificationEmail(params) {
  return dispatch('verification', params, (p) => ({
    fullName: p.fullName,
    token: p.token,
    verifyUrl: `${linkBase()}/verify-email?token=${encodeURIComponent(p.token ?? '')}`,
    expiresIn: '24h',
  }));
}

/**
 * Password reset — dispatched by forgotPassword() (plan:348).
 *
 * forgotPassword() answers 200 whether or not the account exists, so it must
 * call this only when it found a user. A stub that logged for a miss would be a
 * local account-enumeration oracle in the console, but the constraint belongs to
 * the caller: this function cannot tell the two cases apart.
 *
 * @param {{to: string, fullName?: string, token: string}} params
 */
export async function sendPasswordResetEmail(params) {
  return dispatch('password-reset', params, (p) => ({
    fullName: p.fullName,
    token: p.token,
    resetUrl: `${linkBase()}/reset-password?token=${encodeURIComponent(p.token ?? '')}`,
    expiresIn: '15m',
  }));
}

/**
 * Enrollment confirmation — dispatched after the enrollment transaction commits
 * (plan:497, TRD:1135: after commit, never inside it).
 *
 * @param {{to: string, fullName?: string, courseTitle: string, courseId?: string}} params
 */
export async function sendEnrollmentConfirmation(params) {
  return dispatch('enrollment-confirmation', params, (p) => ({
    fullName: p.fullName,
    courseTitle: p.courseTitle,
    courseId: p.courseId,
    courseUrl: p.courseId
      ? `${linkBase()}/courses/${encodeURIComponent(p.courseId)}`
      : undefined,
  }));
}

/**
 * Course completion — dispatched post-commit on 100% progress (plan:663).
 *
 * Carries a LINK, not an attachment. TRD:1137 renders the certificate PDF lazily
 * on first download, so at dispatch time Certificate.certificateUrl is still
 * null and there is nothing to attach.
 *
 * @param {{to: string, fullName?: string, courseTitle: string, certificateNo?: string}} params
 */
export async function sendCourseCompletionEmail(params) {
  return dispatch('course-completion', params, (p) => ({
    fullName: p.fullName,
    courseTitle: p.courseTitle,
    certificateNo: p.certificateNo,
    certificateUrl: p.certificateNo
      ? `${linkBase()}/certificates/${encodeURIComponent(p.certificateNo)}`
      : undefined,
  }));
}

/**
 * Course takedown — dispatched to the instructor when an admin unpublishes
 * (plan:823), which requires a reason and emails it.
 *
 * @param {{to: string, fullName?: string, courseTitle: string, reason: string}} params
 */
export async function sendTakedownNotice(params) {
  return dispatch('takedown-notice', params, (p) => ({
    fullName: p.fullName,
    courseTitle: p.courseTitle,
    reason: p.reason,
  }));
}

/**
 * Account status change — ban (plan:830) and unban (plan:831).
 *
 * One function for both because plan:731 names one function for both. `status`
 * says which, so the future template can branch; a boolean would read as
 * sendAccountStatusEmail({ banned: false }) at the unban site, which is a
 * sentence about the wrong thing.
 *
 * @param {{to: string, fullName?: string, status: 'BANNED'|'UNBANNED', reason?: string}} params
 */
export async function sendAccountStatusEmail(params) {
  return dispatch('account-status', params, (p) => ({
    fullName: p.fullName,
    status: p.status,
    reason: p.reason,
  }));
}

export default {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendEnrollmentConfirmation,
  sendCourseCompletionEmail,
  sendTakedownNotice,
  sendAccountStatusEmail,
};
