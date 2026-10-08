import { z } from 'zod';
import { TASK_PRIORITIES, TASK_STATUSES } from './types';

/**
 * Zod schemas for every API input. All client data is validated at the route
 * boundary before it reaches a controller — nothing downstream trusts input.
 */

export const uuidSchema = z.string().uuid('must be a valid UUID');

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('must be a valid email address')
  .max(254);

const password = z
  .string()
  .min(8, 'must be at least 8 characters')
  .max(128, 'must be at most 128 characters')
  .regex(/[a-zA-Z]/, 'must contain at least one letter')
  .regex(/[0-9]/, 'must contain at least one number');

export const registerSchema = z.object({
  email,
  name: z.string().trim().min(1).max(100),
  password,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});

export const workspaceCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional().default(''),
});

export const workspaceUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'at least one field is required' });

export const memberAddSchema = z.object({
  email,
  role: z.enum(['ADMIN', 'MEMBER']).optional().default('MEMBER'),
});

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).optional().default(''),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'must be a hex color like #6366f1')
    .optional()
    .default('#6366f1'),
});

export const projectUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(2000).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a hex color like #6366f1').optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'at least one field is required' });

const dueDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD format')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be a valid date');

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional().default(''),
  status: z.enum(TASK_STATUSES).optional().default('TODO'),
  priority: z.enum(TASK_PRIORITIES).optional().default('MEDIUM'),
  assigneeId: uuidSchema.nullable().optional(),
  dueDate: dueDate.nullable().optional(),
});

export const taskUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    assigneeId: uuidSchema.nullable().optional(),
    dueDate: dueDate.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'at least one field is required' });

export const taskQuerySchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigneeId: uuidSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

export const commentCreateSchema = z.object({
  content: z.string().trim().min(1).max(2000),
});

export const commentUpdateSchema = commentCreateSchema;

export const userSearchQuerySchema = z.object({
  search: z.string().trim().min(2).max(254),
});
