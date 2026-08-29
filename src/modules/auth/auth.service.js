// ─────────────────────────────────────────────────────────────────────────────
// Auth service — TRD §6.1, §7. Task 3.3 opened this file with register() and task
// 3.4 adds login(); refresh, logout, password recovery and email verification
// land here as tasks 3.5–3.8 and share the helpers at the top.
//
// The service knows nothing about HTTP. It returns plain objects and throws from
// the AppError taxonomy; the controller (task 3.9) turns those into envelopes and
// status codes (plan:1021). That is why there is no `res` anywhere below, and why
// the one place this file reaches for a status code — a 409 versus a 503 — does it
// by choosing a constructor rather than a number.
//
// ── WHY THE REDIS WRITE SITS INSIDE THE POSTGRES TRANSACTION ─────────────────
//
// register() writes two stores: the `users` row in PostgreSQL and the
// `verify:email:<sha256(token)>` key in Redis. The obvious arrangement is to
// commit the user first and then write the token, because a transaction that
// spans a second datastore is a distributed-transaction fiction and holds a pool
// connection open across a network call to something else.
//
// It is still wrong here, and the reason is a gap in the endpoint surface rather
// than a preference. THERE IS NO RESEND-VERIFICATION ENDPOINT: searched, the
// string "resend" appears nowhere in EduTRD.md, docs/apidoc.md or
// IMPLEMENTATION_PLAN.md, and TRD §6.1 lists exactly one way to obtain a
// verification token — registering. So a user row that commits without its token
// is not "unverified for now", it is unverifiable forever. TRD:1482 makes that
// permanent state expensive: the account can log in and browse, and is refused by
// POST /enrollments, POST /courses and every quiz submission for the rest of its
// life. It cannot even start over, because re-registering the same address is the
// 409 below.
//
// Rolling the user row back instead costs the caller a 503 and a retry, which is
// the strictly recoverable failure. So the token write is inside the transaction,
// and a Redis outage means no account was created rather than a broken one.
//
// The cost is bounded and was measured, not assumed. With Redis stopped,
// register() threw its 503 after 626 ms and created no row: at the start of an
// outage src/config/redis.js's maxRetriesPerRequest (2) is what fires, and as the
// outage lengthens and the backoff grows its commandTimeout takes over with a
// hard ~1 s ceiling on any single command. Prisma's default interactive
// transaction deadline is 5000 ms — read out of its own P2028 error text rather
// than the docs — so both bounds sit comfortably inside it. The worst case is a
// transaction held ~1 s longer than usual during an outage that is already
// failing every request.
//
// What this does NOT buy is atomicity, and the residual failure is worth naming
// for task 3.8: if the Redis write succeeds and the COMMIT then fails, the token
// survives pointing at a userId that was rolled back. verifyEmail() must
// therefore treat "key resolved to a userId with no matching user" as an invalid
// token rather than as an impossible state. It self-heals in 24 h either way.
//
// ── THE 409 IS GENERIC, AND THE PRE-CHECK IS NOT WHAT GUARANTEES IT ──────────
//
// TRD:1480 requires register to return "a generic 409 that does not distinguish
// 'already registered' from other conflicts", so the throw below carries
// MESSAGES.COMMON.CONFLICT and never the wording in apidoc §8.2's 409 row — that
// row describes the trigger, the way apidoc §5's 409 row lists six unrelated
// triggers for the same code, and is not a response body.
//
// Uniqueness is checked twice on purpose, and only the second check is load-
// bearing. The findUnique() pre-check exists because plan:344 puts it first and
// because it keeps ~290 ms of bcrypt off the duplicate-registration path; it is
// inherently racy, since two concurrent registrations of one address both pass it.
// The `email @unique` index is what actually decides, and the P2002 catch is what
// turns its verdict into the same 409 the pre-check produces. That the catch is
// load-bearing rather than defensive was demonstrated: two register() calls for
// one fresh address launched together produced one row, one success and one
// rejection, and the loser's 409 came from this catch. Converting P2002
// here rather than leaning on normalizeError() — which already maps it to an
// identical 409 — keeps the service's contract true without an HTTP layer
// underneath it, so a unit test can assert the conflict directly.
//
// Neither check filters on `deletedAt`, which looks like an omission and is not:
// TRD:1497 rewrites a deleted account's email to `deleted-<uuid>@invalid`
// specifically so the original address becomes reusable, so a soft-deleted row
// no longer holds the address being registered. Were one to hold it anyway, the
// unique index would refuse the insert and the answer would still be 409.
//
// ── WHAT register() DELIBERATELY DOES NOT RETURN ─────────────────────────────
//
// A conflict between the two documents, resolved in favour of the plan and left
// visible here rather than silently.
//
// plan:344 ends "return sanitized user object (no passwordHash)". apidoc §8.2's
// 201 body is `data: { user: {...}, accessToken: "eyJ..." }`. Minting that token
// is task 3.4's job — it is the task that introduces JWT_SECRET, the 15-minute
// lifetime and the `jti` — and it does not exist yet, so this function cannot
// produce one without pre-empting it.
//
// So register() returns the user, and task 3.9's controller is responsible for
// composing `{ user, accessToken }` from 3.4's helper. That helper is
// signAccessToken(), extracted in 3.9 from the identical `jwt.sign` calls login()
// and refresh() were each holding, and it takes a ROW — a `data.user` object is a
// valid argument. Two notes for whoever reads it: a register-issued access token
// arrives at requireAuth (3.10) with no
// `user:state:<id>` record, because plan:376 writes that key on login, on
// ban/unban and on role change but not on registration — which is survivable
// only because a MISS on user:state is defined to fall through to PostgreSQL and
// re-derive the truth (src/utils/cache-keys.js:316), unlike a Redis outage, which
// fails closed. If 3.10 instead treats an absent key as "not authorized", a
// register-issued token is dead on arrival and this is where that starts.
//
// The second note is that register() opens NO session: no refresh token, no
// `session:<jti>`, no cookie. apidoc §8.2 gives the 201 an `accessToken` and says
// nothing about a cookie, where login's 200 spells the cookie out — so a new
// account holds a 15-minute credential and must log in to get a renewable one.
//
// ═════════════════════════════════════════════════════════════════════════════
// login() — task 3.4
// ═════════════════════════════════════════════════════════════════════════════
//
// ── WHY LOGIN SPENDS ~370 ms ON A PASSWORD IT ALREADY KNOWS IS WRONG ─────────
//
// MESSAGES.AUTH.INVALID_CREDENTIALS is "deliberately identical for an unknown
// email and a wrong password" so the login form cannot be used to test whether an
// address has an account. The obvious implementation throws that message away for
// free: `if (!user) throw Unauthorized` returns before bcrypt runs, so an unknown
// address answers in about a millisecond while a known address with a wrong
// password spends a full cost-12 comparison first. The message is identical and
// the RESPONSE TIME is not, which is the same oracle with extra steps.
//
// Measured here over 7 runs each, cost 12: no comparison at all is ~0.0 ms, a
// comparison against a real hash is 373 ms median (349-448). A 373 ms split is not
// a subtle side channel — it is legible over the internet, in one request, without
// statistics.
//
// So a miss compares against DECOY_HASH instead of returning early, and both paths
// pay for one comparison. Re-measured with the decoy in place: 396 ms median
// (351-468) for the miss against 373 ms (349-448) for the wrong password, a 23 ms
// median gap between two ranges that almost entirely overlap. That residual is
// scheduling noise rather than signal, and the AUTH rate-limit tier (5 requests /
// 15 min, RATE_LIMITS.AUTH) is what makes averaging it away impractical. The claim
// is "no single-request oracle", not "constant time".
//
// What this deliberately does NOT do is skip the comparison when the password
// could not possibly match. Every early exit is a timing branch.
//
// ── PASSWORD FIRST, THEN THE ACCOUNT CHECKS ──────────────────────────────────
//
// plan:345 orders it "verify password hash → check isBanned → check deletedAt",
// and the order is the point rather than an incidental. Checking the ban first
// would answer 403 to anyone who merely guessed an address, which tells a stranger
// both that the account exists and that it is banned. After the password check,
// the 403 of apidoc §8.2 is only ever read by someone who owns the credentials —
// which is exactly why that row can afford to be honest ("the caller proved
// identity; the account is denied") where the 401 above cannot.
//
// The deletedAt check is defence in depth and looks like dead code. TRD:1497
// rewrites a soft-deleted account's email to `deleted-<uuid>@invalid`, so the
// lookup normally misses and the answer is the 401, not the 403. It stays because
// nothing in the schema enforces that rewrite: a row soft-deleted by a path that
// forgets it would otherwise keep logging in forever. Note the check is
// `!== null` rather than a truthiness test, so a future select that drops the
// column denies every login instead of admitting every deleted account — loud, and
// in the safe direction.
//
// ── TWO KEYS, TWO JTIS, AND WHICH ONE NAMES THE SESSION ──────────────────────
//
// Access tokens are signed with JWT_SECRET and refresh tokens with
// JWT_REFRESH_SECRET (TRD:1669), "two distinct keys, so a leaked access-signing
// key cannot mint refresh tokens". plan:384 states the observable form of that:
// a refresh token presented as a Bearer token must fail signature verification.
// The `type` claim in each payload is secondary — RFC 8725 §3.11 defence in depth
// so 3.5 and 3.10 can also reject a confused token explicitly — and must never
// become the thing a verifier relies on instead of the key.
//
// env.js already refuses identical secrets at boot, and jwtConfig() below checks
// it again on every call. That is not redundant: env.js is imported by
// src/server.js and by nothing else on purpose (it calls process.exit(1)), so this
// module cannot assume it ever ran. A script, a worker, or a test that reaches
// login() with one secret set for both classes gets a loud throw rather than
// silently minting interchangeable tokens.
//
// Both tokens carry their own unique jti, per plan:345. Only the REFRESH one is
// remembered. TRD §7.1 calls session:<jti> the "active refresh-token record", 3.5
// verifies the cookie's token and then looks for exactly that key, and 3.6 needs
// the same jti to UNLINK — all three reach it through the cookie, which TRD:1673
// makes readable only by /auth/refresh and /auth/logout. The access token's jti is
// generated and discarded: nothing indexes access tokens, because their revocation
// story is user:state plus a 15-minute lifetime, not a keyspace lookup per request
// (plan:376). Keeping them distinct means a leaked access token does not name the
// session key that would let its holder mint new ones.
//
// ── THE ORDER OF THE THREE REDIS WRITES IS A SECURITY PROPERTY ───────────────
//
// SADD the index entry, then SET the session, then SET user:state. Not the reading
// order, and not arbitrary.
//
// Any of the three can fail mid-sequence, so the question is which partial states
// are survivable. Index-first means a jti can exist in the index with no session
// key behind it, which plan:367 and TRD:1723 both declare inert — the index is
// specified as a SUPERSET, since nothing prunes a jti whose session merely expired,
// and "UNLINK on a dead jti is harmless". Session-first inverts that into a
// session:<jti> key that no index lists, and a session absent from the index is a
// session that "revoke all sessions" (plan:373) walks straight past — refreshable
// for its full 7 days and surviving the ban that was supposed to kill it. The
// weaker guarantee is the one worth holding: never a session the index does not
// know about.
//
// user:state goes last because its absence is the one failure the system already
// has a defined answer for. A MISS on user:state falls through to PostgreSQL and
// re-derives the truth (src/utils/cache-keys.js:316) — that is also why a
// register-issued token works at all — whereas an unreachable Redis fails closed
// (plan:379). A missing state key costs one query; the other two orderings cost
// correctness.
//
// The three are sequential awaits rather than a MULTI, and atomicity is worth what
// the paragraphs above say it is worth: the only reachable partial state is inert
// by specification, so a transaction would buy tidiness rather than safety. It
// would cost the setWithTTL guarantees — mandatory positive TTL, JSON encoding, EX
// re-applied on every write — which a pipelined raw SET would have to duplicate,
// and duplicated key handling is what cache-keys.js exists to prevent (TRD §7.1).
// Three local round trips are ~1 ms each.
//
// A failure in any of them is a 503 and NO TOKENS. Returning the pair anyway would
// hand back a working 15-minute access token whose refresh path is already dead,
// so the client discovers the outage 15 minutes later as an unexplained logout;
// 3.5 makes the same choice explicitly ("fail closed with 503 if Redis is
// unreachable"). The user row is untouched either way — login writes no Postgres —
// so unlike register() there is nothing to roll back.
//
// ── TWO TTLS SHADOW TWO ENV VARS, AND THE ENV VARS DO NOT WIN ────────────────
//
// TTL.session (7 days) and TTL.userState (15 minutes) are fixed in cache-keys.js,
// while the token lifetimes they mirror come from JWT_REFRESH_EXPIRES_IN and
// JWT_ACCESS_EXPIRES_IN. Raising JWT_REFRESH_EXPIRES_IN to 30d does not extend a
// session: the refresh token stays cryptographically valid while session:<jti>
// expires at 7 days, and 3.5 requires that key to exist, so the effective lifetime
// is the MINIMUM of the two. The failure is a working token that stops being
// accepted, which reads as a bug.
//
// Lowering JWT_ACCESS_EXPIRES_IN below 15 minutes is safe. Raising it is not, and
// plan:370 says why: user:state's TTL is 15 minutes BECAUSE that is the access
// token's lifetime, so a 1-hour access token means a banned user keeps working for
// up to an hour after the ban ("banned users rejected within one user:state TTL,
// not one access-token TTL", plan:388). Neither coupling is enforced here — that
// would mean re-implementing the `ms` duration grammar jsonwebtoken already owns —
// so it is documented instead, and the defaults below match the TTLs exactly.
//
// ═════════════════════════════════════════════════════════════════════════════
// refresh() — task 3.5
// ═════════════════════════════════════════════════════════════════════════════
//
// ── GETDEL IS WHAT MAKES A REFRESH TOKEN SINGLE-USE ──────────────────────────
//
// plan:346 orders it "confirm session:<jti> exists in Redis → rotate: UNLINK the
// old key, ...", which reads as GET followed by UNLINK. Written that way the
// rotation is not single-use, and the gap is not theoretical: measured against
// redis:7-alpine over 200 trials, four concurrent refreshes carrying ONE cookie
// were ALL admitted in 200 of 200 trials — every trial, not an unlucky few,
// because ioredis dispatches the four GETs before the first UNLINK lands. Four
// sessions from one token, and plan:390's "replay the OLD refresh token → expect
// 401" passes only because a sequential replay happens to lose the race.
//
// `GETDEL session:<jti>` collapses the check and the consumption into one command,
// so the request that ATOMICALLY REMOVED THE KEY is the one authorized to rotate.
// Same probe, same 200 trials: exactly one winner every time, min 1 max 1. That is
// the property the endpoint needs, and it is the same reasoning
// src/utils/cache-keys.js:41 already records for the verify and reset tokens —
// "two concurrent requests carrying the same token both pass a GET-then-UNLINK
// check. Redis 6.2+ has GETDEL for exactly this."
//
// Measured available: redis_version 7.4.9, and ioredis 5.11.1 exposes .getdel.
// GETDEL on an absent key returns null, which is the 401 below rather than an
// error. GETDEL against a key holding a Set throws WRONGTYPE and leaves the Set
// intact — unreachable here, because cache-keys' SEGMENT rule rejects the ':' a
// crafted jti would need to name the index key (cache-keys.js:75).
//
// ── EVERY REJECTION IS THE SAME 401, AND THE LIST IS LONGER THAN apidoc's ────
//
// apidoc §8.2 gives refresh exactly two failure codes, 401 and 503, and describes
// the 401 as "Cookie absent, expired, or its session:<jti> key no longer exists in
// Redis (revoked)". SEVEN throw sites below answer with that one code and
// MESSAGES.AUTH.SESSION_INVALID:
//
//   1. no cookie at all
//   2. a token that does not verify — bad signature, expired, malformed, or a
//      substituted algorithm
//   3. a `type` claim that is not 'refresh'
//   4. claims that cannot be used — no jti, or a non-string sub
//   5. a jti that would forge a different key shape
//   6. a session key that is gone — consumed, revoked, or expired
//   7. an account banned or soft-deleted since login
//
// The jwt failures were measured rather than guessed, so the catch covers real
// classes: the wrong key gives JsonWebTokenError "invalid signature", an absent or
// empty token "jwt must be provided", junk "jwt malformed", and a lapsed token
// TokenExpiredError "jwt expired". An ACCESS token presented here fails on
// "invalid signature" before its `type` claim is ever read, which is plan:391's
// deliverable and a property of the two keys rather than of the claim.
//
// THE BANNED ACCOUNT IS THE ONE THAT DEVIATES, and deliberately. login() answers
// 403 ACCOUNT_DISABLED for the same account, because a correct password buys an
// honest answer. Here the 403 would be free: apidoc lists no 403 for this
// endpoint, and answering one would make refresh the ban oracle that login's
// pricing exists to prevent. So it is the 401, the caller re-authenticates, and
// login is where they learn the truth. Day 13's ban already unlinks every session
// key for the user, so this check is defence in depth for a ban that lands by some
// path that forgets to.
//
// ── WHY REFRESH READS POSTGRES WHEN THE SESSION RECORD IS RIGHT THERE ─────────
//
// plan:346 names no database read, and the session record GETDEL just returned
// carries `userId` and `role`. It is still not enough, for two independent
// reasons.
//
// The access token has to carry `email`, because plan:351 has requireAuth build
// `req.user = { id, email, role }` from the token with no round trip. plan:356
// fixes the session record's shape at { userId, role, issuedAt, ip, userAgent } —
// no email — so a refresh-minted token without a query would arrive at 3.10
// missing a field that every request downstream expects. (An earlier revision of
// login()'s header claimed 3.5 "re-reads both from the session record". That was
// wrong about `email` and is corrected below.)
//
// And `role` in that record is up to 7 days stale. plan:376 writes user:state on
// role change but nothing rewrites a live session, so a demoted INSTRUCTOR would
// keep minting access tokens carrying the role they no longer hold, 15 minutes at
// a time, for the remaining life of the session. Re-reading is what bounds a
// demotion by one access-token lifetime instead of by seven days.
//
// The row is read with ACCOUNT_FIELDS, so `passwordHash` is never fetched at all —
// refresh compares no password, and the one place this module must select that
// column stays login().
//
// ── THE COMMIT POINT, AND WHY TWO WRITES ARE BEST-EFFORT ─────────────────────
//
// GETDEL destroys the old session before the new one exists, so this function has
// a window where the caller holds nothing. That direction is forced: writing the
// new session first and deleting the old afterwards means a failed delete leaves
// the OLD refresh token live, which is precisely the replay plan:383 and plan:390
// forbid. A user sent back to the login form is recoverable; a replayable refresh
// token is not.
//
// So the sequence has a commit point, and it is the `session:<newJti>` write:
//
//   SADD index newJti      -- fatal (503, no tokens). Index before session, for
//                             the reason login()'s header gives: never a session
//                             the index does not list.
//   SET session:<newJti>   -- fatal (503, no tokens). THE COMMIT POINT.
//   SET user:state         -- best-effort. Logged, rotation stands.
//   SREM index oldJti      -- best-effort. Logged, rotation stands.
//
// Before the commit point a failure means no tokens are returned and the caller
// re-authenticates. After it the rotation has HAPPENED, and throwing would be a
// lie: the client would discard a refresh token that is already the only live one,
// stranding a session that Redis has correctly recorded. Both post-commit writes
// are also harmless to lose. A missing user:state is a defined fallthrough to
// PostgreSQL (cache-keys.js:316), and a stale index member is inert by
// specification — plan:367 states it outright, and SREM of a non-member was
// measured to return 0 rather than error, so the next rotation's cleanup is a
// no-op either way.
//
// That makes user:state FATAL in login() and BEST-EFFORT here. The asymmetry is
// the point rather than an oversight: a failed login has destroyed nothing and
// costs a retry, while a failed refresh at that stage would throw away work Redis
// has already committed.
//
// ── A SLIDING SESSION, WITH NO ABSOLUTE CAP ──────────────────────────────────
//
// "Mint a new pair" (plan:346) means a full 7 days each time, so a client that
// refreshes every 14 minutes holds a session indefinitely and TTL.session is a
// 7-day idle timeout rather than a lifetime. Nothing in TRD §7 or apidoc §8.2
// specifies an absolute cap, so none is invented here; the honest note is that
// revocation is what ends a session, and `session:index:<userId>` (plan:373) is
// what makes that possible in one operation.
//
// ── WHAT refresh() DELIBERATELY LEAVES TO TASK 3.9 ───────────────────────────
//
// plan:346 also says "Set the cookie HttpOnly; Secure; SameSite=Strict;
// Path=/api/v1/auth" and "Reject on Origin/Referer mismatch". Neither is
// implemented here, because neither can be: this service has no `req` and no
// `res` (plan:1021), and both are properties of the HTTP exchange rather than of
// the rotation. They are task 3.9's, and they are load-bearing enough to name as
// obligations rather than leave implied:
//
//   1. The cookie attributes are exported below as REFRESH_COOKIE so that the
//      route that SETS the cookie and the route that CLEARS it cannot spell them
//      differently. Both spellings are 3.9's, because a service with no `res`
//      cannot emit a Set-Cookie header at all — plan:347 files the clear under
//      3.6, but only its Redis half can live in a service. logout()'s section of
//      this header carries the measurements for what the clear has to pass.
//   2. The Origin/Referer match against CORS_ORIGIN is REQUIRED, and on
//      /auth/logout too, not only here: TRD:1673 makes those two "the sole
//      cookie-reading routes" and the match is the CSRF defence that SameSite is
//      only the first half of. Nothing in this file can enforce that it happens.
//
// ═════════════════════════════════════════════════════════════════════════════
// logout() — task 3.6
// ═════════════════════════════════════════════════════════════════════════════
//
// ── LOGOUT HAS EXACTLY ONE ANSWER, AND IT IS 200 ─────────────────────────────
//
// apidoc §8.2 gives this endpoint one response row and no failure rows at all:
// 200, MESSAGES.AUTH.LOGGED_OUT, `data: null`. That is the contract rather than
// an omission to be filled in with refresh()'s 401 and 503, and every branch
// below is written to honour it — logout() throws for NO INPUT A CLIENT CAN
// SEND. (The one exception is jwtConfig()'s missing-secret Error, which is a
// deployment fault that breaks login() and refresh() identically; swallowing it
// would leave a logout that silently never revokes anything.)
//
// So every case refresh() answers 401 for — no cookie, a signature that does not
// verify, an expired token, the wrong `type`, an unusable jti — ends the same way
// here: nothing revoked, the controller clears the cookie, the caller gets 200.
// Idempotence is what forces that. A client logging out twice, or holding a
// cookie that expired over the weekend, or already logged out by a ban an hour
// ago, HAS ALREADY ARRIVED at the state it is asking for. Answering 401 would
// mean the only way to leave a session is to still be in one.
//
// ── WHY A REDIS OUTAGE IS NOT A 503 HERE, WHEN IT IS ON REFRESH ──────────────
//
// TRD:1684 states the rule as "fail-closed on security decisions, fail-open on
// convenience reads", and spells the closed case out as "a session lookup that
// cannot reach Redis returns HTTP 503 RATHER THAN ADMITTING THE REQUEST".
// Admitting is the operative word. refresh() and verifyEmail() fail closed
// because a Redis failure there would hand out something unverifiable — a token
// pair, a verified flag. Logout hands out nothing, so there is no decision to
// get wrong and nothing to fail closed on. That is why apidoc lists a 503 for
// refresh and for verify-email, and none for this route.
//
// The stronger argument is what a 503 would DO. The cookie clear lives in the
// response, so an error thrown from here means the controller never reaches
// res.clearCookie and THE BROWSER KEEPS A LIVE REFRESH COOKIE. On a shared
// machine, with Redis down:
//
//   503 — the session record survives AND so does the cookie. The next person at
//         that keyboard POSTs /auth/refresh and is issued a fresh pair.
//   200 — the session record survives, the cookie is gone. Only someone who
//         already exfiltrated the cookie can redeem it, which they could have
//         done before the logout too, and the record expires at 7 days.
//
// The 200 is the safer of the two for the person who clicked the button, not a
// convenience. What it costs is candour about the server-side record, so the
// failure is logged at ERROR — an operator has to know that revocations are
// silently not happening — and the return value says `revoked: false` for a
// caller that cares (Day 13's audit log).
//
// ── DELETES GO INDEX-LAST FOR THE SAME REASON WRITES GO INDEX-FIRST ──────────
//
// plan:347 orders it "UNLINK session:<jti> → SREM that jti from
// session:index:<userId>", and that order is load-bearing exactly as login()'s
// is. The index is specified as a SUPERSET of live sessions (plan:367,
// TRD:1723): it may list a jti whose session key is already gone, and it must
// never omit a jti whose session key is live.
//
// SREM first would break the second half. If the SREM landed and the UNLINK did
// not, the session would be live and unlisted — and Day 13's ban, which works by
// reading the index (plan:373), would MISS IT, leaving the banned account a
// redeemable refresh token for the remaining life of the key. So the session is
// destroyed first and the index is told afterwards.
//
// Which makes the UNLINK the commit point, and gives the two commands the same
// asymmetry refresh()'s four writes have:
//
//   UNLINK session:<jti>  -- THE COMMIT POINT. On failure: log at error, SKIP
//                            the SREM, return { revoked: false }. Skipping is
//                            the point; pruning the index for a session that may
//                            still be live is precisely the inversion above.
//   SREM index jti        -- best-effort. Logged at warn, the logout stands. A
//                            leftover member is inert by specification, and SREM
//                            of a non-member returns 0 rather than throwing.
//
// UNLINK rather than DEL because plan:347 says so and because it is the right
// command — reclaiming the String happens on a background thread, and this is a
// user-facing request. Measured against redis 7.4.9: 1 for a live key, 0 for one
// already gone, 0 for a key that never existed, and no throw in any case. So the
// idempotence above costs no extra round trip to check existence first, and the
// return value is what distinguishes "logged out" from "there was nothing to log
// out of" (the same reasoning plan:367 gives for Day 13's revokedSessions count).
//
// ── A FORGED JTI IS MORE DANGEROUS HERE THAN IT IS IN refresh() ──────────────
//
// Both functions build the key with keys.session(), which rejects a jti outside
// /^[A-Za-z0-9._-]+$/ (cache-keys.js:75), and both treat a rejection as a
// nothing-to-do case rather than an error. But the guard is doing different work
// in the two places, and here it is doing more.
//
// In refresh(), a jti of `index:<victimId>` that got through would make
// keys.session() emit `session:index:<victimId>` — the victim's index key — and
// GETDEL against a Set answers WRONGTYPE with the Set intact (line 277). The
// attack fails on Redis's own type checking.
//
// UNLINK HAS NO SUCH TYPE CHECK. Measured: UNLINK on the index Set returns 1 and
// the Set is gone. The same forged jti here would therefore delete a victim's
// entire session index, and every session it listed becomes unrevocable — a ban
// on that account would find an empty set, report zero sessions revoked, and
// leave every one of them live until it expired. Calling the real key builder
// instead of interpolating a template string is the whole of the defence.
//
// ── THE COOKIE CLEAR, AND THE ONE ATTRIBUTE THAT DECIDES WHETHER IT WORKS ────
//
// plan:347's third step — "clear the refresh cookie with the SAME
// Path=/api/v1/auth attribute it was set with" — is 3.9's to execute, since a
// service with no `res` cannot set a header. REFRESH_COOKIE above exists so the
// attributes cannot be spelled differently in the two places, and the call is
//
//   res.clearCookie(REFRESH_COOKIE.name, REFRESH_COOKIE.options)
//
// Two things about that were measured rather than assumed, because a cookie that
// fails to clear raises no error anywhere and the bug is invisible until someone
// notices a "logged out" browser can still refresh.
//
// REFRESH_COOKIE.options carries maxAge, and clearCookie() is implemented on top
// of res.cookie(), which derives `expires` FROM maxAge. Passed through naively
// that would set the cookie to expire seven days in the FUTURE, clearing
// nothing. express 5.2.1 deletes it first — `delete opts.maxAge`, with the
// comment "ensure maxAge is not passed" (express/lib/response.js:720) — and the
// header measured on this version is `refreshToken=; Path=/api/v1/auth;
// Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`.
// Passing the options object whole is safe here by design rather than by luck,
// and if that express behaviour ever changes this is the note that says what to
// re-measure.
//
// clearCookie's own default is `path: '/'`. Called with no options at all it
// emits `Path=/`, which does not match the cookie login() set and so does not
// remove it — also measured. plan:347's insistence on the same Path is not
// tidiness; it is the difference between a logout that works and one that only
// looks like it did.
//
// ── WHAT LOGOUT CANNOT REVOKE, AND WHY THAT IS NOT A GAP TO CLOSE HERE ───────
//
// The access token stays valid until it expires. Nothing in this design recalls
// it: 3.10's requireAuth verifies the signature and reads user:state:<userId>
// (plan:351), and neither of those changes when a session key is unlinked. So
// for up to JWT_ACCESS_EXPIRES_IN after a logout, the Bearer token the client
// just discarded would still be accepted if it were replayed.
//
// That is the trade plan:369 makes deliberately — a per-request session lookup is
// the cost the user:state fast path exists to avoid — and 15 minutes is the
// number chosen to bound it (plan:370). Closing it in logout() would mean a jti
// denylist consulted on every authenticated request, which is the same
// per-request read in a different coat. It is named here because plan:383's
// "register → verify email → login → protected route → refresh → logout" reads
// as though logout ends everything, and the honest statement is that it ends the
// ability to OBTAIN a new access token.
//
// Nor does logout touch user:state. Ending a session changes none of `role`,
// `isBanned`, `isEmailVerified` or `deletedAt`, so rewriting that record would
// only reset a TTL for nothing.
//
// And it revokes ONE session. apidoc §8.2 is explicit — "Unlinks session:<jti>"
// — so a phone stays signed in when a laptop signs out. The all-sessions
// operation exists and belongs to the tasks that need it: password reset (3.7)
// and ban (Day 13), both through SMEMBERS on the index set.
//
// ── WHAT logout() LEAVES TO TASK 3.9 ─────────────────────────────────────────
//
// The cookie clear above, and the Origin/Referer match against CORS_ORIGIN that
// TRD:1673 requires on this route as much as on /auth/refresh — those two being
// "the sole cookie-reading routes", with SameSite=Strict only the first half of
// the CSRF defence. A forced cross-site logout is a nuisance rather than a
// breach, but it is a nuisance the contract says to prevent.
//
// This function also does not check that the caller is authenticated. apidoc
// §8.2 guards the route as Authenticated and 3.10's requireAuth is what enforces
// it; what arrives here is `req.user.id`, and the only thing logout() does with
// it is refuse to revoke a session that belongs to someone else.
//
// ── FORGOT-PASSWORD HAS ONE ANSWER, AND REDIS DOWN MUST NOT CHANGE THAT ──────
//
// TRD:1480 and apidoc §8.2 agree, and apidoc gives the route a single row: 200,
// with an identical body whether or not an account exists for the address.
// Anything else is an account-enumeration oracle, and since the route is
// unauthenticated the oracle would be open to everyone.
//
// The status code is the easy half. The half that is easy to get wrong is what
// happens when Redis is unavailable, because TRD:1478 makes Redis a HARD
// dependency here — "verification and reset fail closed with 503" — and the two
// branches do not touch it the same number of times:
//
//   the address exists       — a token is written, setWithTTL throws, 503.
//   the address does not     — nothing is written, nothing throws, 200.
//
// A Redis outage would therefore turn this route into precisely the oracle the
// shared 200 exists to prevent, and an exact one rather than a statistical one:
// 503 means the account is real. It is also remotely triggerable by anyone able
// to push Redis over.
//
// So the no-account branch spends one unconditional Redis command — an EXISTS
// against a key derived from a throwaway token, which cannot be present — for the
// sole purpose of failing where the other branch fails. Both branches then answer
// 503 together, or 200 together.
//
// THAT DECOY IS NOT A TIMING DEFENCE, and it would be a weak one. Measured on
// this stack: the PostgreSQL lookup differs by 0.094 ms between a hit and a miss
// (1.494 ms against 1.400 ms, 40 runs each), one Redis round trip costs 0.740 ms,
// and the hit branch makes up to four of them against the miss branch's one. So
// roughly 2 ms of the response latency does still correlate with the account
// existing. What makes that unreachable is the rate limit apidoc:140 puts on this
// route — 5 requests per 15 minutes, 480 samples a day — against a ~2 ms signal
// under network jitter of tens of milliseconds. The outage asymmetry is a
// single-request certainty; the timing asymmetry is not. The decoy is there for
// the first, and claiming it addresses the second would be worse than saying it
// does not.
//
// ── forgotPassword() RETURNS NOTHING, ON PURPOSE ─────────────────────────────
//
// Not `{ sent: true }`, not the user, not a boolean. undefined.
//
// logout() returning `{ revoked }` is safe because a caller who leaks it leaks
// nothing — whoever reads it already owned the session. Here the same shape would
// be a loaded gun: `{ sent: false }` IS the enumeration answer, sitting in the
// service's return value, one plausible controller away from being serialised
// into `data`. 3.9 is meant to answer with the message and nothing else.
//
// A function that cannot report which branch it took cannot be made to leak which
// branch it took. The operator-facing half of that goes to the log, where no
// client reads it.
//
// ── TRD:1477 NEEDS A KEY THAT §7.1's TABLE DOES NOT LIST ─────────────────────
//
// "Issuing a new token for the same purpose invalidates the previous one"
// (TRD:1477). plan:348 does not ask for it and §7.1's table has no row for it, so
// this is the one part of 3.7 that goes past the task's literal text — said plainly
// here because it is the part a reviewer should consciously keep or delete.
//
// It cannot be built from the table as written. `reset:pw:<sha256(token)>` is
// derived FROM the token and stores only the userId, so a second forgot-password
// knows the user and has no way back to the first token's key: the digest is
// one-way and the raw token was never persisted (TRD:1474). Without a reverse
// pointer, TRD:1477 is unimplementable and every token issued stays live for its
// full 15 minutes — ask three times, and three links work.
//
// keys.passwordResetPointer(userId) is that pointer: `reset:pw:user:<userId>`
// holding the token key currently valid for that user. Three properties are what
// made it safe enough to add:
//
//   It cannot collide with a token key. A sha256 digest is 64 characters of
//   [0-9a-f] and cannot contain a colon, so `user:<uuid>` is not a shape
//   passwordReset() is able to emit (measured).
//
//   It is written AFTER the token it names, and its failure is best-effort. A
//   pointer that never landed degrades this route to exactly the behaviour it
//   would have without any of this — the previous token lives out its TTL —
//   rather than to a reset that does not work.
//
//   What it names is validated before anything is deleted. isPasswordResetKey()
//   gates the UNLINK, because this is the one place in this codebase where a
//   value read out of Redis chooses which key gets destroyed. Ungated, a pointer
//   holding `session:index:<victimId>` would make a forgot-password delete that
//   victim's session index — the same "UNLINK has no type check" hazard as line
//   494, arrived at through a value rather than through a jti.
//
// ── THE ORDER OF resetPassword(), AND WHY REVOKE-ALL COMES LAST ──────────────
//
// plan:348 fixes it: hash the presented token, look it up, delete it before
// accepting the new password, hash the new password, update the user, then revoke
// every session. Two of those positions carry weight.
//
// THE TOKEN DIES BEFORE THE NEW PASSWORD IS ACCEPTED. GETDEL is what makes it
// single-use (TRD:1475: "deleted in the same operation that consumes it";
// cache-keys.js:41), and that delete has to precede the ~290 ms bcrypt hash
// rather than follow the update. Two requests replaying one intercepted token
// concurrently both pass a GET-then-delete, and the loser still gets to set a
// password — so the window is not theoretical, it is 290 ms wide by construction.
//
// REVOCATION IS LAST, AFTER THE PASSWORD HAS CHANGED. TRD:1476 requires a reset
// to "log out any attacker already holding a refresh token", and revoking first
// would satisfy the letter of that while leaving a hole: between the revocation
// and the update the account's OLD password is still live, and the attacker who
// knows it — the reason the victim is resetting at all — can POST /auth/login in
// that interval and hold a session the reset never touches. Changing the password
// first shuts login before the sweep, so no new session can appear behind it.
//
// ── WHAT GETDEL HANDS BACK IS JSON, NOT A USER ID ────────────────────────────
//
// setWithTTL JSON.stringifies everything it writes (cache-keys.js:344), so the
// userId stored under a reset key comes back out of GETDEL as `"<uuid>"` WITH THE
// QUOTES — measured: '"probe37-user-id"'. Used as it arrives it becomes
// `where: { id: '"6f0e…"' }`, which matches no row, raises P2025, and would be
// answered by this function as "Invalid or expired token".
//
// It gets a paragraph because of how it would present: every reset link in
// production failing with a message claiming the link expired, on a path whose
// unit tests all pass if the mock stores the value the same way the code reads it.
// So the parse is explicit, its result is shape-checked, and a value that is not a
// JSON string is logged at ERROR — nothing but this module writes those keys, so a
// malformed one is corruption or tampering rather than anything a user did.
//
// refresh() does not have this problem and needs no such handling: it reads the
// session record only to learn whether the key was there, and takes the userId
// from the verified JWT's `sub` claim (line 1181). Checked before writing this,
// not assumed.
//
// ── THE SESSION SWEEP IS FATAL HERE, WHERE THE SAME COMMAND IS NOT IN logout ─
//
// logout() answers 200 when its UNLINK fails (line 421). resetPassword() answers
// 503 when its sweep fails, and the difference is not inconsistency.
//
// In logout, revocation is the whole of what the caller asked for, and failing it
// costs one session that expires on its own — while a 503 there would strand a
// live cookie in the browser of someone who asked to be signed out, which is the
// worse of the two outcomes for the person at the keyboard.
//
// In a reset, revocation is part of what a reset IS. TRD:1476 makes it a defined
// component of the operation, and the caller is very often someone who believes
// their account is compromised. Reporting success over a sweep that did not
// happen tells that person the attacker is gone when the attacker still holds a
// redeemable refresh token. The password has already changed by then, so the 503
// is honest rather than destructive: it says "your password is changed and I could
// not finish signing your other devices out", which is exactly the state.
//
// The index Set's own UNLINK is best-effort behind that, at warn. Once every
// session key is gone the Set is a list of names for keys that do not exist, and
// plan:367 and TRD:1723 both define the index as a SUPERSET — stale members are
// inert by specification. The stale pointer is dropped in the same breath, for the
// same reason.
//
// A member that cannot be turned into a key is SKIPPED rather than fatal. Nothing
// but login() and refresh() write that Set, and both write randomUUID jtis, so a
// member keys.session() refuses means the keyspace was tampered with — but making
// it fatal would be a poison pill: every retry would hit the same bad member and
// the account could never be reset at all. Skip it, warn, revoke the rest.
//
// ── WHAT A RESET STILL CANNOT REVOKE ─────────────────────────────────────────
//
// Access tokens. Same 15-minute residual logout has (line 531), for the same
// reason — 3.10's requireAuth reads user:state, not the session record — so an
// attacker's already-issued Bearer token keeps working for up to
// JWT_ACCESS_EXPIRES_IN after the victim resets. TRD:1476's wording is scoped to
// "a refresh token", which the index sweep does satisfy in full, so this is a
// residual of plan:369's deliberate trade rather than a miss against the
// requirement. It is named because "log out any attacker" reads stronger than
// what any design without a per-request session lookup can deliver.
//
// user:state is not rewritten. A password change alters none of `role`,
// `isBanned`, `isEmailVerified` or `deletedAt`, so there is nothing in that record
// to correct and rewriting it would only reset a TTL.
//
// A BANNED account can complete a reset. The token was earned by controlling the
// mailbox, the ban is enforced by login's 403 (line 150), and every session is
// swept regardless — so the reset changes a hash the banned user still cannot use.
// Refusing here would instead answer differently for banned and unbanned
// addresses, which hands back a ban oracle on an unauthenticated route. A
// SOFT-DELETED account is a different case and is excluded: `deletedAt: null` is
// part of the lookup, so no link is ever issued for one.
//
// ── WHAT 3.7 LEAVES TO TASK 3.9 ──────────────────────────────────────────────
//
// The 5-per-15-minutes limit on both routes (apidoc:140), which is what keeps the
// residual timing signal above out of reach and what stops the mailer being used
// as an amplifier; the response bodies; and the decision not to expose
// `revokedSessions` to the client — it is returned here for the audit log Day 13
// wants, and a count of the account's devices is not something the response needs
// to carry.
//
// ── 3.8: WHY VERIFY CONSUMES ITS TOKEN LAST AND RESET CONSUMES IT FIRST ──────
//
// resetPassword() above opens with GETDEL, so the token is spent before anything
// else can fail. verifyEmail() below opens with a plain GET and UNLINKs only
// after the row is committed. That is the opposite order, it is deliberate, and
// plan:348 and plan:349 already draw the distinction — 348 says to UNLINK "before
// accepting the new password", 349 says to GET, set the flag, and then UNLINK.
//
// The reason is the resend endpoint that does not exist. As line 21 records, the
// string "resend" appears nowhere in EduTRD.md, docs/apidoc.md or
// IMPLEMENTATION_PLAN.md, and TRD §6.1 lists registering as the only way to
// obtain a verification token. So the two tokens have completely different costs
// when one is destroyed by a failure that follows it:
//
//   a lost RESET token   — the user asks for another. forgotPassword() is a live
//                          endpoint and issuing a replacement is its whole job.
//   a lost VERIFY token  — the account is unverifiable forever. TRD:1482 then
//                          refuses POST /enrollments, POST /courses and every
//                          quiz submission for the life of the account, and
//                          re-registering the address is register()'s 409.
//
// GETDEL here would mean a PostgreSQL outage in the millisecond after the read
// costs the caller their only token and answers 503 — technically truthful, and
// permanently unrecoverable. GET-then-UNLINK inverts which side the failure lands
// on: if the UNLINK is what fails, the token survives to its 24 h TTL and can be
// replayed, and a replay re-sets a flag that is already true. That is the failure
// worth having.
//
// It costs strict single-use inside one window: two requests carrying the same
// token can both pass the GET before either UNLINKs. Both then set the same flag
// to the same value and both answer 200, so the observable outcome is identical to
// one request — the operation is idempotent, which is what makes the window safe
// rather than merely narrow. UNLINK's return value distinguishes the two: measured,
// 1 when this request removed the key and 0 when something else already had, so the
// raced case is logged rather than guessed at.
//
// ── ONE WRITE ANSWERS THREE QUESTIONS ────────────────────────────────────────
//
// `update({ where: { id: userId, deletedAt: null } })` was measured against
// Prisma 6.19 rather than assumed, because a non-unique filter in an update's
// where-clause is a comparatively recent capability and silently ignoring it would
// have been the worst outcome. It is accepted; it raises P2025 when the row is
// soft-deleted AND when no such row exists, leaving the flag untouched in both
// cases; and `select` still returns the row. So one statement covers:
//
//   1. the account exists            — else P2025
//   2. it is not soft-deleted        — else P2025, verified by leaving the flag false
//   3. the record user:state needs   — role, isBanned, isEmailVerified, deletedAt
//
// Case 1 is the residual line 45 named for this task: register() writes the token
// inside the transaction, so a Redis write that survives a failed COMMIT leaves a
// token pointing at a userId that was rolled back. That is a 400, not an
// impossible state, and this is where it is answered.
//
// A THIRD Prisma error code turned up in the same measurement and is the reason
// the catch below is not a copy of resetPassword()'s. An id that is not a UUID
// raises P2023 ("Inconsistent column data: Error creating UUID"), not P2025. The
// `typeof userId === 'string'` guard does not exclude it — "not-a-uuid" is a
// perfectly good non-empty string — so without a P2023 branch a corrupted value in
// this keyspace answers 500 instead of 400. resetPassword() had exactly that gap
// and has been given the same branch; see the note in this commit.
//
// ── WHY THE user:state REWRITE IS BEST-EFFORT ────────────────────────────────
//
// plan:349 asks for the rewrite so requireVerifiedEmail sees the new flag at once
// instead of up to TTL.userState later, and plan:376 lists login, ban/unban and
// role change as that key's writers — this is a fourth, added by the same plan
// line that asks for it.
//
// It warns rather than throwing, and the asymmetry with login() is the same one
// argued at line 365. The flag is already committed in PostgreSQL by the time this
// runs, so a failure here loses freshness, not truth: a missing record is a
// defined fallthrough to Postgres, and a stale one reads `isEmailVerified: false`
// and gates the user for up to 15 more minutes. Both are MORE restrictive than the
// truth, never less, so neither is a security failure. Answering 503 instead would
// tell the caller verification failed when it has already succeeded, and send them
// back with a token this request consumed — a 400 on the retry, for an account
// that is in fact verified.
//
// UNLINKing the key instead of rewriting it would also give immediate visibility,
// by way of the Postgres fallthrough, and was rejected because it spends a
// round-trip per request afterwards to re-derive something this call already holds.
//
// The write is the full four-field record from plan:358, not a merge into whatever
// is there. That loses a ban committed in the ~1 ms between the update returning
// and this SET landing — but login() and refresh() write the same record the same
// way, so the window is the existing pattern's rather than this function's, and
// narrowing it here alone would buy nothing.
//
// ── WHAT VERIFY DELIBERATELY DOES NOT REFUSE ─────────────────────────────────
//
// An ALREADY-VERIFIED account. Setting a true flag to true is not an error, and
// there is no branch for it: the row is not re-read to find out, because the only
// realistic way to arrive twice is an UNLINK that failed, and answering 400 there
// would report failure for the one path where everything worked. MESSAGES.AUTH
// .EMAIL_VERIFIED is written to be true on both.
//
// A BANNED account, for the reasons given at line 741 — the token was earned by
// controlling the mailbox, the ban is enforced by login's 403 and by 3.10, and
// refusing here would answer differently for banned and unbanned tokens on an
// unauthenticated route. The rewritten user:state carries `isBanned` straight off
// the row, so verifying does not soften a ban by one field.
//
// There is no decoy read and no timing argument in this function, unlike
// forgotPassword(). The input is a token rather than an address, so neither the
// 400 nor its latency says anything about whether any given account exists.
//
// ── WHAT 3.8 LEAVES TO LATER TASKS ───────────────────────────────────────────
//
// The route, its 5-per-15-minutes limit and the response envelope are 3.9's.
// verifyEmail() returns nothing at all, because apidoc §8.2's 200 row specifies no
// body and the flag it reports is already readable from GET /users/me. The
// requireVerifiedEmail guard that consumes the rewritten record — and the choice
// of exactly three surfaces to mount it on — is 3.11's (plan:352).
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes, randomUUID } from 'node:crypto';

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import prisma from '../../database/index.js';
import redis from '../../config/redis.js';
import {
  BCRYPT_ROUNDS,
  JWT_ALGORITHM,
  TOKEN,
  TOKEN_TYPE,
  UserRole,
} from '../../config/constants.js';
import { MESSAGES } from '../../config/system_messages.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
} from '../../utils/app-error.js';
import {
  isPasswordResetKey,
  keys,
  setWithTTL,
  TTL,
} from '../../utils/cache-keys.js';
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from '../../integrations/email/index.js';
import { logger } from '../../middlewares/logging.middleware.js';
import { createInstructorProfile } from '../instructors/instructors.service.js';

