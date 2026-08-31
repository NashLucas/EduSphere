import { describe, it, expect, vi } from 'vitest';
import { generatePresignedUrl, headObject, deleteObject, moveObject } from '../index.js';

describe('Storage Integration', () => {
  it('exports generatePresignedUrl', () => {
    expect(generatePresignedUrl).toBeDefined();
  });

  it('exports headObject', () => {
    expect(headObject).toBeDefined();
  });

  it('exports deleteObject', () => {
    expect(deleteObject).toBeDefined();
  });

  it('exports moveObject', () => {
    expect(moveObject).toBeDefined();
  });
});
