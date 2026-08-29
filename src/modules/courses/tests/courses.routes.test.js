import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { coursesRoutes } from '../courses.routes.js';
import * as coursesController from '../courses.controller.js';

vi.mock('../courses.controller.js', () => ({
  getFeaturedCourses: vi.fn((req, res) => res.status(200).json({ status: 'success', data: 'featured' })),
  getCourseBySlug: vi.fn((req, res) => res.status(200).json({ status: 'success', data: 'slug', slug: req.params.slug })),
  getCourses: vi.fn((req, res) => res.status(200).json({ status: 'success', data: 'list' })),
}));

const app = express();
app.use(express.json());
app.use('/courses', coursesRoutes);
// A global error handler to prevent supertest 500 html output
app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ error: err.message }));

describe('Task 4.4: Course Route Registration Order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /courses/featured routes to getFeaturedCourses, NOT getCourseBySlug', async () => {
    const res = await request(app).get('/courses/featured');
    
    expect(res.status).toBe(200);
    expect(res.body.data).toBe('featured');
    
    expect(coursesController.getFeaturedCourses).toHaveBeenCalled();
    expect(coursesController.getCourseBySlug).not.toHaveBeenCalled();
  });

  it('GET /courses/some-slug routes to getCourseBySlug', async () => {
    const res = await request(app).get('/courses/some-slug');
    
    expect(res.status).toBe(200);
    expect(res.body.data).toBe('slug');
    expect(res.body.slug).toBe('some-slug');
    
    expect(coursesController.getCourseBySlug).toHaveBeenCalled();
    expect(coursesController.getFeaturedCourses).not.toHaveBeenCalled();
  });
});