const log = logger.child({ module: 'auth' });

/**
 * The user shape that may leave this module — apidoc §8.2's `data.user`, exactly.
 *
 * A Prisma `select` rather than a delete-the-field-afterwards, so `passwordHash`
 * is never read out of the database at all. The difference matters the moment a
 * caller logs or serialises whatever it was handed: a field that was never
 * fetched cannot leak from an object nobody remembered to strip.
 */
const PUBLIC_USER_FIELDS = Object.freeze({
  id: true,
  fullName: true,
  email: true,
  role: true,
  isEmailVerified: true,
});

/**
 * The roles a stranger may claim for themselves.
 *
 * An allow-list, never `role !== 'ADMIN'`: plan:342 makes the point that a
 * negative check "is one future enum member away from being wrong", while a list
 * of the roles self-registration may mint is wrong only if someone edits it.
 */
const SELF_SERVICE_ROLES = Object.freeze([
  UserRole.STUDENT,
  UserRole.INSTRUCTOR,
]);

/**
 * A single-use token for an emailed link — verification (24 h) and, from task
 * 3.7, password reset (15 min).
 *
 * `randomBytes`, not `Math.random` or a timestamp: possessing one of these
 * verifies an account or resets a password, so it has to be unguessable rather
 * than merely unlikely to be guessed. TOKEN.BYTES of hex is what auth.schema.js's
 * `token` builder validates, from the same constant.
 *
 * The RAW value returned here goes into the email and nowhere else. What is
 * stored is `keys.emailVerify(raw)`, i.e. only its SHA-256 digest, so a Redis
 * dump yields no usable tokens (TRD:1474).
 *
 * @returns {string} TOKEN.LENGTH lowercase hex characters
 */
