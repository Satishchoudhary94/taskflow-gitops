import { describe, expect, it } from 'vitest';
import {
  loginSchema,
  registerSchema,
  taskCreateSchema,
  taskQuerySchema,
  workspaceCreateSchema,
} from '../../src/models/schemas';

describe('validation schemas', () => {
  describe('registerSchema', () => {
    it('accepts a valid registration and lowercases the email', () => {
      const parsed = registerSchema.parse({
        email: 'User@Example.COM',
        name: '  Priya  ',
        password: 'Secret123',
      });
      expect(parsed.email).toBe('user@example.com');
      expect(parsed.name).toBe('Priya');
    });

    it.each([
      ['not-an-email', 'Secret123'],
      ['a@b.co', 'short1'], // too short
      ['a@b.co', 'onlyletters'], // no digit
      ['a@b.co', '12345678'], // no letter
    ])('rejects email=%s password=%s', (email, password) => {
      expect(() => registerSchema.parse({ email, name: 'X', password })).toThrow();
    });

    it('rejects missing fields', () => {
      expect(() => loginSchema.parse({ email: 'a@b.co' })).toThrow();
    });
  });

  describe('taskCreateSchema', () => {
    it('applies defaults for status and priority', () => {
      const parsed = taskCreateSchema.parse({ title: 'Ship it' });
      expect(parsed.status).toBe('TODO');
      expect(parsed.priority).toBe('MEDIUM');
      expect(parsed.description).toBe('');
    });

    it('rejects an invalid status', () => {
      expect(() => taskCreateSchema.parse({ title: 'X', status: 'DOING' })).toThrow();
    });

    it('rejects an invalid due date', () => {
      expect(() => taskCreateSchema.parse({ title: 'X', dueDate: '31-08-2026' })).toThrow();
    });

    it('accepts a null assignee (unassigning)', () => {
      const parsed = taskCreateSchema.parse({ title: 'X', assigneeId: null });
      expect(parsed.assigneeId).toBeNull();
    });
  });

  describe('taskQuerySchema', () => {
    it('accepts valid filters', () => {
      const parsed = taskQuerySchema.parse({ status: 'DONE', search: 'docker' });
      expect(parsed.status).toBe('DONE');
    });

    it('rejects an invalid priority filter', () => {
      expect(() => taskQuerySchema.parse({ priority: 'MAXIMUM' })).toThrow();
    });
  });

  describe('workspaceCreateSchema', () => {
    it('rejects an empty name', () => {
      expect(() => workspaceCreateSchema.parse({ name: '   ' })).toThrow();
    });
  });
});
