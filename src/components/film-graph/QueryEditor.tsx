/**
 * GraphQL editor: CodeMirror 6 with schema-aware autocomplete, linting and
 * syntax highlighting from cm6-graphql. Loaded lazily, only on this page.
 */
import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import { buildSchema } from "graphql";
import { graphql } from "cm6-graphql";
import typeDefs from "../../filmgraph/api/schema.graphql?raw";

const schema = buildSchema(typeDefs);

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#9b1023" },
  { tag: [tags.propertyName, tags.attributeName], color: "#1a1816" },
  { tag: tags.variableName, color: "#1f5f8b" },
  { tag: [tags.typeName, tags.className], color: "#1f7a4d" },
  { tag: [tags.string, tags.number, tags.bool], color: "#8a4b08" },
  { tag: tags.comment, color: "#6b6762", fontStyle: "italic" },
  { tag: tags.punctuation, color: "#5f5c58" },
]);

const theme = EditorView.theme({
  "&": { fontSize: "0.86rem", backgroundColor: "#fff" },
  ".cm-content": { fontFamily: "var(--fg-mono)", padding: "0.6rem 0", caretColor: "#d0102c" },
  ".cm-gutters": { backgroundColor: "#f6f5f3", color: "#6b6762", border: "none", borderRight: "1px solid #e4e2de" },
  ".cm-activeLine": { backgroundColor: "#faf9f7" },
  ".cm-activeLineGutter": { backgroundColor: "#f3f2f0" },
  "&.cm-focused": { outline: "none" },
  ".cm-tooltip": { border: "1px solid #e4e2de", borderRadius: "8px", overflow: "hidden" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "#d0102c", color: "#fff" },
  ".cm-scroller": { overflow: "auto" },
});

interface Props {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  labelId: string;
}

export default function QueryEditor({ value, onChange, onRun, labelId }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onRun });
  callbacks.current = { onChange, onRun };

  useEffect(() => {
    if (!host.current) return;
    const runKey = { key: "Mod-Enter", run: () => (callbacks.current.onRun(), true) };
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          syntaxHighlighting(highlight),
          graphql(schema),
          keymap.of([runKey, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
          theme,
          EditorView.contentAttributes.of({ "aria-labelledby": labelId, "aria-multiline": "true" }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    return () => view.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Replace the document when a preset is chosen.
  useEffect(() => {
    const current = view.current;
    if (current && current.state.doc.toString() !== value) {
      current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div className="fg-editor" ref={host} />;
}