export function generateToken() {
  return randomBytes(TOKEN.BYTES).toString('hex');
}

/**
 * Registers a new student or instructor account — plan:344, apidoc §8.2.
 *
 * Ordering follows plan:344: uniqueness, then hash, then create, then token, then
 * email. Two steps sit outside the transaction deliberately — see the header for
 * why the Redis write does not.
 *
 * @param {{fullName: string, email: string, password: string, role?: string}} input
 *        Already validated by registerSchema when the caller is the controller.
 * @returns {Promise<{id: string, fullName: string, email: string, role: string,
 *          isEmailVerified: boolean}>} the sanitized user; no `passwordHash`
 * @throws {AppError} 409 when the address is taken, 503 when Redis cannot store
 *         the verification token (nothing is created in that case)
 */
export async function register({ fullName, email, password, role }) {
  // Re-normalised even though registerSchema already trimmed and lowercased it.
  // `email @unique` is a case-SENSITIVE PostgreSQL index, so this is the step
  // that stops 'Alex@example.com' becoming a second account alongside
  // 'alex@example.com' — and a caller that reaches this function without going
  // through the schema (a script, a future internal flow, a unit test) would
  // otherwise create exactly that row.
  const normalizedEmail = email.trim().toLowerCase();

  // Defence in depth behind the schema, not instead of it. registerSchema
  // enumerates STUDENT and INSTRUCTOR so ADMIN is refused at the boundary
  // (plan:342); this is the guard for every other way into this function, since
  // `register()` is an exported function and nothing about its signature stops
  // `{ role: 'ADMIN' }`. A plain Error rather than an AppError on purpose: no
  // client can trigger this, so it is a bug in a call site, and the handler's
  // generic 500 plus the logged message is the right pair of answers.
  const requestedRole = role ?? UserRole.STUDENT;
  if (!SELF_SERVICE_ROLES.includes(requestedRole)) {
    throw new Error(
      `auth.register: refusing to create a ${requestedRole} account — ` +
        `self-service registration is limited to ${SELF_SERVICE_ROLES.join(', ')}`,
    );
  }

  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });

  if (existing) {
    throw ConflictError();
  }

  // Outside the transaction, for the reason src/database/seed.js:199 already
  // records: cost 12 is ~290 ms of pure CPU (measured, see BCRYPT_ROUNDS) and has
  // no business holding a database transaction — or a pool connection — open while
  // it runs. Skipping it on the duplicate path is measurable: the 409 above
  // returns in 2 ms against this path's 290 ms.
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Both computed before the transaction opens. Hashing the token is pure CPU,
  // and doing it here means a TypeError from a malformed token surfaces as the
  // bug it is rather than inside the Redis catch below, which reports outages.
  const rawToken = generateToken();
  const verifyKey = keys.emailVerify(rawToken);

  let user;

  try {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          fullName,
          email: normalizedEmail,
          passwordHash,
          role: requestedRole,
        },
        select: PUBLIC_USER_FIELDS,
      });

      if (requestedRole === UserRole.INSTRUCTOR) {
        await createInstructorProfile(created.id, tx);
      }

      try {
        await setWithTTL(verifyKey, created.id, TTL.emailVerify);
      } catch (err) {
        // Logged in full before being converted, because the 503 the client sees
        // cannot distinguish an outage from a bug in this call and the log line
        // is the only thing that can. Throwing rolls the user row back — the
        // whole point of writing the token in here.
        log.error(
          { err, userId: created.id },
          '[auth] verification token write failed — registration rolled back',
        );
        throw ServiceUnavailableError();
      }

      return created;
    });
  } catch (err) {
    // The uniqueness guarantee, as opposed to the pre-check above: two
    // simultaneous registrations of one address both pass findUnique and one of
    // them lands here. Generic message per TRD:1480 — identical to the
    // pre-check's, so the two paths are indistinguishable from outside.
    if (err?.code === 'P2002') {
      throw ConflictError();
    }
    throw err;
  }

  // Fire-and-forget, after the commit, never inside it (TRD:1135, TRD:1138,
  // plan:734). No await and no .catch(): src/integrations/email/index.js
  // guarantees that none of its functions can reject — verified there against 84
  // hostile floating calls — so this cannot become an unhandledRejection, and
  // TRD:2009 requires that a mail-provider outage "costs an email, never a
  // certificate or an enrollment". The raw token appears here and in nothing that
  // is persisted.
  sendVerificationEmail({
    to: user.email,
    fullName: user.fullName,
    token: rawToken,
  });

  return user;
}

