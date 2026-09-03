import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { makeCourse } from './factories.js';
import prisma from '../../src/database/index.js';

describe('Search Engine Integration', () => {
  let subject1, subject2;
  let courseA, courseB, courseC, courseD;

  beforeAll(async () => {
    // Get some subjects from the seed
    const subjects = await prisma.subject.findMany({ take: 2 });
    subject1 = subjects[0];
    subject2 = subjects[1];

    courseA = await makeCourse({
      title: 'React Basics',
      slug: 'react-basics',
      subjectId: subject1.id,
      level: 'BEGINNER',
      price: 50.00,
      rating: 4.5,
      isPublished: true
    });

    courseB = await makeCourse({
      title: 'Advanced React',
      slug: 'advanced-react',
      subjectId: subject2.id,
      level: 'ADVANCED',
      price: 150.00,
      rating: 4.8,
      isPublished: true
    });

    courseC = await makeCourse({
      title: 'Angular Intro',
      slug: 'angular-intro',
      subjectId: subject1.id,
      level: 'BEGINNER',
      price: 0.00,
      rating: 3.0,
      isPublished: true
    });

    courseD = await makeCourse({
      title: 'Vue Mastery',
      slug: 'vue-mastery',
      subjectId: subject1.id,
      level: 'INTERMEDIATE',
      price: 20.00,
      rating: 5.0,
      isPublished: false // Should not be returned in public search
    });
  });

  it('filters by search text in title', async () => {
    const res = await request(app).get('/api/v1/courses?search=React');
    expect(res.status).toBe(200);
    const titles = res.body.data.map(c => c.title);
    expect(titles).toContain('React Basics');
    expect(titles).toContain('Advanced React');
    expect(titles).not.toContain('Angular Intro');
    expect(titles).not.toContain('Vue Mastery');
  });

  it('filters by level', async () => {
    const res = await request(app).get('/api/v1/courses?level=BEGINNER');
    expect(res.status).toBe(200);
    const titles = res.body.data.map(c => c.title);
    expect(titles).toContain('React Basics');
    expect(titles).toContain('Angular Intro');
    expect(titles).not.toContain('Advanced React');
    expect(titles).not.toContain('Vue Mastery');
  });

  it('filters by priceMax', async () => {
    const res = await request(app).get('/api/v1/courses?priceMax=50');
    expect(res.status).toBe(200);
    const titles = res.body.data.map(c => c.title);
    expect(titles).toContain('React Basics');
    expect(titles).toContain('Angular Intro');
    expect(titles).not.toContain('Advanced React');
  });

  it('sorts by price-high', async () => {
    const res = await request(app).get('/api/v1/courses?sort=price-high');
    expect(res.status).toBe(200);
    // Since we seeded the DB, there might be other courses. Let's just find ours.
    const myCourses = res.body.data.filter(c => ['React Basics', 'Advanced React', 'Angular Intro'].includes(c.title));
    expect(myCourses[0].title).toBe('Advanced React'); // $150
    expect(myCourses[1].title).toBe('React Basics'); // $50
    expect(myCourses[2].title).toBe('Angular Intro'); // $0
  });
  
  it('sorts by rating', async () => {
    const res = await request(app).get('/api/v1/courses?sort=rating');
    expect(res.status).toBe(200);
    const myCourses = res.body.data.filter(c => ['React Basics', 'Advanced React', 'Angular Intro'].includes(c.title));
    expect(myCourses[0].title).toBe('Advanced React'); // 4.8
    expect(myCourses[1].title).toBe('React Basics'); // 4.5
    expect(myCourses[2].title).toBe('Angular Intro'); // 3.0
  });
});
