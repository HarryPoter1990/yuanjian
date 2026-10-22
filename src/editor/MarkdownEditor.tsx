import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Compartment,
  EditorSelection,
  EditorState,
  Transaction,
  type Extension,
} from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import {
  bracketMatching,
  defaultHighlightStyle,
  HighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { tags } from '@lezer/highlight';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo,
} from '@codemirror/commands';
import {
  acceptCompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  nextSnippetField,
} from '@codemirror/autocomplete';
import {
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
} from '@codemirror/search';
import { livePreviewField, previewConfig } from './live-preview';
import { activeMath, inCode, inMath, mathCompletion } from './completion';
import { mathHtml } from './renderer';
import { richTextToMarkdown } from './clipboard';
import type { EditorCommand, MarkdownEditorHandle, MarkdownEditorProps } from './types';
import 'katex/dist/katex.min.css';
import './editor.css';

const codeHighlighting = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword], color: 'var(--syntax-keyword)' },
  { tag: [tags.string, tags.regexp], color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syntax-number)' },
  { tag: [tags.comment, tags.meta], color: 'var(--syntax-comment)' },
  { tag: [tags.typeName, tags.className], color: 'var(--syntax-type)' },
  { tag: tags.function(tags.variableName), color: 'var(--syntax-function)' },
]);

function replaceSelection(view: EditorView, text: string): void {
  view.dispatch(view.state.replaceSelection(text), { userEvent: 'input' });
  view.focus();
}