// ── login() helpers — task 3.4 ───────────────────────────────────────────────

/**
 * The default token lifetimes, matching src/config/env.js's defaults for the same
 * two variables and TRD:1669's "15 min" and "7 days".
 *
 * Duplicated rather than imported because env.js must not enter this import graph
 * (see note 3 in src/config/redis.js). The pair that matters is these against
 * TTL.session and TTL.userState in cache-keys.js — see the header.
 */
const DEFAULT_ACCESS_TTL = '15m';
const DEFAULT_REFRESH_TTL = '7d';

// TOKEN_TYPE (the `type` claim) and JWT_ALGORITHM (the one accepted algorithm)
// were declared here until task 3.10 gave them a second reader: requireAuth
// verifies from src/middlewares/ what this module signs. Both now live in
// config/constants.js and are imported above, so the mint and the verify cannot
// drift apart. The reasoning that was attached to each moved with it; what the
// header of THIS file says about key separation is unchanged — the claim is
// secondary to the two signing secrets and never a substitute for them.

/**
 * A real cost-12 bcrypt hash, compared against when no user matched, so that the
 * miss costs the same ~370 ms as a wrong password. See the header for the measured
 * numbers and why an early return is the bug this closes.
 *
 * Its preimage is 32 bytes from crypto.randomBytes that were hashed and discarded
 * without being recorded, so no input to this application matches it. Nothing rests
 * on that: login() throws on `!user` independently of the comparison's result, so
 * even a known preimage would authenticate nobody. Being a valid cost-12 hash is
 * the only property required of it — bcrypt reads the cost out of the string, so a
 * lower-cost decoy would reintroduce the gap it exists to close.
 */
