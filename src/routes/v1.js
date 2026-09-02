// ─────────────────────────────────────────────────────────────────────────────
// The /api/v1 router — plan:304, README:184, task 3.9.
//
// One job: collect every feature module's router and give app.js a single object
// to mount. app.js gains one import and one `app.use` for the whole API rather
// than one per module, so the ~16 modules of Days 3-16 never touch it again.
//
// ── WHY THE VERSION LIVES IN THE MOUNT PATH AND NOT IN HERE ──────────────────
//
// This file registers '/auth', not '/api/v1/auth'. app.js owns the prefix
// (`app.use('/api/v1', apiRouter)`), which is what makes a v2 a new file mounted
// beside this one instead of a search-and-replace across every module. It is also
// why the swagger annotations in each module are written as `/auth/...`: the
// generated spec's server URL already carries `/api/v1`, so a path that repeated
// it would document `/api/v1/api/v1/auth/login`.
//
// A router is mounted here only when its module exists. An empty `Router()` for a
// module still to be written would answer 404 for its paths, which is what an
// absent router already does — the same behaviour at the cost of a line that has
// to be found and changed later.
//
// ── WHAT README:184 LISTS THAT IS NOT HERE ───────────────────────────────────
//
// README describes this directory as "Root router mounting (/health, /api/v1,
// /api-docs)". Only the middle one is here, and both omissions are deliberate.
//
// /health is in app.js (task 2.7) and has to be. It is mounted ABOVE
// express.json() and above globalRateLimiter so that a liveness probe is never
// rate-limited and never parses a body; moving it behind this router would put it
// below both. app.js's header carries that as an ordering invariant.
//
// /api-docs is task 4.8, which wires swagger-jsdoc. The annotations that feed it
// are already being written in the module routers (plan:1033) — there is just no
// generator reading them yet.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';

import authRoutes from '../modules/auth/auth.routes.js';
import subjectsRoutes from '../modules/subjects/subjects.routes.js';
import { coursesRoutes } from '../modules/courses/courses.routes.js';
import modulesRoutes from '../modules/modules/modules.routes.js';
import lessonsRoutes from '../modules/lessons/lessons.routes.js';
import enrollmentsRoutes from '../modules/enrollments/enrollments.routes.js';
import quizzesRoutes from '../modules/quizzes/quizzes.routes.js';
import resourcesRoutes from '../modules/resources/resources.routes.js';
import usersRoutes from '../modules/users/users.routes.js';
import achievementsRoutes from '../modules/achievements/achievements.routes.js';
import certificatesRoutes from '../modules/certificates/certificates.routes.js';
import instructorsRoutes from '../modules/instructors/instructors.routes.js';
import bookmarksRoutes from '../modules/bookmarks/bookmarks.routes.js';
import reviewsRoutes from '../modules/reviews/reviews.routes.js';
import webhooksRoutes from '../modules/webhooks/webhooks.routes.js';
import notificationsRoutes from '../modules/notifications/notifications.routes.js';
import adminRoutes from '../modules/admin/admin.routes.js';

const apiRouter = Router();

apiRouter.use('/auth', authRoutes);
apiRouter.use('/subjects', subjectsRoutes);
apiRouter.use('/courses', coursesRoutes);
apiRouter.use('/modules', modulesRoutes);
apiRouter.use('/lessons', lessonsRoutes);
apiRouter.use('/enrollments', enrollmentsRoutes);
apiRouter.use('/quizzes', quizzesRoutes);
apiRouter.use('/resources', resourcesRoutes);
apiRouter.use('/users', usersRoutes);
apiRouter.use('/achievements', achievementsRoutes);
apiRouter.use('/certificates', certificatesRoutes);
apiRouter.use('/instructors', instructorsRoutes);
apiRouter.use('/bookmarks', bookmarksRoutes);
apiRouter.use('/reviews', reviewsRoutes);
apiRouter.use('/webhooks', webhooksRoutes);
apiRouter.use('/notifications', notificationsRoutes);
apiRouter.use('/admin', adminRoutes);

export default apiRouter;