function wrapSelection(view: EditorView, before: string, after = before): void {
  const selection = view.state.selection.main;
  const selected = view.state.sliceDoc(selection.from, selection.to);
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: before + selected + after },
    selection: EditorSelection.range(selection.from + before.length, selection.to + before.length),
    userEvent: 'input.format',
  });
  view.focus();
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(props, ref) {
    const host = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const propsRef = useRef(props);
    propsRef.current = props;
    const config = useRef(new Compartment());
    const features = useRef(new Compartment());
    const [formula, setFormula] = useState<string | null>(null);
    const [error, setError] = useState('');
    const pendingImages = useRef<Array<{ from: number; to: number }>>([]);
    const report = (message: string): void => {
      setError(message);
      propsRef.current.onError?.(message);
    };

    function configuration(): Extension {
      const current = propsRef.current;
      return previewConfig.of({
        mode: current.mode,
        codeLineNumbers: current.settings.codeLineNumbers,
        codeWrap: current.settings.codeWrap,
        codeFold: current.settings.codeFold,
        codeFontSize: current.settings.appearance.codeFontSize ?? 16,
        codeLineHeight: current.settings.appearance.codeLineHeight ?? 1.6,
        resolveAssetAsync: (reference) =>
          window.notes.assetUrl(reference, propsRef.current.notePath ?? undefined),
        onLink: (target) => propsRef.current.onLink?.(target),
      });
    }

    function featureExtensions(): Extension {
      const current = propsRef.current;
      return [
        current.settings.codeLineNumbers
          ? lineNumbers({
              formatNumber: (number, state) => {
                if (current.mode === 'source') return String(number);
                if (number < 1 || number > state.doc.lines) return '';
                const line = state.doc.line(number);
                const block = state
                  .field(livePreviewField, false)
                  ?.blocks.find(
                    (item) => item.type === 'fence' && line.from > item.from && line.to < item.to,
                  );
                return block ? String(number - state.doc.lineAt(block.from).number) : '';
              },
            })
          : [],
        current.settings.codeFold ? foldGutter() : [],
        current.settings.codeWrap ? EditorView.lineWrapping : [],
        mathCompletion(current.settings.snippets),
        EditorView.theme({
          '&': {
            fontSize: `${current.mode === 'source' ? current.settings.appearance.codeFontSize ?? 16 : current.settings.appearance.fontSize}px`,
            '--code-font-size': `${current.settings.appearance.codeFontSize ?? 16}px`,
            '--code-line-height': String(current.settings.appearance.codeLineHeight ?? 1.6),
          },
          '.cm-content': {
            fontFamily:
              current.mode === 'source'
                ? current.settings.appearance.codeFont
                : current.settings.appearance.bodyFont,
            lineHeight: String(current.mode === 'source' ? current.settings.appearance.codeLineHeight ?? 1.6 : current.settings.appearance.lineHeight),
            maxWidth: `calc(${current.settings.appearance.contentWidth}px + 56px)`,
          },
          '.cm-gutters': { fontFamily: current.settings.appearance.codeFont },
        }),
      ];
    }

    async function insertImages(view: EditorView, files: File[]): Promise<void> {
      if (!propsRef.current.onImage) {
        report('请先为文档选择保存位置，再添加图片。');
        return;
      }
      const selection = view.state.selection.main;
      const bookmark = { from: selection.from, to: selection.to };
      pendingImages.current.push(bookmark);
      try {
        for (const file of files) {
          const reference = await propsRef.current.onImage(file);
          if (!reference || viewRef.current !== view) continue;
          const name = file.name.replace(/[\[\]\\]/g, '') || '图片';
          const destination = /[\s()]/.test(reference)
            ? `<${reference.replace(/>/g, '%3E')}>`
            : reference;
          const text = `![${name}](${destination})`;
          view.dispatch({
            changes: { from: bookmark.from, to: bookmark.to, insert: text },
            selection: { anchor: bookmark.from + text.length },
            userEvent: 'input.paste',
          });
        }
      } catch (reason) {
        report(reason instanceof Error ? reason.message : String(reason));
      } finally {
        pendingImages.current = pendingImages.current.filter((value) => value !== bookmark);
      }
    }

    const runCommand = (name: EditorCommand): boolean => {
      const view = viewRef.current;
      if (!view) return false;
      if (name === 'undo') return undo(view);
      if (name === 'redo') return redo(view);
      if (name === 'find' || name === 'replace') return openSearchPanel(view);
      if (name === 'bold' || name === 'italic') {
        wrapSelection(view, name === 'bold' ? '**' : '*');
        return true;
      }
      if (name === 'link') {
        wrapSelection(view, '[', '](链接地址)');
        return true;
      }
      if (['heading', 'list', 'task', 'quote'].includes(name)) {
        const line = view.state.doc.lineAt(view.state.selection.main.head);
        const prefix =
          name === 'heading' ? '## ' : name === 'list' ? '- ' : name === 'task' ? '- [ ] ' : '> ';
        view.dispatch({ changes: { from: line.from, insert: prefix }, userEvent: 'input.format' });
        view.focus();
        return true;
      }
      if (name === 'code') {
        wrapSelection(view, '\n```\n', '\n```\n');
        return true;
      }
      if (name === 'math') {
        wrapSelection(view, '$', '$');
        return true;
      }
      if (name === 'table') {
        replaceSelection(view, '\n| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |\n');
        return true;
      }
      if (name === 'diagram') {
        replaceSelection(view, '\n```mermaid\nflowchart LR\n  A[开始] --> B[结束]\n```\n');
        return true;
      }
      if (name === 'pastePlain') {
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (viewRef.current === view) replaceSelection(view, text);
          })
          .catch(() => report('无法读取剪贴板，请按 Ctrl+Shift+V 粘贴纯文本。'));
        return true;
      }
      return false;
    };

    useImperativeHandle(ref, () => ({
      focus: () => viewRef.current?.focus(),
      insert: (text) => {
        if (viewRef.current) replaceSelection(viewRef.current, text);
      },
      wrap: (before, after) => {
        if (viewRef.current) wrapSelection(viewRef.current, before, after);
      },
      command: runCommand,
      scrollToLine: (line) => {
        const view = viewRef.current;
        if (!view) return;
        const position = view.state.doc.line(
          Math.max(1, Math.min(view.state.doc.lines, line)),
        ).from;
        view.dispatch({
          selection: { anchor: position },
          effects: EditorView.scrollIntoView(position, { y: 'center' }),
        });
        view.focus();
      },
      getCursor: () => viewRef.current?.state.selection.main.head ?? 0,
      getScroll: () => viewRef.current?.scrollDOM.scrollTop ?? 0,
      getView: () => viewRef.current,
    }));

    useEffect(() => {
      if (!host.current) return;
      let plainPaste = false;
      const view = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: propsRef.current.value,
          selection: {
            anchor: Math.min(propsRef.current.initialCursor ?? 0, propsRef.current.value.length),
          },
          extensions: [
            history(),
            drawSelection(),
            dropCursor(),
            rectangularSelection(),
            highlightActiveLine(),
            indentOnInput(),
            bracketMatching(),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            syntaxHighlighting(codeHighlighting),
            markdown({ codeLanguages: languages, addKeymap: false }),
            closeBrackets(),
            search({ top: true }),
            highlightSelectionMatches(),
            keymap.of([
              { key: 'Mod-b', run: () => runCommand('bold') },
              { key: 'Mod-i', run: () => runCommand('italic') },
              {
                key: 'Mod-Shift-v',
                run: () => {
                  plainPaste = true;
                  return false;
                },
              },
              { key: 'Tab', run: (editor) => nextSnippetField(editor) || acceptCompletion(editor) },
              ...completionKeymap,
              ...closeBracketsKeymap,
              ...markdownKeymap,
              ...defaultKeymap,
              ...historyKeymap,
              ...searchKeymap,
              ...foldKeymap,
              indentWithTab,
            ]),
            EditorView.inputHandler.of((editor, from, to, text) => {
              if (text !== '$' || inCode(editor.state, from)) return false;
              if (
                inMath(editor.state, from) &&
                editor.state.doc.sliceString(from, from + 1) === '$'
              ) {
                editor.dispatch({ selection: { anchor: from + 1 }, userEvent: 'select' });
                return true;
              }
              if (inMath(editor.state, from)) return false;
              editor.dispatch({
                changes: { from, to, insert: '$$' },
                selection: { anchor: from + 1 },
                userEvent: 'input.type',
              });
              return true;
            }),
            config.current.of(configuration()),
            features.current.of(featureExtensions()),
            livePreviewField,
            EditorView.contentAttributes.of({
              'aria-label': 'Markdown 正文编辑器',
              spellcheck: 'false',
              autocapitalize: 'off',
            }),
            EditorView.updateListener.of((update) => {
              for (const pending of pendingImages.current) {
                pending.from = update.changes.mapPos(pending.from, 1);
                pending.to = update.changes.mapPos(pending.to, 1);
              }
              if (update.docChanged) propsRef.current.onChange(update.state.doc.toString());
              if (update.selectionSet || update.docChanged) {
                propsRef.current.onCursor?.(update.state.selection.main.head);
                setFormula(activeMath(update.state));
              }
            }),
            EditorView.domEventHandlers({
              keydown(event) {
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v')
                  plainPaste = event.shiftKey;
                else plainPaste = false;
                return false;
              },
              scroll(_event, editor) {
                propsRef.current.onScroll?.(editor.scrollDOM.scrollTop);
              },
              paste(event, editor) {
                const data = event.clipboardData;
                if (!data) return false;
                const files = Array.from(data.files).filter((file) =>
                  file.type.startsWith('image/'),
                );
                if (files.length) {
                  event.preventDefault();
                  void insertImages(editor, files);
                  return true;
                }
                const plain = data.getData('text/plain');
                const html = data.getData('text/html');
                const usePlain = plainPaste;
                plainPaste = false;
                if (html && !usePlain) {
                  event.preventDefault();
                  replaceSelection(editor, richTextToMarkdown(html, plain));
                  return true;
                }
                return false;
              },
              dragover(event) {
                if (event.dataTransfer?.types.includes('Files')) {
                  event.preventDefault();
                  return true;
                }
                return false;
              },
              drop(event, editor) {
                const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
                  file.type.startsWith('image/'),
                );
                if (!files.length) return false;
                event.preventDefault();
                const position = editor.posAtCoords({ x: event.clientX, y: event.clientY });
                if (position !== null) editor.dispatch({ selection: { anchor: position } });
                void insertImages(editor, files);
                return true;
              },
            }),
          ],
        }),
      });
      viewRef.current = view;
      view.scrollDOM.scrollTop = propsRef.current.initialScroll ?? 0;
      setFormula(activeMath(view.state));
      return () => {
        viewRef.current = null;
        pendingImages.current = [];
        view.destroy();
      };
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view || view.state.doc.toString() === props.value) return;
      const from = view.state.selection.main.head;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: props.value },
        selection: { anchor: Math.min(from, props.value.length) },
        annotations: Transaction.addToHistory.of(false),
      });
    }, [props.value]);

    useEffect(() => {
      viewRef.current?.dispatch({ effects: config.current.reconfigure(configuration()) });
    }, [props.mode, props.settings.codeLineNumbers, props.settings.codeWrap, props.settings.codeFold, props.notePath,
      props.settings.appearance.codeFontSize, props.settings.appearance.codeLineHeight]);

    const snippetKey = JSON.stringify(props.settings.snippets);
    useEffect(() => {
      viewRef.current?.dispatch({ effects: features.current.reconfigure(featureExtensions()) });
    }, [props.mode, props.settings.codeLineNumbers, props.settings.codeWrap, props.settings.codeFold, snippetKey,
      props.settings.appearance.fontSize, props.settings.appearance.lineHeight, props.settings.appearance.contentWidth,
      props.settings.appearance.bodyFont, props.settings.appearance.codeFont,
      props.settings.appearance.codeFontSize, props.settings.appearance.codeLineHeight]);

    return (
      <div className={`markdown-editor ${props.mode === 'source' ? 'is-source' : 'is-live'}`}>
        <div className="editor-codemirror-host" ref={host} />
        {formula !== null && (
          <aside className="math-preview" aria-label="公式即时预览">
            <span>公式预览 · Ctrl+Space 补全 · Tab 参数</span>
            <div dangerouslySetInnerHTML={{ __html: mathHtml(formula, true) }} />
          </aside>
        )}
        {error && (
          <div role="alert" className="editor-error">
            <span>{error}</span>
            <button type="button" onClick={() => setError('')}>
              关闭
            </button>
          </div>
        )}
      </div>
    );
  },
);

export default MarkdownEditor;
export type { MarkdownEditorProps, MarkdownEditorHandle, EditorCommand } from './types';