const DECOY_HASH =
  '$2a$12$FnfXIrAF1z2Qx2HtyRFNQuSUPsQo1lniV4DhiWoovJEy9FfYcNmjK';

/**
 * The account columns that decide whether a caller may hold a session at all —
 * the public shape plus the two denial flags.
 *
 * Split out of LOGIN_USER_FIELDS in task 3.5 because refresh() needs exactly
 * this and must NOT fetch `passwordHash`: it compares no password, so selecting
 * the column would move a bcrypt digest into a place with no use for it. Keeping
 * login()'s one legitimate need as the extension below, rather than making the
 * hash the shared default, is what confines it to the single function that
 * compares it.
 */
const ACCOUNT_FIELDS = Object.freeze({
  ...PUBLIC_USER_FIELDS,
  isBanned: true,
  deletedAt: true,
});

/**
 * What login reads: the account shape plus the one column only login needs.
 *
 * `passwordHash` has to be selected here — a comparison needs it — which is the
 * one place this module breaks the never-fetch-it rule PUBLIC_USER_FIELDS exists
 * to enforce. toPublicUser() below is what keeps it from travelling any further.
 */
const LOGIN_USER_FIELDS = Object.freeze({
  ...ACCOUNT_FIELDS,
  passwordHash: true,
});

/**
 * What `GET /auth/me` returns — the public shape plus the three columns an account
 * is entitled to read about itself (task 3.9).
 *
 * Built on PUBLIC_USER_FIELDS rather than on ACCOUNT_FIELDS, so it inherits the
 * never-select-passwordHash rule and NOT the two denial flags: see getProfile() for
 * why `isBanned` and `deletedAt` are omitted from a route only a live account can
 * reach. `createdAt` is included because "member since" is the one fact a profile
 * view has that no other endpoint carries.
 */
const PROFILE_FIELDS = Object.freeze({
  ...PUBLIC_USER_FIELDS,
  avatarUrl: true,
  bio: true,
  createdAt: true,
});

/**
 * Narrows a LOGIN_USER_FIELDS row back to apidoc §8.2's `data.user`.
 *
 * Built by picking PUBLIC_USER_FIELDS' own keys rather than by deleting the three
 * private ones, so the two lists cannot drift apart in the dangerous direction:
 * a column added to LOGIN_USER_FIELDS is invisible here until someone also adds it
 * to the public set, while a `delete row.passwordHash` style would leak every
 * future addition by default.
 */
function toPublicUser(row) {
  return Object.fromEntries(
    Object.keys(PUBLIC_USER_FIELDS).map((field) => [field, row[field]]),
  );
}

/**
 * Resolves the two signing keys and two lifetimes.
 *
 * Read from process.env at CALL time, not at import time. Both reasons are
 * practical: env.js cannot be imported here (it exits the process, and Vitest loads
 * no .env), and a module-scope read would capture whatever the environment held
 * when the import graph was first walked — which for a test that sets the secrets
 * in a hook is `undefined`.
 *
 * No fallback for either secret. A default signing key is a key an attacker already
 * has, and one shipped as a fallback is one nobody notices is in use; jsonwebtoken's
 * own error for an absent secret ("secretOrPrivateKey must have a value") names no
 * variable, so the throw is spelled out here instead.
 *
 * A plain Error rather than an AppError, matching the role guard in register(): no
 * client can cause this, so it is a misconfiguration or a bug in a call site, and
 * the handler's generic 500 plus the logged message is the right pair of answers.
 *
 * @throws {Error} if either secret is missing, or if the two are the same
 */
function jwtConfig() {
  const accessSecret = process.env.JWT_SECRET;
  const refreshSecret = process.env.JWT_REFRESH_SECRET;

  if (!accessSecret || !refreshSecret) {
    throw new Error(
      'auth: both JWT_SECRET and JWT_REFRESH_SECRET must be set — ' +
        'refusing to sign a token with an absent or default key',
    );
  }

  // env.js rejects this at boot; re-checked because env.js is not in this
  // module's import graph and cannot be assumed to have run. See the header.
  if (accessSecret === refreshSecret) {
    throw new Error(
      'auth: JWT_SECRET and JWT_REFRESH_SECRET are identical — a refresh ' +
        'token would then verify as an access token (TRD §7)',
    );
  }

  return {
    accessSecret,
    refreshSecret,
    accessTtl: process.env.JWT_ACCESS_EXPIRES_IN || DEFAULT_ACCESS_TTL,
    refreshTtl: process.env.JWT_REFRESH_EXPIRES_IN || DEFAULT_REFRESH_TTL,
  };
}

/**
 * Mints an access token for an account — the ONLY place one is signed.
 *
 * Extracted in task 3.9 because there are now three callers and there was already
 * one too many: login() and refresh() each held a byte-identical `jwt.sign` call,
 * and register()'s controller needs a third for apidoc §8.2's 201 body. Four
 * copies of a claim set is four places for `type` or the algorithm pin to drift,
 * and a token signed with the wrong `type` claim is refused by nothing until
 * requireAuth (3.10) reads it — which is a 15-minute-later failure in a different
 * file.
 *
 * Takes a ROW, not a user id, and reads only the three claims from it. That is the
 * narrower contract: it cannot be handed an id and left to query, so it stays a
 * pure function with no I/O, and every caller has already fetched the row it needs
 * to authorise the mint in the first place. PUBLIC_USER_FIELDS is a superset of
 * what it reads, so a `data.user` object is a valid argument — which is exactly how
 * the register controller uses it.
 *
 * `email` and `role` travel in the token so requireAuth can build
 * `req.user = { id, email, role }` with no per-request query (plan:376). Its jti is
 * generated and discarded: nothing indexes access tokens, and there is no
 * `access:<jti>` key to revoke. That is the accepted cost of a stateless 15-minute
 * credential, recorded in the header.
 *
 * @param {{id: string, email: string, role: string}} row
 * @returns {string} a signed 15-minute access token
 * @throws {Error} if JWT_SECRET is absent, or identical to JWT_REFRESH_SECRET
 */
export function signAccessToken(row) {
  const { accessSecret, accessTtl } = jwtConfig();

  return jwt.sign(
    {
      sub: row.id,
      email: row.email,
      role: row.role,
      type: TOKEN_TYPE.ACCESS,
    },
    accessSecret,
    { expiresIn: accessTtl, jwtid: randomUUID(), algorithm: JWT_ALGORITHM },
  );
}

/**
 * Reads the profile behind `GET /auth/me` — apidoc §8.2, task 3.9.
 *
 * A query rather than a reshape of `req.user`, because requireAuth (3.10) attaches
 * only `{ id, email, role }` and apidoc calls this route's payload the "full user
 * profile object". Deriving it from the token would also mean serving `fullName`
 * and `isEmailVerified` values that are up to 15 minutes stale — and the one thing
 * a client polls this route for is the verification flag flipping.
 *
 * Not read from `user:state:<id>` either, for the same reason in the other
 * direction: that record holds four authorisation fields and no display fields, so
 * it cannot answer this at all. TRD §7.1's fast path exists to avoid a query per
 * REQUEST, not to avoid the one query a profile endpoint is made of.
 *
 * ── WHAT THE SELECT DELIBERATELY OMITS ──────────────────────────────────────
 *
 * `passwordHash` — never selected anywhere but login().
 *
 * `isBanned` and `deletedAt` — requireAuth has already refused every caller for
 * whom either is set, so on this route they are the constants false and null.
 * Publishing them would put moderation state in a response body for no information
 * gain, and would invite a client to branch on a field the guard owns.
 *
 * `emailBounced` — delivery state written by the Day 11 provider webhook (TRD
 * §6.11). It is the reason a verification email never arrived, so it plausibly
 * belongs in a client's own view of its account, but nothing in apidoc §8.2 or
 * TRD §6.1 says so and Day 11 owns what that flag is allowed to be read as.
 *
 * `updatedAt` — churns on every write and no client reads it.
 *
 * ── AND WHAT IT DOES NOT PRE-EMPT ───────────────────────────────────────────
 *
 * plan:705 gives `GET /users/:id` and `PUT /users/me` to task 10.6, so the
 * PUBLIC-profile shape and the editable-profile shape are both that task's to
 * decide. This is the third, narrower thing: what an account may read about
 * ITSELF. The overlap is deliberate and one-directional — 10.6 may add fields
 * here, but nothing here decides what a stranger sees.
 *
 * @param {string} userId `req.user.id` from requireAuth (3.10)
 * @returns {Promise<object>} the profile object apidoc §8.2 calls `data.user`
 * @throws {AppError} 404 if the row is gone — see below for why that is reachable
 */
export async function getProfile(userId) {
  const row = await prisma.user.findUnique({
    where: { id: userId, deletedAt: null },
    select: PROFILE_FIELDS,
  });

  // Reachable, and not only through a bug. An access token stays cryptographically
  // valid for its full 15 minutes, so a hard-deleted or soft-deleted account can
  // present one after the row is gone; requireAuth's user:state read closes most of
  // that window but a MISS falls through to PostgreSQL, and the two reads are not
  // one transaction. 404 rather than 401: the credential is genuine and the
  // resource is not there, which is exactly apidoc §5's 404 row ("target record
  // does not exist, has been soft-deleted").
  if (!row) {
    throw NotFoundError();
  }

  return row;
}

/**
 * Authenticates a set of credentials and opens a session — plan:345, apidoc §8.2.
 *
 * Deliberately NOT a check on `isEmailVerified`. TRD:1482 is explicit that "an
 * unverified user may log in and browse", and refuses only POST /enrollments, POST
 * /courses and quiz submissions until the address is confirmed — which is task
 * 3.11's `requireVerifiedEmail`, not this function's business. The flag is written
 * into user:state so 3.11 can read it without a query.
 *
 * The signature is two arguments where register() takes one, and the split is
 * meaningful: the first object is what the CLIENT sent and loginSchema validated,
 * the second is what the SERVER observed about the request. Merging them would
 * invite a caller to pass a client-supplied `ip`, which is the value that then gets
 * written into the session record as provenance. The service has no `req`, so the
 * controller (3.9) supplies both from `req.ip` — trustworthy only because task 2.1
 * set `trust proxy` — and `req.get('user-agent')`.
 *
 * @param {{email: string, password: string}} credentials
 *        Already validated by loginSchema when the caller is the controller.
 * @param {{ip?: string, userAgent?: string}} [context]
 *        Request provenance for the session record. Absent values are stored as
 *        null rather than dropped, so the record's shape never varies.
 * @returns {Promise<{user: {id: string, fullName: string, email: string,
 *          role: string, isEmailVerified: boolean}, accessToken: string,
 *          refreshToken: string}>} the sanitized user and the token pair. The
 *          refresh token is the controller's to put in the HttpOnly cookie
 *          (TRD:1669); Max-Age should be TTL.session, which is the real upper
 *          bound on its usefulness.
 * @throws {AppError} 401 on unknown address or wrong password — one message for
 *         both; 403 when the credentials are right but the account is banned or
 *         soft-deleted; 503 when Redis cannot record the session, in which case no
 *         tokens are issued
 */
