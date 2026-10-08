import { Router } from 'express';
import { authController } from '../controllers/authController';
import { workspaceController } from '../controllers/workspaceController';
import { projectController } from '../controllers/projectController';
import { taskController } from '../controllers/taskController';
import { commentController } from '../controllers/commentController';
import { dashboardController } from '../controllers/dashboardController';
import { userController } from '../controllers/userController';
import { requireAuth } from '../middleware/auth';
import { validate, validateUuidParams } from '../middleware/validate';
import {
  commentCreateSchema,
  commentUpdateSchema,
  loginSchema,
  memberAddSchema,
  projectCreateSchema,
  projectUpdateSchema,
  registerSchema,
  taskCreateSchema,
  taskQuerySchema,
  taskUpdateSchema,
  userSearchQuerySchema,
  workspaceCreateSchema,
  workspaceUpdateSchema,
} from '../models/schemas';

/** All application endpoints, mounted under /api (see app.ts). */
export const apiRouter = Router();

// --- auth (public except logout/me) ---
apiRouter.post('/auth/register', validate({ body: registerSchema }), authController.register);
apiRouter.post('/auth/login', validate({ body: loginSchema }), authController.login);
apiRouter.post('/auth/logout', requireAuth, authController.logout);
apiRouter.get('/auth/me', requireAuth, authController.me);

// Everything below requires a valid JWT.
apiRouter.use(requireAuth);

// --- users ---
apiRouter.get('/users', validate({ query: userSearchQuerySchema }), userController.search);

// --- dashboard ---
apiRouter.get('/dashboard', dashboardController.get);

// --- workspaces ---
apiRouter.post('/workspaces', validate({ body: workspaceCreateSchema }), workspaceController.create);
apiRouter.get('/workspaces', workspaceController.list);
apiRouter.get('/workspaces/:workspaceId', validateUuidParams('workspaceId'), workspaceController.get);
apiRouter.patch(
  '/workspaces/:workspaceId',
  validateUuidParams('workspaceId'),
  validate({ body: workspaceUpdateSchema }),
  workspaceController.update,
);
apiRouter.delete('/workspaces/:workspaceId', validateUuidParams('workspaceId'), workspaceController.remove);

// --- workspace members ---
apiRouter.get(
  '/workspaces/:workspaceId/members',
  validateUuidParams('workspaceId'),
  workspaceController.listMembers,
);
apiRouter.post(
  '/workspaces/:workspaceId/members',
  validateUuidParams('workspaceId'),
  validate({ body: memberAddSchema }),
  workspaceController.addMember,
);
apiRouter.delete(
  '/workspaces/:workspaceId/members/:userId',
  validateUuidParams('workspaceId', 'userId'),
  workspaceController.removeMember,
);

// --- projects ---
apiRouter.post(
  '/workspaces/:workspaceId/projects',
  validateUuidParams('workspaceId'),
  validate({ body: projectCreateSchema }),
  projectController.create,
);
apiRouter.get(
  '/workspaces/:workspaceId/projects',
  validateUuidParams('workspaceId'),
  projectController.listByWorkspace,
);
apiRouter.get('/projects/:projectId', validateUuidParams('projectId'), projectController.get);
apiRouter.patch(
  '/projects/:projectId',
  validateUuidParams('projectId'),
  validate({ body: projectUpdateSchema }),
  projectController.update,
);
apiRouter.delete('/projects/:projectId', validateUuidParams('projectId'), projectController.remove);

// --- tasks ---
apiRouter.post(
  '/projects/:projectId/tasks',
  validateUuidParams('projectId'),
  validate({ body: taskCreateSchema }),
  taskController.create,
);
apiRouter.get(
  '/projects/:projectId/tasks',
  validateUuidParams('projectId'),
  validate({ query: taskQuerySchema }),
  taskController.listByProject,
);
apiRouter.get('/tasks/:taskId', validateUuidParams('taskId'), taskController.get);
apiRouter.patch(
  '/tasks/:taskId',
  validateUuidParams('taskId'),
  validate({ body: taskUpdateSchema }),
  taskController.update,
);
apiRouter.delete('/tasks/:taskId', validateUuidParams('taskId'), taskController.remove);

// --- comments ---
apiRouter.get('/tasks/:taskId/comments', validateUuidParams('taskId'), commentController.listByTask);
apiRouter.post(
  '/tasks/:taskId/comments',
  validateUuidParams('taskId'),
  validate({ body: commentCreateSchema }),
  commentController.create,
);
apiRouter.patch(
  '/comments/:commentId',
  validateUuidParams('commentId'),
  validate({ body: commentUpdateSchema }),
  commentController.update,
);
apiRouter.delete('/comments/:commentId', validateUuidParams('commentId'), commentController.remove);
