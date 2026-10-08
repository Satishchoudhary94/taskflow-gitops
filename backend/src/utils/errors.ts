/**
 * Application error type.
 *
 * Services throw AppError with a machine-readable `code`; the central error
 * handler turns it into the API's consistent error envelope:
 *   { "error": { "code": "...", "message": "...", "details": [...] } }
 * Anything that is NOT an AppError is treated as an unexpected 500 and its
 * details are logged internally but never exposed to clients.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  badRequest: (code: string, message: string, details?: unknown): AppError =>
    new AppError(400, code, message, details),
  unauthorized: (message = 'Authentication required'): AppError =>
    new AppError(401, 'UNAUTHORIZED', message),
  forbidden: (message = 'You do not have permission to perform this action'): AppError =>
    new AppError(403, 'FORBIDDEN', message),
  notFound: (code: string, message: string): AppError => new AppError(404, code, message),
  conflict: (code: string, message: string): AppError => new AppError(409, code, message),
};