export async function login({ email, password }, { ip, userAgent } = {}) {
  // Same normalization as register(), for the same reason: `email @unique` is a
  // case-sensitive PostgreSQL index, so 'ADA@Example.com' has to find the row
  // stored as 'ada@example.com' or a correct password answers 401.
  const normalizedEmail = email.trim().toLowerCase();

  const row = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: LOGIN_USER_FIELDS,
  });

  // Runs on BOTH paths — see the header. The decoy keeps an unknown address as
  // expensive as a known one, which is what makes the shared 401 message below
  // mean anything.
  const passwordMatches = await bcrypt.compare(
    password,
    row?.passwordHash ?? DECOY_HASH,
  );

  // `!row` is tested independently of the comparison rather than trusting that
  // nothing matches DECOY_HASH.
  if (!row || !passwordMatches) {
    throw UnauthorizedError(MESSAGES.AUTH.INVALID_CREDENTIALS);
  }

  // Only reachable with a correct password, which is what lets this answer be
  // specific where the 401 above cannot be (apidoc §8.2).
  if (row.isBanned || row.deletedAt !== null) {
    throw ForbiddenError(MESSAGES.AUTH.ACCOUNT_DISABLED);
  }

  // Only the refresh half: signAccessToken() resolves the access secret and TTL
  // itself. jwtConfig() is still called here rather than inside the sign, because
  // it is also what refuses to run at all with an absent or duplicated secret.
  const { refreshSecret, refreshTtl } = jwtConfig();

  // signAccessToken() rather than an inline sign, so the claim set and the
  // algorithm pin exist once (task 3.9). `row` is a LOGIN_USER_FIELDS row and the
  // helper reads three of its keys.
  const accessToken = signAccessToken(row);

  // A uuid, not base64: cache-keys.js validates every segment against
  // /^[A-Za-z0-9._-]+$/, and a jti containing ':' or '+' would either be refused
  // or — the reason that guard exists — let a crafted jti of `index:<victimId>`
  // make session() emit what sessionIndex() emits.
  const refreshJti = randomUUID();

  // Deliberately minimal: `sub`, `type` and the jti, and nothing else. `role`
  // would be up to 7 days stale by the time this token is redeemed and `email`
  // is not the token's to carry, so refresh() re-reads BOTH FROM POSTGRES rather
  // than trusting either — see refresh()'s section of the header for why the
  // session record cannot answer it either.
  const refreshToken = jwt.sign(
    { sub: row.id, type: TOKEN_TYPE.REFRESH },
    refreshSecret,
    { expiresIn: refreshTtl, jwtid: refreshJti, algorithm: JWT_ALGORITHM },
  );

  try {
    // Index first, then the session it indexes, then the fast-path state. The
    // order is the security property — see the header. SADD not setWithTTL: the
    // index has no expiry by design (TTL.sessionIndex is null, and that helper
    // throws on a non-positive TTL saying so).
    await redis.sadd(keys.sessionIndex(row.id), refreshJti);

    await setWithTTL(
      keys.session(refreshJti),
      {
        userId: row.id,
        role: row.role,
        issuedAt: new Date().toISOString(),
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      },
      TTL.session,
    );

    // plan:358's shape exactly. A JSON String, never a hash: HGETALL would
    // return `false` as the string 'false', and `if (state.isBanned)` on that
    // rejects everybody (plan:364). `deletedAt` is null on every write that gets
    // here — the guard above refused anything else — and is written anyway so the
    // record stays truthful if that check is ever relaxed.
    await setWithTTL(
      keys.userState(row.id),
      {
        role: row.role,
        isBanned: row.isBanned,
        isEmailVerified: row.isEmailVerified,
        deletedAt: row.deletedAt,
      },
      TTL.userState,
    );
  } catch (err) {
    // Logged before conversion, as in register(): the 503 cannot distinguish an
    // outage from a bug in this call, and this line is the only thing that can.
    log.error(
      { err, userId: row.id },
      '[auth] session write failed — login refused, no tokens issued',
    );
    throw ServiceUnavailableError();
  }

  return {
    user: toPublicUser(row),
    accessToken,
    refreshToken,
  };
}

/**
 * The refresh cookie's name and attributes — plan:346, apidoc:280, TRD:1669.
 *
 * Exported from the service rather than owned by the controller because THREE
 * tasks have to spell it identically and only one of them sets it: 3.9 sets it on
 * login and refresh, and 3.6 CLEARS it on logout. res.clearCookie only clears a
 * cookie whose name, Path and Domain match what was set (a Set-Cookie for
 * `/api/v1/auth` and a clear for `/` leave the browser holding the original), so
 * a second spelling is a logout that silently does not log out.
 *
 * Not in config/constants.js, which would otherwise be its home: `maxAge` is
 * derived from TTL.session, constants.js imports nothing at all, and pulling
 * cache-keys.js in there would drag redis.js into the import graph of every
 * middleware that reads a constant.
 *
 * Attribute by attribute:
 *
 *   httpOnly  TRD:1669 — no script may read it. The whole reason the refresh
 *             token is a cookie while the access token is not.
 *   secure    HTTPS only, waived ONLY when NODE_ENV is explicitly 'development'.
 *             Note the polarity: this file's other NODE_ENV readers default an
 *             unset value to 'development' (redis.js:67, logging.middleware.js:107
 *             do the same), and doing that here would strip Secure off the cookie
 *             on any production host that forgot to set the variable. So it is
 *             read raw, and the permissive branch requires an explicit opt-in —
 *             app.js:356 gates its stack traces on exactly that principle, in the
 *             direction that principle happens to point there.
 *   sameSite  'strict' (plan:346). The browser sends this on no cross-site
 *             request at all — the first half of the CSRF defence, whose second
 *             half is 3.9's Origin/Referer check.
 *   path      '/api/v1/auth' — narrower than '/', so the cookie is not attached
 *             to the ~90 endpoints that have no use for it. TRD:1673 makes
 *             /auth/refresh and /auth/logout "the sole cookie-reading routes".
 *   maxAge    TTL.session, in MILLISECONDS. express's res.cookie takes ms while
 *             Redis EXPIRE takes seconds, so the ×1000 is required and its
 *             absence would be a 7-second cookie. Matching the key's TTL is what
 *             stops the browser from holding a cookie whose session Redis has
 *             already dropped.
 */
export const REFRESH_COOKIE = Object.freeze({
  name: 'refreshToken',
  options: Object.freeze({
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: TTL.session * 1000,
  }),
});

/**
 * Rotates a refresh token: consumes the old session and opens a new one —
 * plan:346, apidoc §8.2.
 *
 * Single-use by construction. The old `session:<jti>` is removed with GETDEL, so
 * the request that atomically won the key is the only one authorized to rotate;
 * a replay of the same cookie finds nothing and gets the 401 (plan:390). See
 * refresh()'s section of the header for the measured race this closes and for the
 * commit point that makes the last two writes best-effort.
 *
 * Takes the raw token rather than a cookie jar or a `req`: the service reads no
 * HTTP. The controller (3.9) passes `req.cookies[REFRESH_COOKIE.name]`, which is
 * undefined when the cookie is absent — a case handled here rather than left to
 * jwt.verify's "jwt must be provided", so an absent cookie and a forged one are
 * indistinguishable to the caller.
 *
 * @param {string} [token] The refresh token from the cookie. Absent, empty and
 *        malformed all answer the same 401.
 * @param {{ip?: string, userAgent?: string}} [context]
 *        Provenance for the NEW session record, from this request rather than
 *        copied from the old one — the record then says where the session was
 *        last used, which is the more useful of the two for an audit.
 * @returns {Promise<{accessToken: string, refreshToken: string}>} a new pair. No
 *          `user`: apidoc §8.2's refresh response carries only the two tokens.
 *          The refresh token is the controller's to re-set with REFRESH_COOKIE.
 * @throws {AppError} 401 for every rejection — absent, malformed, badly signed,
 *         expired, wrong `type`, unusable jti, already-consumed or revoked
 *         session, and an account banned or soft-deleted since login; 503 when
 *         Redis or PostgreSQL cannot be reached, or when the new session cannot
 *         be recorded, in which case no tokens are issued
 */
export async function refresh(token, { ip, userAgent } = {}) {
  const { refreshSecret, refreshTtl } = jwtConfig();

  // Before jwt.verify, so `undefined` never reaches it. Its own error for that
  // input is "jwt must be provided", which would land in the same catch below
  // anyway — this is here to make the absent-cookie case explicit rather than
  // incidental.
  if (!token) {
    throw UnauthorizedError(MESSAGES.AUTH.SESSION_INVALID);
  }

  let payload;
  try {
    // The refresh key, so an ACCESS token presented here fails on the signature
    // before its `type` claim is ever read (plan:391). Measured: it throws
    // JsonWebTokenError "invalid signature".
    payload = jwt.verify(token, refreshSecret, {
      algorithms: [JWT_ALGORITHM],
    });
  } catch {
    // Every verify failure collapses to one answer: bad signature, expired,
    // malformed, alg substitution. Not logged at error level — a stale cookie
    // after a week away is the ordinary case, and logging it as an error would
    // make the security log unreadable by the time it mattered.
    throw UnauthorizedError(MESSAGES.AUTH.SESSION_INVALID);
  }

  // Belt and braces behind the key separation: a token signed with the refresh
  // key but minted for another purpose is refused before it can open a session.
  if (payload.type !== TOKEN_TYPE.REFRESH) {
    throw UnauthorizedError(MESSAGES.AUTH.SESSION_INVALID);
  }

  // `sub` is the load-bearing half: it becomes the `where` of the query below, and
  // a non-string reaches Prisma as an invalid argument that would be reported as a
  // 503 outage. The `jti` half is belt and braces — keys.session() rejects a
  // non-string itself, one guard below — kept because a token signed without
  // `jwtid` yields `jti === undefined` (measured) and reading that intent out of a
  // TypeError from a key builder is worse than stating it here.
  if (typeof payload.jti !== 'string' || typeof payload.sub !== 'string') {
    throw UnauthorizedError(MESSAGES.AUTH.SESSION_INVALID);
  }

  const oldJti = payload.jti;
  const userId = payload.sub;

  // Built here, in its own guard, rather than inside the try below. keys.session()
  // REJECTS a jti outside /^[A-Za-z0-9._-]+$/ by throwing (cache-keys.js:75) — the
  // guard that stops a crafted `index:<victimId>` from making session() emit what
  // sessionIndex() emits. Reached only by someone who can sign with the refresh
  // key, and the honest answer for that is this endpoint's one 401, not the 503
  // the catch below would otherwise log as a Redis outage. Calling the real key
  // builder is also what keeps this check from drifting from the rule it enforces.
  let sessionKey;
  try {
    sessionKey = keys.session(oldJti);
  } catch {
    throw UnauthorizedError(MESSAGES.AUTH.SESSION_INVALID);
  }

  // ── The authorization gate. One command, and it both checks and consumes ────
  // Only the presence of a value is read; the record itself is discarded, because
  // nothing in it can be trusted for the token about to be minted (see below).
  let stored;
  try {
    stored = await redis.getdel(sessionKey);
  } catch (err) {
    // Fail CLOSED (TRD §7.1). A session lookup that cannot be performed is not a
    // session that exists, and answering 401 here would tell a client with a
    // perfectly good token to throw it away over an outage — so 503, which says
    // "retry" and leaves the session intact.
    log.error(
      { err, userId },
      '[auth] refresh: session read failed — refusing to rotate',
    );
    throw ServiceUnavailableError();
  }

  // null means the key was absent: expired at 7 days, revoked by a logout or a
  // ban, or already consumed by an earlier refresh. Including this request's own
  // replay, which is the point.
  if (stored === null) {
    throw UnauthorizedError(MESSAGES.AUTH.SESSION_INVALID);
  }

  // The old session is now GONE, and everything below either completes the
  // rotation or leaves the caller re-authenticating. Deliberate: the alternative
  // ordering leaves a replayable token behind on failure. Header has the reasoning.

  // Re-read rather than trusting the record just consumed. `email` is not in it
  // and `role` in it is up to 7 days stale, and this is also where a ban that
  // landed mid-session is caught. ACCOUNT_FIELDS, so no passwordHash.
  let row;
  try {
    row = await prisma.user.findUnique({
      where: { id: userId },
      select: ACCOUNT_FIELDS,
    });
  } catch (err) {
    log.error(
      { err, userId },
      '[auth] refresh: account re-read failed — session already consumed',
    );
    throw ServiceUnavailableError();
  }

  // A deleted row, a ban, or a soft delete. 401 and not 403, unlike login(): see
  // the header — a 403 here would make refresh the ban oracle that login's 403
  // charges a correct password for, and apidoc §8.2 lists no 403 for this route.
  if (!row || row.isBanned || row.deletedAt !== null) {
    log.warn(
      { userId, found: Boolean(row) },
      '[auth] refresh: account no longer eligible — session consumed, not renewed',
    );
    throw UnauthorizedError(MESSAGES.AUTH.SESSION_INVALID);
  }

  // Same claims login() signs, from the row just read, so a role change takes
  // effect within one access-token lifetime instead of at the end of the session.
  // One helper for both, for the reason in signAccessToken()'s comment.
  const accessToken = signAccessToken(row);

  const newJti = randomUUID();

  const refreshToken = jwt.sign(
    { sub: row.id, type: TOKEN_TYPE.REFRESH },
    refreshSecret,
    { expiresIn: refreshTtl, jwtid: newJti, algorithm: JWT_ALGORITHM },
  );

  // A fresh 7 days, which makes TTL.session an idle timeout rather than a session
  // lifetime — see the header. Nothing in apidoc or the TRD specifies a cap.
  try {
    // Index before session, as login() does: the index must never be missing a
    // jti whose session key is live, or "revoke all sessions" leaves that one
    // alive for 7 days (plan:367).
    await redis.sadd(keys.sessionIndex(row.id), newJti);

    await setWithTTL(
      keys.session(newJti),
      {
        userId: row.id,
        role: row.role,
        issuedAt: new Date().toISOString(),
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      },
      TTL.session,
    );
  } catch (err) {
    log.error(
      { err, userId: row.id },
      '[auth] refresh: new session write failed — no tokens issued, old session already consumed',
    );
    throw ServiceUnavailableError();
  }

  // ── Past the commit point. Both writes below are best-effort ────────────────

  // Refreshed here even though plan:376 lists only login and role/ban changes as
  // writers, because refresh is a 15-minute heartbeat on an active session and
  // this is the record 3.10 reads on every request. A failure is not fatal: a
  // miss falls through to PostgreSQL by design (cache-keys.js:316).
  try {
    await setWithTTL(
      keys.userState(row.id),
      {
        role: row.role,
        isBanned: row.isBanned,
        isEmailVerified: row.isEmailVerified,
        deletedAt: row.deletedAt,
      },
      TTL.userState,
    );
  } catch (err) {
    log.warn(
      { err, userId: row.id },
      '[auth] refresh: user:state write failed — rotation stands, next read falls through to Postgres',
    );
  }

  // Housekeeping, last and least. The index is specified as a superset
  // (plan:367), so a leftover jti is inert — its session key is already gone, and
  // a revocation that unlinks it is a no-op (SREM of a non-member returns 0, no
  // error, measured). Left until after the writes that matter for exactly that
  // reason.
  try {
    await redis.srem(keys.sessionIndex(row.id), oldJti);
  } catch (err) {
    log.warn(
      { err, userId: row.id },
      '[auth] refresh: stale index entry not pruned — inert, session already consumed',
    );
  }

  // No `user`: apidoc §8.2's refresh response is the token pair alone.
  return { accessToken, refreshToken };
}

