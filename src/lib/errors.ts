/**
 * Errors that are safe to show a user, with a stable machine code so the
 * widget and the model can react without parsing Polish prose.
 */
export type AppErrorCode =
  | 'not_found'
  | 'invalid_input'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'slot_unavailable'
  | 'token_expired'
  | 'token_invalid'
  | 'price_changed'
  | 'conflict'
  | 'cancellation_window_closed'
  | 'config_error'
  | 'internal';

export class AppError extends Error {
  override readonly name = 'AppError';
  readonly code: AppErrorCode;
  readonly status: number;
  /** Extra machine-readable context. Must never contain PII or health data. */
  readonly details: Record<string, string | number | boolean>;

  constructor(
    code: AppErrorCode,
    message: string,
    status = 400,
    details: Record<string, string | number | boolean> = {},
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const errors = {
  notFound: (message = 'Nie znaleziono zasobu.') => new AppError('not_found', message, 404),
  invalid: (message: string, details = {}) => new AppError('invalid_input', message, 400, details),
  unauthorized: (message = 'Wymagane zalogowanie.') => new AppError('unauthorized', message, 401),
  forbidden: (message = 'Brak uprawnień do tej operacji.') => new AppError('forbidden', message, 403),
  rateLimited: (message = 'Zbyt wiele żądań. Spróbuj ponownie za chwilę.') =>
    new AppError('rate_limited', message, 429),
  conflict: (message: string, details = {}) => new AppError('conflict', message, 409, details),
  internal: (message = 'Wystąpił błąd po stronie serwera.') => new AppError('internal', message, 500),
};

/** Never leak an unexpected error's message to the client. */
export function toPublicError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return errors.internal();
}
