import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { placeholder as cmPlaceholder } from "@codemirror/view";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";

export type CodeLanguage = "html" | "css" | "javascript";

interface CodeEditorProps {
  value: string;
  language: CodeLanguage;
  onChange: (value: string) => void;
  darkMode?: boolean;
  placeholder?: string;
}

function languageExtension(language: CodeLanguage) {
  if (language === "css") return css();
  if (language === "javascript") return javascript();
  return html();
}

/**
 * Minimal CodeMirror 6 editor for the Sketch page. Recreates the view when the
 * language or theme changes; syncs external value changes without clobbering
 * the cursor.
 */
export function CodeEditor({
  value,
  language,
  onChange,
  darkMode = false,
  placeholder,
}: CodeEditorProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!parentRef.current) return;

    const sizingTheme = EditorView.theme({
      "&": { height: "100%" },
      ".cm-scroller": {
        overflow: "auto",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: "13px",
      },
    });

    const extensions = [
      basicSetup,
      languageExtension(language),
      cmPlaceholder(placeholder ?? ""),
      sizingTheme,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
    ];
    if (darkMode) extensions.push(oneDark);

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: parentRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Recreate on language/theme change only; value is synced separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, darkMode]);

  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  }, [value]);

  return <div ref={parentRef} className="h-full min-h-0 overflow-hidden" />;
}