/**
 * Ends one session: revokes its refresh token and prunes the index — plan:347,
 * apidoc §8.2.
 *
 * Throws for no input a client can send. apidoc §8.2 gives logout a single 200
 * response and no failure rows, so everything refresh() answers 401 for, and the
 * Redis outage it answers 503 for, resolve here as "nothing revoked" plus a log
 * line. logout()'s section of the header has the argument for why a 503 would
 * leave the caller strictly worse off than the 200 does. The one thing that can
 * still propagate is jwtConfig()'s missing-secret Error, which is a deployment
 * fault rather than a request.
 *
 * Reads the jti from the refresh COOKIE, not from the access token — the pair get
 * separate jtis and `session:<jti>` is keyed by the refresh half (login()'s
 * header, "TWO KEYS, TWO JTIS"), so the access token cannot name the session it
 * belongs to. That is what makes this one of the two cookie-reading routes
 * TRD:1673 names, and why 3.9 owes it an Origin/Referer check.
 *
 * @param {string} [token] The refresh token from `req.cookies`, or undefined when
 *        the cookie is absent — a logout with no session to end is a success.
 * @param {{userId?: string}} [context] `req.user.id` from requireAuth (3.10);
 *        apidoc §8.2 guards this route as Authenticated. Compared against the
 *        cookie's `sub` so a caller cannot end someone else's session by
 *        presenting someone else's cookie.
 * @returns {Promise<{revoked: boolean}>} whether a live session was actually
 *          destroyed. The controller discards it, since apidoc's `data` is null,
 *          but it separates "logged out" from "there was nothing to log out of"
 *          — which Day 13's audit log will want, and which is the only signal a
 *          caller gets that Redis was unreachable.
 */
export async function logout(token, { userId } = {}) {
  const { refreshSecret } = jwtConfig();

  // The ordinary double-logout, and any client that never held a cookie. Nothing
  // to do and nothing wrong, so deliberately not logged at any level.
  if (!token) {
    return { revoked: false };
  }

  let payload;
  try {
    payload = jwt.verify(token, refreshSecret, {
      algorithms: [JWT_ALGORITHM],
    });
  } catch {
    // Expiry is the common arrival here and it is benign: a token's lifetime and
    // its session key's TTL are set from the same moment, so a token that has
    // expired names a key that has too. Strict verification rather than
    // `ignoreExpiration`, deliberately — the two cookie-reading routes should not
    // disagree about what a valid cookie is, and the only session an expired
    // token could still name is one no refresh() will ever accept again.
    return { revoked: false };
  }

  // Symmetric with refresh(): a token signed with the refresh key but minted for
  // another purpose does not get to name a session.
  if (payload.type !== TOKEN_TYPE.REFRESH) {
    return { revoked: false };
  }

  if (typeof payload.jti !== 'string' || typeof payload.sub !== 'string') {
    return { revoked: false };
  }

  // Authentic says nothing about WHOSE. Both keys below are derived from the
  // AUTHENTICATED caller, so this comparison is what stops a Bearer token for one
  // account plus a refresh cookie for another from revoking the second account's
  // session — a free denial of service on anyone whose cookie ever leaked. The
  // benign version is a client that kept a stale access token across a re-login;
  // it gets the same answer, which is to revoke nothing.
  //
  // A `userId` the controller forgot to pass lands here too, and reads in the log
  // as the undefined it is rather than silently matching something.
  if (payload.sub !== userId) {
    log.warn(
      { userId, cookieSubject: payload.sub },
      '[auth] logout: cookie subject is not the authenticated caller — nothing revoked',
    );
    return { revoked: false };
  }

  // Built through the real key builder, in its own guard. This is the check that
  // stops a crafted `index:<victimId>` jti from becoming `session:index:<victimId>`
  // and reaching UNLINK, which — unlike refresh()'s GETDEL — would DELETE the Set
  // rather than refuse it on type (measured; see the header).
  let sessionKey;
  try {
    sessionKey = keys.session(payload.jti);
  } catch {
    log.warn(
      { userId },
      '[auth] logout: cookie carries an unusable jti — nothing revoked',
    );
    return { revoked: false };
  }

  // ── The commit point. Session first, index second ───────────────────────────
  let unlinked;
  try {
    unlinked = await redis.unlink(sessionKey);
  } catch (err) {
    // NOT a 503, and the SREM below is NOT attempted — both deliberate, both
    // argued in the header. Error level because a revocation that did not happen
    // is an operator's problem even though it is not the caller's.
    log.error(
      { err, userId },
      '[auth] logout: session unlink failed — session NOT revoked, cookie still cleared',
    );
    return { revoked: false };
  }

  // 0 means there was nothing to remove: expired on its own, revoked by a ban, or
  // a second logout. Measured — UNLINK returns the number of keys removed and does
  // not throw on a miss — so no existence check is needed to tell the two apart.
  const revoked = unlinked > 0;

  // Housekeeping, and safe either way. If the key was live it is gone now; if it
  // was already gone, this is the opportunistic prune TRD:1723 describes. The
  // index key is derived from the authenticated caller, so a malformed id throws
  // out of keys.sessionIndex() into this catch rather than past it.
  try {
    await redis.srem(keys.sessionIndex(userId), payload.jti);
  } catch (err) {
    log.warn(
      { err, userId },
      '[auth] logout: index entry not pruned — inert, session already unlinked',
    );
  }

  return { revoked };
}

// ── Password recovery — task 3.7 ─────────────────────────────────────────────

/**
 * The fields forgot-password needs, and no more. `deletedAt` is selected in order
 * to be tested, not returned: a soft-deleted account must not be sent a link, and
 * filtering in the WHERE clause instead would make the two cases indistinguishable
 * in the log, where telling "no such address" from "deleted account" is useful.
 */
const RECOVERY_FIELDS = Object.freeze({
  id: true,
  email: true,
  fullName: true,
  deletedAt: true,
});

/**
 * Invalidates the reset token previously issued to a user, if there is one.
 *
 * TRD:1477, through the reverse pointer argued in the header. Best-effort by
 * design: every failure in here leaves the previous token alive for the rest of
 * its 15 minutes, which is the behaviour this route would have without the
 * pointer at all, so nothing is worth failing the request over.
 *
 * Returns nothing. The caller has no decision to make on the outcome.
 */
async function supersedePreviousResetToken(userId) {
  try {
    const previous = await redis.getdel(keys.passwordResetPointer(userId));

    if (previous === null) {
      return;
    }

    // JSON, like everything setWithTTL writes — see the header. The stored value
    // is a KEY NAME here rather than an id, so what it parses to decides what
    // gets deleted, and isPasswordResetKey() is the gate on that.
    let namedKey;
    try {
      namedKey = JSON.parse(previous);
    } catch {
      namedKey = null;
    }

    if (!isPasswordResetKey(namedKey)) {
      log.error(
        { userId, previous },
        '[auth] forgotPassword: reset pointer held something that is not a reset key — refusing to unlink it',
      );
      return;
    }

    await redis.unlink(namedKey);
  } catch (err) {
    log.warn(
      { err, userId },
      '[auth] forgotPassword: previous reset token not superseded — it stays valid until its TTL expires',
    );
  }
}

/**
 * Issues a password-reset token for an email address, if an account has it.
 *
 * Returns undefined in every case, and throws only for a Redis outage — the same
 * outage on either branch (see the header). A caller cannot learn from this
 * function whether the address exists, which is the point.
 *
 * @param {{ email: string }} input
 * @returns {Promise<void>}
 * @throws {AppError} 503 when Redis is unavailable, on BOTH branches
 */
export async function forgotPassword({ email }) {
  // Re-normalised for the reason register() gives at line 654: `email @unique` is
  // a case-sensitive index, so a caller reaching this function without the schema
  // would look up an address that can never match the row it belongs to — and
  // silently get the no-account branch, which looks like success.
  const normalizedEmail = email.trim().toLowerCase();

  // Not wrapped in a try: a PostgreSQL failure here propagates to the error
  // handler as a 500, identically on both branches, so it leaks nothing the way an
  // unmatched Redis failure would. There is no documented 503 for this route's
  // database read, and inventing one would only differ from the 500 in wording.
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: RECOVERY_FIELDS,
  });

  if (!user || user.deletedAt !== null) {
    // The decoy, and the only reason it exists: this branch has no Redis work of
    // its own, so without a command that fails when the other branch's writes
    // fail, a Redis outage answers 503 for real accounts and 200 for the rest.
    // EXISTS against a fresh token's key can only ever return 0.
    try {
      await redis.exists(keys.passwordReset(generateToken()));
    } catch (err) {
      log.error(
        { err },
        '[auth] forgotPassword: redis unavailable — 503 on the no-account branch, matching the branch that writes',
      );
      throw ServiceUnavailableError();
    }

    // Info, not warn: a typo'd address is ordinary. The log is the only place the
    // two branches are distinguishable, and it is the right place.
    log.info(
      { email: normalizedEmail, softDeleted: Boolean(user) },
      '[auth] forgotPassword: no eligible account — 200 returned, no email sent',
    );
    return;
  }

  // Computed before any write, as register() does at line 696: hashing is pure
  // CPU, so a malformed token surfaces here as the bug it is instead of inside a
  // catch that reports outages.
  const rawToken = generateToken();
  const resetKey = keys.passwordReset(rawToken);

  // The new token lands BEFORE the old one is dropped, so no ordering of failures
  // can leave the account with no usable link. The reverse — supersede first —
  // would delete a working token and then fail to write its replacement.
  try {
    await setWithTTL(resetKey, user.id, TTL.passwordReset);
  } catch (err) {
    // Logged before conversion, as register() does: the client's 503 cannot tell
    // an outage from a bug on this line, and this is the only record that can.
    log.error(
      { err, userId: user.id },
      '[auth] forgotPassword: reset token write failed — no email sent',
    );
    throw ServiceUnavailableError();
  }

  await supersedePreviousResetToken(user.id);

  // The pointer for the token just written, last and best-effort. A failure here
  // costs TRD:1477 for the NEXT issue only; this token works either way.
  try {
    await setWithTTL(
      keys.passwordResetPointer(user.id),
      resetKey,
      TTL.passwordReset,
    );
  } catch (err) {
    log.warn(
      { err, userId: user.id },
      '[auth] forgotPassword: reset pointer not written — a later token will not supersede this one',
    );
  }

  // Fire-and-forget, after the token is redeemable, for the reasons register()
  // records at line 746: no await and no .catch() because nothing in the email
  // integration can reject, and TRD:2009 requires a provider outage to cost an
  // email rather than the operation. The raw token exists here and in the message
  // it is sent in — never in Redis, never in PostgreSQL (TRD:1474).
  sendPasswordResetEmail({
    to: user.email,
    fullName: user.fullName,
    token: rawToken,
  });

  log.info({ userId: user.id }, '[auth] forgotPassword: reset link dispatched');
}

