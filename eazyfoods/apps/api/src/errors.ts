// Customer-safe errors. `message` is shown to users; `internal` is logged only.
export class AppError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public details?: unknown,
    public internal?: string,
  ) {
    super(message);
  }
}
export const badRequest = (code: string, msg: string, details?: unknown) => new AppError(code, 400, msg, details);
export const unauthorized = (msg = 'Please sign in to continue.') => new AppError('UNAUTHENTICATED', 401, msg);
export const forbidden = (msg = 'You do not have permission to do that.') => new AppError('FORBIDDEN', 403, msg);
export const notFound = (what = 'That item') => new AppError('NOT_FOUND', 404, `${what} could not be found.`);
export const conflict = (code: string, msg: string, details?: unknown) => new AppError(code, 409, msg, details);
