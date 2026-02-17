/**
 * Date utilities for IST (Indian Standard Time) handling
 * All dates are treated as local IST dates to avoid timezone issues
 */

/**
 * Convert a Date object to YYYY-MM-DD string in local time
 * Use this instead of toISOString() to avoid UTC conversion
 */
export function dateToYMD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse a YYYY-MM-DD string to a Date object in local time
 * Use this instead of new Date(dateString) to avoid UTC issues
 */
export function parseYMD(dateString: string): Date {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Format a date string (YYYY-MM-DD) for display
 */
export function formatDateForDisplay(dateString: string): string {
  const date = parseYMD(dateString);
  return date.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a date string (YYYY-MM-DD) to DD/MM/YYYY format
 */
export function formatDateDDMMYYYY(dateString: string): string {
  const date = parseYMD(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Get today's date as YYYY-MM-DD string
 */
export function getTodayYMD(): string {
  return dateToYMD(new Date());
}

/**
 * Check if a date string is today
 */
export function isToday(dateString: string): boolean {
  return dateString === getTodayYMD();
}

/**
 * Add days to a date string
 */
export function addDays(dateString: string, days: number): string {
  const date = parseYMD(dateString);
  date.setDate(date.getDate() + days);
  return dateToYMD(date);
}
