import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const isFix = process.argv.includes('--fix');

async function reconcile() {
  console.log(`Starting reconciliation in ${isFix ? 'FIX' : 'REPORT-ONLY'} mode...`);
  
  let divergences = 0;
  let fixes = 0;

  const reportDiff = (entityType, entityId, field, current, expected) => {
    divergences++;
    console.warn(`[DRIFT] ${entityType} ${entityId} - ${field}: is ${current}, expected ${expected}`);
  };

  // 1. Subject.courseCount
  const subjects = await prisma.subject.findMany({
    select: { id: true, name: true, courseCount: true }
  });

  for (const subject of subjects) {
    const expected = await prisma.course.count({
      where: { subjectId: subject.id, isPublished: true, deletedAt: null }
    });

    if (subject.courseCount !== expected) {
      reportDiff('Subject', subject.id, 'courseCount', subject.courseCount, expected);
      if (isFix) {
        await prisma.subject.update({
          where: { id: subject.id },
          data: { courseCount: expected }
        });
        fixes++;
      }
    }
  }

  // 2-4. Course.studentCount, Course.rating, Course.reviewCount
  const courses = await prisma.course.findMany({
    select: { id: true, title: true, studentCount: true, rating: true, reviewCount: true }
  });

  for (const course of courses) {
    const expectedStudentCount = await prisma.enrollment.count({
      where: { courseId: course.id }
    });

    if (course.studentCount !== expectedStudentCount) {
      reportDiff('Course', course.id, 'studentCount', course.studentCount, expectedStudentCount);
      if (isFix) {
        await prisma.course.update({
          where: { id: course.id },
          data: { studentCount: expectedStudentCount }
        });
        fixes++;
      }
    }

    const reviewStats = await prisma.review.aggregate({
      where: { courseId: course.id },
      _avg: { rating: true },
      _count: { id: true }
    });

    const expectedRating = reviewStats._avg.rating || 0;
    const expectedReviewCount = reviewStats._count.id;

    if (Math.abs(course.rating - expectedRating) > 0.001) {
      reportDiff('Course', course.id, 'rating', course.rating, expectedRating);
      if (isFix) {
        await prisma.course.update({
          where: { id: course.id },
          data: { rating: expectedRating }
        });
        fixes++;
      }
    }

    if (course.reviewCount !== expectedReviewCount) {
      reportDiff('Course', course.id, 'reviewCount', course.reviewCount, expectedReviewCount);
      if (isFix) {
        await prisma.course.update({
          where: { id: course.id },
          data: { reviewCount: expectedReviewCount }
        });
        fixes++;
      }
    }
  }

  // 5-6. Instructor.studentCount, Instructor.rating
  const instructors = await prisma.instructor.findMany({
    select: { id: true, userId: true, studentCount: true, rating: true }
  });

  for (const instructor of instructors) {
    const expectedStudentCount = await prisma.enrollment.count({
      where: { course: { instructorId: instructor.id } }
    });

    if (instructor.studentCount !== expectedStudentCount) {
      reportDiff('Instructor', instructor.id, 'studentCount', instructor.studentCount, expectedStudentCount);
      if (isFix) {
        await prisma.instructor.update({
          where: { id: instructor.id },
          data: { studentCount: expectedStudentCount }
        });
        fixes++;
      }
    }

    const pubCourses = await prisma.course.findMany({
      where: { instructorId: instructor.id, isPublished: true, deletedAt: null },
      select: { rating: true, studentCount: true }
    });

    let totalWeightedRating = 0;
    let totalStudents = 0;

    pubCourses.forEach(c => {
      totalWeightedRating += c.rating * c.studentCount;
      totalStudents += c.studentCount;
    });

    const expectedRating = totalStudents > 0 ? totalWeightedRating / totalStudents : 0;

    if (Math.abs(instructor.rating - expectedRating) > 0.001) {
      reportDiff('Instructor', instructor.id, 'rating', instructor.rating, expectedRating);
      if (isFix) {
        await prisma.instructor.update({
          where: { id: instructor.id },
          data: { rating: expectedRating }
        });
        fixes++;
      }
    }
  }

  console.log(`\nReconciliation complete.`);
  console.log(`Divergences found: ${divergences}`);
  if (isFix) {
    console.log(`Fixes applied: ${fixes}`);
  }
}

reconcile()
  .catch((e) => {
    console.error('Fatal error during reconciliation:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
