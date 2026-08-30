import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as modulesService from '../modules.service.js';
import prisma from '../../../database/index.js';
import { verifyCourseOwnership } from '../../courses/courses.service.js';

vi.mock('../../../database/index.js', () => ({
  default: {
    module: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('../../courses/courses.service.js', () => ({
  verifyCourseOwnership: vi.fn(),
}));

describe('Modules Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createModule', () => {
    it('verifies course ownership and creates a module', async () => {
      verifyCourseOwnership.mockResolvedValue({ id: 'course-1' });
      prisma.module.create.mockResolvedValue({ id: 'mod-1', title: 'Mod 1', orderIndex: 0 });

      const result = await modulesService.createModule('user-1', 'INSTRUCTOR', 'course-1', { title: 'Mod 1', orderIndex: 0 });

      expect(verifyCourseOwnership).toHaveBeenCalledWith('course-1', 'user-1', 'INSTRUCTOR');
      expect(prisma.module.create).toHaveBeenCalledWith({
        data: { courseId: 'course-1', title: 'Mod 1', orderIndex: 0 },
      });
      expect(result.id).toBe('mod-1');
    });
  });

  describe('updateModule', () => {
    it('verifies ownership and updates', async () => {
      prisma.module.findUnique.mockResolvedValue({ id: 'mod-1', courseId: 'course-1' });
      verifyCourseOwnership.mockResolvedValue({ id: 'course-1' });
      prisma.module.update.mockResolvedValue({ id: 'mod-1', title: 'Mod 1 Updated' });

      const result = await modulesService.updateModule('user-1', 'INSTRUCTOR', 'mod-1', { title: 'Mod 1 Updated' });

      expect(prisma.module.findUnique).toHaveBeenCalledWith({ where: { id: 'mod-1' } });
      expect(verifyCourseOwnership).toHaveBeenCalledWith('course-1', 'user-1', 'INSTRUCTOR');
      expect(prisma.module.update).toHaveBeenCalledWith({
        where: { id: 'mod-1' },
        data: { title: 'Mod 1 Updated' },
      });
      expect(result.title).toBe('Mod 1 Updated');
    });
  });

  describe('deleteModule', () => {
    it('verifies ownership and deletes', async () => {
      prisma.module.findUnique.mockResolvedValue({ id: 'mod-1', courseId: 'course-1' });
      verifyCourseOwnership.mockResolvedValue({ id: 'course-1' });
      prisma.module.delete.mockResolvedValue({ id: 'mod-1' });

      await modulesService.deleteModule('user-1', 'INSTRUCTOR', 'mod-1');

      expect(prisma.module.findUnique).toHaveBeenCalledWith({ where: { id: 'mod-1' } });
      expect(verifyCourseOwnership).toHaveBeenCalledWith('course-1', 'user-1', 'INSTRUCTOR');
      expect(prisma.module.delete).toHaveBeenCalledWith({ where: { id: 'mod-1' } });
    });
  });
});
