import { useEffect } from 'react';

const SUFFIX = 'NoteHaven';

/**
 * Sets document.title for the current page and restores the app default on
 * unmount. Every route previously shared the static title from index.html, so
 * browser tabs, history entries and the PWA app switcher were unnavigable.
 *
 * Pass a plain string; nodes that aren't strings (a gradient <span>, say) are
 * ignored rather than stringified into "[object Object]".
 */
export function useDocumentTitle(title?: unknown) {
  useEffect(() => {
    const name = typeof title === 'string' ? title.trim() : '';
    document.title = name ? `${name} · ${SUFFIX}` : `${SUFFIX} - Your Personal Sanctuary`;
    return () => { document.title = `${SUFFIX} - Your Personal Sanctuary`; };
  }, [title]);
}
