import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Returns a Tailwind text color class (neutral-900 or neutral-100) based on luminance of a hex background
export function getContrastTextColor(hexColor: string | null | undefined): string {
  if (!hexColor) return '';
  let hex = hexColor.trim();
  if (hex.startsWith('#')) hex = hex.slice(1);
  // Support 3-digit shorthand
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('');
  }
  if (hex.length !== 6 || /[^0-9a-fA-F]/.test(hex)) {
    // Fallback neutral dark text if parsing fails
    return 'text-neutral-900';
  }
  const r = parseInt(hex.substring(0,2), 16);
  const g = parseInt(hex.substring(2,4), 16);
  const b = parseInt(hex.substring(4,6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? 'text-neutral-900' : 'text-neutral-100';
}