/**
 * Consumes a reset token, sets a new password, and ends every session.
 *
 * @param {{ token: string, newPassword: string }} input
 * @returns {Promise<{ revokedSessions: number }>}
 * @throws {AppError} 400 when the token is unknown, expired, already used or the
 *         account behind it is gone; 503 when Redis is unavailable or the session
 *         sweep could not be completed
 */
export async function resetPassword({ token, newPassword }) {
  // Built in its own guard for the reason refresh() gives at line 1183:
  // keys.passwordReset() THROWS on a token that is empty or not a string, and a
  // TypeError escaping into the Redis catch below would be reported as an outage.
  // The schema already requires a non-empty string; this is the guard for every
  // other way into an exported function.
  let resetKey;
  try {
    resetKey = keys.passwordReset(token);
  } catch {
    throw BadRequestError(MESSAGES.VALIDATION.TOKEN_INVALID);
  }

  // GETDEL, not GET — read and consume in one command, which is what makes the
  // token single-use (TRD:1475). This is the commit point for the token: past
  // here it is spent whether or not the rest of the function succeeds, and that
  // is the correct trade against two concurrent replays of one token.
  let stored;
  try {
    stored = await redis.getdel(resetKey);
  } catch (err) {
    log.error(
      { err },
      '[auth] resetPassword: redis unavailable — token not consumed, no password changed',
    );
    throw ServiceUnavailableError();
  }

  // Unknown, expired, or already redeemed. One answer for all three, deliberately
  // — MESSAGES.VALIDATION.TOKEN_INVALID's own comment fixes that, so a token
  // cannot be probed to learn whether it was ever real.
  if (stored === null) {
    throw BadRequestError(MESSAGES.VALIDATION.TOKEN_INVALID);
  }

  // The JSON the header describes. A value that will not parse, or parses to
  // something that is not a non-empty string, is corruption in a namespace only
  // this module writes — so it is logged at ERROR and answered as an invalid
  // token, which is the honest answer to the caller either way.
  let userId;
  try {
    userId = JSON.parse(stored);
  } catch {
    userId = null;
  }

  if (typeof userId !== 'string' || userId.length === 0) {
    log.error(
      { resetKey, stored },
      '[auth] resetPassword: reset key held a value that is not a user id — treating the token as invalid',
    );
    throw BadRequestError(MESSAGES.VALIDATION.TOKEN_INVALID);
  }

  // After the token is consumed, never before — ~290 ms of CPU (see
  // BCRYPT_ROUNDS) is exactly the window a GET-then-delete would have left open
  // for a second replay of the same token.
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
      select: { id: true },
    });
  } catch (err) {
    // P2025 — the account was hard-deleted between the link being sent and used.
    // Measured: update against an absent id raises P2025 rather than returning
    // null. Answered as an invalid token because from the caller's side that is
    // what it is, and because a distinct message would confirm the address once
    // belonged to an account.
    if (err?.code === 'P2025') {
      log.warn(
        { userId },
        '[auth] resetPassword: token valid but the account no longer exists',
      );
      throw BadRequestError(MESSAGES.VALIDATION.TOKEN_INVALID);
    }
    // P2023 — added while measuring 3.8, which hit it on the identical code path.
    // An id that is not a UUID raises "Inconsistent column data: Error creating
    // UUID", NOT P2025, and the `typeof userId === 'string'` guard above cannot
    // exclude it because a corrupted value like "not-a-uuid" is a perfectly good
    // non-empty string. Without this branch a corrupted pointer target answers 500
    // rather than the 400 every other unusable-token case answers.
    if (err?.code === 'P2023') {
      log.error(
        { err, userId },
        '[auth] resetPassword: reset key held a malformed id — treated as invalid',
      );
      throw BadRequestError(MESSAGES.VALIDATION.TOKEN_INVALID);
    }
    throw err;
  }

  // ── Past the commit point. The password has changed ─────────────────────────
  //
  // Everything below is TRD:1476, and it runs AFTER the update so that the old
  // password cannot buy a new session behind the sweep (see the header).
  let revokedSessions = 0;
  const indexKey = keys.sessionIndex(userId);

  try {
    const jtis = await redis.smembers(indexKey);

    // A member that cannot become a key is skipped, not fatal — the poison-pill
    // argument in the header. keys.session() throws on anything outside
    // /^[A-Za-z0-9._-]+$/, which is also what stops a forged member naming the
    // index key itself (cache-keys.js:75).
    const sessionKeys = [];
    let unusable = 0;
    for (const jti of jtis) {
      try {
        sessionKeys.push(keys.session(jti));
      } catch {
        unusable += 1;
      }
    }

    if (unusable > 0) {
      log.warn(
        { userId, unusable },
        '[auth] resetPassword: session index held unusable members — skipped, remaining sessions revoked',
      );
    }

    // The length guard is not defensive style; it is required. Measured — UNLINK
    // with no arguments throws ReplyError "wrong number of arguments", and an
    // empty index is the ordinary case for an account that never logged in.
    if (sessionKeys.length > 0) {
      // From UNLINK's own return value, never sessionKeys.length: the index is a
      // superset (plan:367, plan:858), so members whose session keys already
      // expired would otherwise be counted as revocations. Measured — 3 keys
      // passed, 2 present, returns 2.
      revokedSessions = await redis.unlink(...sessionKeys);
    }
  } catch (err) {
    // Fatal, unlike the same command in logout() — argued at length in the
    // header. The password has already changed, so this 503 reports a partial
    // success truthfully rather than undoing anything.
    log.error(
      { err, userId },
      '[auth] resetPassword: password changed but sessions could NOT be revoked',
    );
    throw ServiceUnavailableError();
  }

  // Housekeeping, best-effort, both keys inert once the sessions are gone: the
  // index now lists names of keys that do not exist, and the pointer names the
  // token this request already consumed.
  try {
    await redis.unlink(indexKey, keys.passwordResetPointer(userId));
  } catch (err) {
    log.warn(
      { err, userId },
      '[auth] resetPassword: index and pointer not cleaned up — inert, every session already revoked',
    );
  }

  log.info(
    { userId, revokedSessions },
    '[auth] resetPassword: password changed, all sessions revoked',
  );

  return { revokedSessions };
}

/**
 * The columns the `user:state` rewrite needs, and nothing else — plan:358's four
 * fields plus the id to key on.
 *
 * `deletedAt` is selected even though the where-clause already guarantees it is
 * null, for the reason login() gives at line 1223: the record stays truthful if
 * that filter is ever relaxed, rather than carrying a hardcoded null that quietly
 * becomes a lie. No `email`, no `fullName`, and above all no `passwordHash` — none
 * of them belongs in that record or in this function.
 */
const VERIFIED_STATE_FIELDS = Object.freeze({
  id: true,
  role: true,
  isBanned: true,
  isEmailVerified: true,
  deletedAt: true,
});

/**
 * `POST /auth/verify-email` — apidoc §8.2, plan:349, TRD:1461.
 *
 * Consumes a single-use verification token and sets `isEmailVerified`. The token
 * is read but NOT deleted until the row is committed, which is the opposite of
 * resetPassword() and is argued at length in the header: there is no
 * resend-verification endpoint, so a token destroyed by a later failure cannot be
 * replaced.
 *
 * Answers one 400 for every unusable token — unknown, expired, already consumed,
 * malformed, pointing at no row, or pointing at a soft-deleted account — and 503
 * only when Redis itself could not be read (TRD:1478, apidoc:302). Returns
 * nothing; the flag is the outcome.
 *
 * @param {{ token: string }} input The raw token from the emailed link.
 * @returns {Promise<void>}
 */
export async function verifyEmail({ token }) {
  // Hashed first and on its own, as in resetPassword(): keys.emailVerify() throws
  // on a token that is absent, empty, or not a string, and that is this caller's
  // 400 rather than something for the Redis catch below to mislabel as an outage.
  let verifyKey;
  try {
    verifyKey = keys.emailVerify(token);
  } catch {
    throw BadRequestError(MESSAGES.VALIDATION.TOKEN_INVALID);
  }

  // GET, not GETDEL. The whole asymmetry with resetPassword() lives on this line;
  // the header says why, and the UNLINK below is the other half of it.
  let stored;
  try {
    stored = await redis.get(verifyKey);
  } catch (err) {
    // Fail closed (TRD:1478): an unreadable token is not a verified account. The
    // token is untouched, so the caller's retry after the outage still works.
    log.error(
      { err },
      '[auth] verifyEmail: redis unavailable — token not read, nothing verified',
    );
    throw ServiceUnavailableError();
  }

  // Unknown, expired, or already redeemed — apidoc:301's three causes, and one
  // answer for all of them so a token cannot be probed to learn which it was.
  if (stored === null) {
    throw BadRequestError(MESSAGES.VALIDATION.TOKEN_INVALID);
  }

  // setWithTTL JSON-stringifies every value, so this comes back as a QUOTED
  // string: measured, GET returns "\"<uuid>\"" and not the bare id. Parsing is
  // mandatory, not stylistic — the unparsed value would be a 36-character id
  // wrapped in quote characters and would never match a row.
  let userId;
  try {
    userId = JSON.parse(stored);
  } catch {
    userId = null;
  }

  if (typeof userId !== 'string' || userId.length === 0) {
    // Corruption in a namespace only register() writes, so it is logged loudly and
    // still answered as an invalid token, which is the honest answer to the caller.
    log.error(
      { verifyKey },
      '[auth] verifyEmail: verification key held an unusable value — treated as invalid',
    );
    throw BadRequestError(MESSAGES.VALIDATION.TOKEN_INVALID);
  }

  let row;
  try {
    // `deletedAt: null` is part of the where-clause, not a filter applied after
    // the fact: measured against Prisma 6.19, a soft-deleted row raises P2025 and
    // the flag is left false. See the header — this one statement decides that the
    // account exists, that it is not soft-deleted, and what user:state should say.
    row = await prisma.user.update({
      where: { id: userId, deletedAt: null },
      data: { isEmailVerified: true },
      select: VERIFIED_STATE_FIELDS,
    });
  } catch (err) {
    if (err?.code === 'P2025') {
      // No such row, or a soft-deleted one. The first case is the residual named
      // at line 45: a token that outlived a rolled-back COMMIT. Warn, not error —
      // both are states the design allows for, and both self-heal in 24 h.
      log.warn(
        { userId },
        '[auth] verifyEmail: token names no live account — treated as invalid',
      );
      throw BadRequestError(MESSAGES.VALIDATION.TOKEN_INVALID);
    }
    if (err?.code === 'P2023') {
      // Measured, and the reason this catch differs from resetPassword()'s: an id
      // that is not a UUID raises P2023, not P2025, and the string guard above
      // cannot exclude it. Without this branch the answer would be a 500.
      log.error(
        { err, userId },
        '[auth] verifyEmail: verification key held a malformed id — treated as invalid',
      );
      throw BadRequestError(MESSAGES.VALIDATION.TOKEN_INVALID);
    }
    throw err;
  }

  // Consumed only now, and best-effort: the flag is committed, so a token that
  // outlives this line can only be replayed into the same idempotent success.
  try {
    const removed = await redis.unlink(verifyKey);
    if (removed === 0) {
      // Measured: 1 when this call removed the key, 0 when it was already gone.
      // Reaching 0 here means a second request carrying the same token passed its
      // GET inside this one's window — harmless, since both set the same flag, but
      // it is the only visible trace of the race and worth one line.
      log.warn(
        { userId: row.id },
        '[auth] verifyEmail: token was already consumed concurrently — same outcome, no action',
      );
    }
  } catch (err) {
    log.warn(
      { err, userId: row.id },
      '[auth] verifyEmail: token not deleted — replayable until its 24h TTL, and idempotent',
    );
  }

  // plan:349's reason for existing: without this the new flag is invisible to
  // requireVerifiedEmail for up to TTL.userState. Best-effort — the header argues
  // why a failure here must not turn a completed verification into a 503.
  //
  // Tracked in a flag rather than assumed, because the success line below is the
  // one an operator reads when a verified user still cannot enrol. Reporting
  // "state rewritten" on the branch that just warned it could not be rewritten
  // would point that investigation away from the only thing that went wrong.
  let stateRewritten = false;
  try {
    await setWithTTL(
      keys.userState(row.id),
      {
        role: row.role,
        isBanned: row.isBanned,
        isEmailVerified: row.isEmailVerified,
        deletedAt: row.deletedAt,
      },
      TTL.userState,
    );
    stateRewritten = true;
  } catch (err) {
    log.warn(
      { err, userId: row.id },
      '[auth] verifyEmail: user:state not rewritten — flag is committed, next read falls through to Postgres',
    );
  }

  log.info(
    { userId: row.id, stateRewritten },
    '[auth] verifyEmail: email verified',
  );
}

export default {
  register,
  generateToken,
  signAccessToken,
  getProfile,
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  verifyEmail,
  REFRESH_COOKIE,
};
