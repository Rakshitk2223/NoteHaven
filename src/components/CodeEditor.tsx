import { useRef, useEffect, useState } from 'react';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
} from '@codemirror/view';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter } from '@codemirror/language';

// ---------------------------------------------------------------------------
// Language support
// ---------------------------------------------------------------------------
// Modes are imported on demand rather than statically: the editor covers 18
// languages, and bundling every grammar would bloat the codemirror chunk for
// someone who only ever opens a .env file. The compartment below swaps the mode
// in once the import resolves, so switching language never rebuilds the editor
// (which used to discard cursor position and the whole undo history).
const LANGUAGE_LOADERS: Record<string, () => Promise<Extension>> = {
  javascript: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  typescript: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })),
  python:     () => import('@codemirror/lang-python').then((m) => m.python()),
  html:       () => import('@codemirror/lang-html').then((m) => m.html()),
  css:        () => import('@codemirror/lang-css').then((m) => m.css()),
  json:       () => import('@codemirror/lang-json').then((m) => m.json()),
  sql:        () => import('@codemirror/lang-sql').then((m) => m.sql()),
  yaml:       () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  markdown:   () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  rust:       () => import('@codemirror/lang-rust').then((m) => m.rust()),
  cpp:        () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  java:       () => import('@codemirror/lang-java').then((m) => m.java()),
  php:        () => import('@codemirror/lang-php').then((m) => m.php()),
  go:         () => import('@codemirror/lang-go').then((m) => m.go()),
  // Legacy stream parsers — one small package covers the long tail.
  bash: () => import('@codemirror/legacy-modes/mode/shell').then(async (m) => {
    const { StreamLanguage } = await import('@codemirror/language');
    return StreamLanguage.define(m.shell);
  }),
  ruby: () => import('@codemirror/legacy-modes/mode/ruby').then(async (m) => {
    const { StreamLanguage } = await import('@codemirror/language');
    return StreamLanguage.define(m.ruby);
  }),
  // .env files are key=value with # comments — the properties mode fits exactly.
  env: () => import('@codemirror/legacy-modes/mode/properties').then(async (m) => {
    const { StreamLanguage } = await import('@codemirror/language');
    return StreamLanguage.define(m.properties);
  }),
  // plaintext intentionally absent — no highlighting is correct there.
};

/** True when a language actually has highlighting available. */
export function hasHighlighting(language: string): boolean {
  return language in LANGUAGE_LOADERS;
}

interface CodeEditorProps {
  value: string;
  language: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  /** Cmd/Ctrl+S inside the editor. */
  onSave?: () => void;
  darkMode?: boolean;
  className?: string;
  minHeight?: string;
}

// iOS Safari zooms the page when a focused editable's font is under 16px,
// so touch devices get 16px while desktop keeps the compact 13px.
const isTouchPrimary = () =>
  typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

const baseTheme = (minHeight: string) =>
  EditorView.theme({
    '&': {
      minHeight,
      fontSize: isTouchPrimary() ? '16px' : '13px',
      border: '1px solid hsl(var(--border))',
      borderRadius: '0.5rem',
      overflow: 'hidden',
    },
    '.cm-content': {
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Consolas", monospace',
      padding: '8px 0',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      borderRight: '1px solid hsl(var(--border))',
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { overflow: 'auto' },
  });

/** Watches the root `dark` class so the editor re-themes when Settings changes it. */
function useIsDark(override?: boolean): boolean {
  const [isDark, setIsDark] = useState(
    () => override ?? document.documentElement.classList.contains('dark'),
  );

  useEffect(() => {
    if (override !== undefined) { setIsDark(override); return; }
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains('dark'));
    sync();
    // The theme is applied by toggling a class on <html>, so a class-only
    // MutationObserver is the reliable signal — there is no event for it.
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [override]);

  return isDark;
}

const CodeEditor = ({
  value, language, readOnly = false, onChange, onSave,
  darkMode, className = '', minHeight = '200px',
}: CodeEditorProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);

  // Compartments let us reconfigure a live editor instead of tearing it down.
  const langCompartment = useRef(new Compartment()).current;
  const themeCompartment = useRef(new Compartment()).current;
  const readOnlyCompartment = useRef(new Compartment()).current;

  const isDark = useIsDark(darkMode);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);

  // Mount once. Everything that used to be a dependency here is now swapped
  // through a compartment, so the editor instance survives prop changes.
  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        bracketMatching(),
        foldGutter(),
        history(),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => { onSaveRef.current?.(); return true; },
          },
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.lineWrapping,
        baseTheme(minHeight),
        langCompartment.of([]),
        themeCompartment.of([]),
        readOnlyCompartment.of([]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Language — loaded lazily, applied via compartment.
  useEffect(() => {
    let cancelled = false;
    const loader = LANGUAGE_LOADERS[language];
    if (!loader) {
      viewRef.current?.dispatch({ effects: langCompartment.reconfigure([]) });
      return;
    }
    loader()
      .then((ext) => {
        if (cancelled || !viewRef.current) return;
        viewRef.current.dispatch({ effects: langCompartment.reconfigure(ext) });
      })
      .catch(() => { /* no highlighting is an acceptable outcome */ });
    return () => { cancelled = true; };
  }, [language, langCompartment]);

  // Theme.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.reconfigure(isDark ? oneDark : []),
    });
  }, [isDark, themeCompartment]);

  // Read-only.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.reconfigure(
        readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
      ),
    });
  }, [readOnly, readOnlyCompartment]);

  // External value changes (switching snippet, toggling secret masking).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return <div ref={containerRef} className={`code-editor-wrapper ${className}`} />;
};

export default CodeEditor;
