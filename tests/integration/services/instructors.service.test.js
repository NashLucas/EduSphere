import { describe, it, expect, beforeEach } from 'vitest';
import * as instructorsService from '../../../src/modules/instructors/instructors.service.js';
import { makeUser, makeCourse, makeEnrollment } from '../factories.js';
import prisma from '../../../src/database/index.js';

describe('Instructors Service Integration', () => {
  let user, instructor, course;

  beforeEach(async () => {
    user = await makeUser({ role: 'INSTRUCTOR' });
    instructor = await instructorsService.createInstructorProfile(user.id);
    
    course = await makeCourse({ 
      instructorId: instructor.id, 
      isPublished: true 
    });
  });

  it('getInstructorDashboard should return overview and stats', async () => {
    // Add enrollment to test dashboard
    const student = await makeUser({ role: 'STUDENT' });
    await makeEnrollment(student.id, course.id);

    const dashboard = await instructorsService.getInstructorDashboard(user.id);
    expect(dashboard.overview.publishedCourseCount).toBe(1);
    expect(dashboard.enrollmentTrend).toBeDefined();
    expect(dashboard.recentEnrollments.length).toBe(1);
    expect(dashboard.topCourse.id).toBe(course.id);
  });

  it('getInstructorDashboard should throw if not found', async () => {
    const unknownId = '00000000-0000-0000-0000-000000000000';
    await expect(instructorsService.getInstructorDashboard(unknownId))
      .rejects.toThrow('Instructor profile not found');
  });

  it('getInstructorCourses should return ordered courses', async () => {
    const courses = await instructorsService.getInstructorCourses(user.id);
    expect(courses.length).toBe(1);
    expect(courses[0].id).toBe(course.id);
  });

  it('getInstructorCourses should throw if not found', async () => {
    const unknownId = '00000000-0000-0000-0000-000000000000';
    await expect(instructorsService.getInstructorCourses(unknownId))
      .rejects.toThrow('Instructor profile not found');
  });

  it('getInstructorProfile should return public profile', async () => {
    const profile = await instructorsService.getInstructorProfile(instructor.id);
    expect(profile.id).toBe(instructor.id);
    expect(profile.publishedCourseCount).toBe(1);
    expect(profile.publishedCourses.length).toBe(1);
  });

  it('getInstructorProfile should throw if not found', async () => {
    const unknownId = '00000000-0000-0000-0000-000000000000';
    await expect(instructorsService.getInstructorProfile(unknownId))
      .rejects.toThrow('Instructor profile not found');
  });
});
