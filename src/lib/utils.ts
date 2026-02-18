import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import DOMPurify from 'dompurify'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Sanitizes HTML content to prevent XSS attacks.
 * Removes all potentially dangerous tags and attributes.
 * Only allows safe formatting tags.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li'],
    ALLOWED_ATTR: [],
    ALLOW_DATA_ATTR: false,
    SANITIZE_DOM: true,
  })
}

/**
 * Sanitizes HTML for preview display with more allowed tags
 * but still removes dangerous content.
 */
export function sanitizePreview(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre', 'span'],
    ALLOWED_ATTR: ['class'],
    ALLOW_DATA_ATTR: false,
    SANITIZE_DOM: true,
  })
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
