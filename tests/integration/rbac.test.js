import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { makeUser, makeCourse, loginAs } from './factories.js';

describe('RBAC & Guard Integration', () => {
  it('Student hitting admin endpoints -> 403', async () => {
    const student = await makeUser({ role: 'STUDENT' });
    const authHeader = loginAs(student);

    const res = await request(app)
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', authHeader);
    
    expect(res.status).toBe(403);
  });

  it('Instructor hitting admin endpoints -> 403', async () => {
    const instructor = await makeUser({ role: 'INSTRUCTOR' });
    const authHeader = loginAs(instructor);

    const res = await request(app)
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', authHeader);
    
    expect(res.status).toBe(403);
  });

  it('requireOwner on courses: Instructor A cannot edit Instructor B\'s course', async () => {
    // Instructor A
    const instructorA = await makeUser({ role: 'INSTRUCTOR' });
    const authHeaderA = loginAs(instructorA);

    // Instructor B and their course
    const instructorB = await makeUser({ role: 'INSTRUCTOR' });
    // Note: makeCourse looks up the Instructor record, not just the User record.
    // Our factory automatically creates an instructor profile when none is passed.
    // But since we want to specify it, we need to create the instructor record for B first if makeCourse doesn't do it automatically based on userId.
    // Wait, the factory's makeCourse looks for `overrides.instructorId`. That's the ID of the INSTRUCTOR profile, not the User!
    // Let's just use makeCourse and it will create ONE instructor by itself, which we can extract!
    const course = await makeCourse();
    
    // The course is owned by the instructor created in makeCourse. 
    // Instructor A is definitely a different user.
    
    const res = await request(app)
      .put(`/api/v1/courses/${course.id}`)
      .set('Authorization', authHeaderA)
      .send({ title: 'Hacked Title' });
    
    expect(res.status).toBe(403);
  });

  it('Admin hitting admin endpoints -> 200', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const authHeader = loginAs(admin);

    const res = await request(app)
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', authHeader);
    
    // It might be 200, or it might be a valid endpoint response depending on payload
    // If it's a 200, it passes RBAC.
    expect(res.status).toBe(200);
  });
});
