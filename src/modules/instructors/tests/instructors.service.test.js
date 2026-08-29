import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInstructorProfile } from '../instructors.service.js';
import prisma from '../../../database/index.js';

vi.mock('../../../database/index.js', () => ({
  default: {
    instructor: {
      create: vi.fn(),
    },
  },
}));

describe('Instructors Service - createInstructorProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an instructor profile using the default prisma client', async () => {
    const mockProfile = { id: 'inst-1', userId: 'user-1', title: 'Instructor' };
    prisma.instructor.create.mockResolvedValueOnce(mockProfile);

    const result = await createInstructorProfile('user-1');

    expect(prisma.instructor.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        title: 'Instructor',
      },
    });
    expect(result).toEqual(mockProfile);
  });

  it('creates an instructor profile using an injected transaction client', async () => {
    const tx = {
      instructor: {
        create: vi.fn().mockResolvedValueOnce({ id: 'tx-inst-1' }),
      },
    };

    const result = await createInstructorProfile('user-2', tx);

    expect(tx.instructor.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-2',
        title: 'Instructor',
      },
    });
    expect(prisma.instructor.create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'tx-inst-1' });
  });
});
