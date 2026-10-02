export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PLAN_LIMIT"
  | "ODOMETER_REGRESSION"
  | "DUPLICATE_RECORD"
  | "BAD_REQUEST"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  PLAN_LIMIT: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ODOMETER_REGRESSION: 409,
  DUPLICATE_RECORD: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found`);
export const forbidden = (msg = "You do not have permission to do that") => new AppError("FORBIDDEN", msg);
export const badRequest = (msg: string, details?: unknown) => new AppError("BAD_REQUEST", msg, details);
export const conflict = (msg: string, details?: unknown) => new AppError("CONFLICT", msg, details);
