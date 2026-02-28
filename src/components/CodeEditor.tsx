import { useRef, useEffect, useCallback } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter } from '@codemirror/language';

function getLanguageExtension(language: string) {
  switch (language) {
    case 'javascript':
      return javascript();
    case 'typescript':
      return javascript({ typescript: true });
    case 'python':
      return python();
    case 'html':
      return html();
    case 'css':
      return css();
    case 'json':
      return json();
    default:
      return [];
  }
}

interface CodeEditorProps {
  value: string;
  language: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  darkMode?: boolean;
  className?: string;
  minHeight?: string;
}

const CodeEditor = ({ value, language, readOnly = false, onChange, darkMode, className = '', minHeight = '200px' }: CodeEditorProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const isDark = darkMode ?? document.documentElement.classList.contains('dark');

  const createEditor = useCallback(() => {
    if (!containerRef.current) return;

    if (viewRef.current) {
      viewRef.current.destroy();
    }

    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      bracketMatching(),
      foldGutter(),
      keymap.of([...defaultKeymap, indentWithTab]),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      getLanguageExtension(language),
      EditorView.lineWrapping,
      EditorView.theme({
        '&': {
          minHeight,
          fontSize: '13px',
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
        '.cm-activeLineGutter': {
          backgroundColor: 'transparent',
        },
        '&.cm-focused': {
          outline: 'none',
        },
        '.cm-scroller': {
          overflow: 'auto',
        },
      }),
    ];

    if (isDark) {
      extensions.push(oneDark);
    }

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true));
      extensions.push(EditorView.editable.of(false));
    } else {
      extensions.push(EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current?.(update.state.doc.toString());
        }
      }));
    }

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;
  }, [language, readOnly, isDark, minHeight]);

  useEffect(() => {
    createEditor();

    return () => {
      viewRef.current?.destroy();
    };
  }, [createEditor]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div ref={containerRef} className={`code-editor-wrapper ${className}`} />
  );
};

export default CodeEditor;
