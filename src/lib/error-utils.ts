/**
 * Utility to extract error message from unknown error type
 * Use this in catch blocks instead of (e: any)
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return 'An unknown error occurred';
}

/**
 * Type guard to check if value is an Error object
 */
export function isError(value: unknown): value is Error {
  return value instanceof Error;
}