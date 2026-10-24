import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Compartment,
  EditorSelection,
  EditorState,
  Text,
  Transaction,
  type Extension,
  type EditorStateConfig,
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
  historyField,
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
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { livePreviewField, previewConfig } from './live-preview';
import { inCode, inMath, isEscaped, mathCompletion } from './completion';
import { compoundClipboardToMarkdown, richTextToMarkdown } from './clipboard';
import { setHeading as applyHeading, toggleInlineFormat, toggleLineFormat } from './format';
import { compactSearch, openEditorSearch } from './search-panel';
import type {
  EditorCommand,
  HeadingLevel,
  MarkdownEditorHandle,
  MarkdownEditorProps,
} from './types';
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
    const [error, setError] = useState('');
    const pendingImages = useRef<Array<{ from: number; to: number; conflicted: boolean }>>([]);
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

    function codeLineBoundary(view: EditorView, end: boolean, extend = false): boolean {
      const current = propsRef.current;
      if (current.mode !== 'live' || current.settings.codeWrap) return false;
      const blocks = view.state.field(livePreviewField).blocks;
      if (
        !view.state.selection.ranges.every((range) =>
          blocks.some(
            (block) => block.type === 'fence' && range.head >= block.from && range.head <= block.to,
          ),
        )
      )
        return false;
      const ranges = view.state.selection.ranges.map((range) => {
        if (extend && range.undirectional && range.head >= range.anchor !== end)
          range = EditorSelection.range(range.head, range.anchor);
        const line = view.state.doc.lineAt(range.head);
        const head = end ? line.to : line.from;
        return extend ? EditorSelection.range(range.anchor, head) : EditorSelection.cursor(head);
      });
      view.dispatch({
        selection: EditorSelection.create(ranges, view.state.selection.mainIndex),
        scrollIntoView: true,
        userEvent: 'select',
      });
      return true;
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
        current.mode === 'live' || current.settings.codeWrap ? EditorView.lineWrapping : [],
        mathCompletion(current.settings.snippets),
        EditorView.theme({
          '&': {
            fontSize: `${current.mode === 'source' ? (current.settings.appearance.codeFontSize ?? 16) : current.settings.appearance.fontSize}px`,
            '--code-font-size': `${current.settings.appearance.codeFontSize ?? 16}px`,
            '--code-line-height': String(current.settings.appearance.codeLineHeight ?? 1.6),
          },
          '.cm-content': {
            fontFamily:
              current.mode === 'source'
                ? current.settings.appearance.codeFont
                : current.settings.appearance.bodyFont,
            lineHeight: String(
              current.mode === 'source'
                ? (current.settings.appearance.codeLineHeight ?? 1.6)
                : current.settings.appearance.lineHeight,
            ),
            maxWidth: `calc(${current.settings.appearance.contentWidth}px + 56px)`,
          },
          '.cm-gutters': { fontFamily: current.settings.appearance.codeFont },
        }),
      ];
    }

    async function insertImages(
      view: EditorView,
      files: File[],
      rich?: { html: string; plain: string },
    ): Promise<void> {
      if (!propsRef.current.onImage && !rich) {
        report('请先为文档选择保存位置，再添加图片。');
        return;
      }
      const selection = view.state.selection.main;
      const bookmark = { from: selection.from, to: selection.to, conflicted: false };
      pendingImages.current.push(bookmark);
      try {
        const result = await compoundClipboardToMarkdown(
          rich?.html ?? '',
          rich?.plain ?? '',
          files,
          async (file) => {
            if (viewRef.current !== view) return null;
            if (!propsRef.current.onImage) throw new Error('请先为文档选择保存位置，再添加图片');
            return propsRef.current.onImage(file);
          },
        );
        if (viewRef.current !== view) return;
        pendingImages.current = pendingImages.current.filter((value) => value !== bookmark);
        if (result.markdown) {
          const from = bookmark.conflicted ? bookmark.to : bookmark.from;
          view.dispatch({
            changes: { from, to: bookmark.to, insert: result.markdown },
            selection: { anchor: from + result.markdown.length },
            userEvent: 'input.paste',
          });
          if (bookmark.conflicted)
            result.notices.unshift(
              '等待图片期间原选区发生变化，已保留原文字与新输入，将粘贴内容放到该区域之后。',
            );
        }
        if (result.notices.length) report(result.notices.join('\n'));
      } catch (reason) {
        if (viewRef.current === view)
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
      if (name === 'find' || name === 'replace') return openEditorSearch(view, name === 'replace');
      if (name === 'bold' || name === 'italic') {
        toggleInlineFormat(view, name);
        return true;
      }
      if (name === 'link') {
        wrapSelection(view, '[', '](链接地址)');
        return true;
      }
      if (name === 'heading') {
        applyHeading(view, 2);
        return true;
      }
      if (name === 'list' || name === 'task' || name === 'quote') {
        toggleLineFormat(view, name);
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

    const setHeading = (level: HeadingLevel): void => {
      const view = viewRef.current;
      if (view) applyHeading(view, level);
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
      setHeading,
      getHeadingLevel: () => {
        const view = viewRef.current;
        if (!view) return 0;
        const match = /^ {0,3}(#{1,6})(?:[ \t]+|$)/.exec(
          view.state.doc.lineAt(view.state.selection.main.head).text,
        );
        return (match?.[1].length ?? 0) as HeadingLevel;
      },
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
      const initialDoc = Text.of(propsRef.current.value.split(/\r\n?|\n/));
      const session = propsRef.current.initialSession;
      let restored = false;
      const restoreState = (configuration: EditorStateConfig): EditorState => {
        if (session) {
          if (
            typeof session.state.doc === 'string' &&
            initialDoc.eq(Text.of(session.state.doc.split(/\r\n?|\n/)))
          ) {
            try {
              const state = EditorState.fromJSON(
                session.state,
                { extensions: configuration.extensions },
                { history: historyField },
              );
              restored = true;
              return state;
            } catch {
              report('旧编辑会话无法恢复，当前正文已保留，撤销记录已重新开始。');
            }
          } else report('正文已发生变化，当前正文已保留，旧撤销记录已失效。');
        }
        return EditorState.create(configuration);
      };
      const view = new EditorView({
        parent: host.current,
        state: restoreState({
          doc: initialDoc,
          selection: { anchor: Math.min(propsRef.current.initialCursor ?? 0, initialDoc.length) },
          extensions: [
            history(),
            drawSelection({ cursorBlinkRate: 1060 }),
            dropCursor(),
            rectangularSelection(),
            highlightActiveLine(),
            indentOnInput(),
            bracketMatching(),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            syntaxHighlighting(codeHighlighting),
            markdown({ codeLanguages: languages, addKeymap: false }),
            closeBrackets(),
            compactSearch,
            highlightSelectionMatches(),
            keymap.of([
              {
                key: 'Home',
                run: (view) => codeLineBoundary(view, false),
                shift: (view) => codeLineBoundary(view, false, true),
              },
              {
                key: 'End',
                run: (view) => codeLineBoundary(view, true),
                shift: (view) => codeLineBoundary(view, true, true),
              },
              { key: 'Mod-b', run: () => runCommand('bold') },
              { key: 'Mod-i', run: () => runCommand('italic') },
              { key: 'Mod-f', run: (view) => openEditorSearch(view), scope: 'editor search-panel' },
              {
                key: 'Mod-h',
                run: (view) => openEditorSearch(view, true),
                scope: 'editor search-panel',
              },
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
              if (text !== '$' || from !== to || inCode(editor.state, from)) return false;
              const line = editor.state.doc.lineAt(from);
              if (isEscaped(line.text, from - line.from)) return false;
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
                const { from, to } = pending;
                update.changes.iterChangedRanges((start, end) => {
                  if (start === end ? start > from && start < to : start < to && end > from)
                    pending.conflicted = true;
                });
                pending.from = update.changes.mapPos(from, 1);
                pending.to = Math.max(
                  pending.from,
                  update.changes.mapPos(to, pending.conflicted || from === to ? 1 : -1),
                );
              }
              if (update.docChanged) propsRef.current.onChange(update.state.doc.toString());
              if (update.selectionSet || update.docChanged) {
                propsRef.current.onCursor?.(update.state.selection.main.head);
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
                const plain = data.getData('text/plain');
                const html = data.getData('text/html');
                const usePlain = plainPaste;
                plainPaste = false;
                if (usePlain) return false;
                const files = Array.from(data.files).filter((file) =>
                  file.type.startsWith('image/'),
                );
                if (files.length) {
                  event.preventDefault();
                  void insertImages(editor, files, html || plain ? { html, plain } : undefined);
                  return true;
                }
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
      view.scrollDOM.scrollTop =
        session && restored ? session.scrollTop : (propsRef.current.initialScroll ?? 0);
      return () => {
        propsRef.current.onSessionSave?.({
          state: view.state.toJSON({ history: historyField }),
          scrollTop: view.scrollDOM.scrollTop,
        });
        viewRef.current = null;
        pendingImages.current = [];
        view.destroy();
      };
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const content = view.state.toText(props.value);
      if (view.state.doc.eq(content)) return;
      const from = view.state.selection.main.head;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        selection: { anchor: Math.min(from, content.length) },
        annotations: Transaction.addToHistory.of(false),
      });
    }, [props.value]);

    useEffect(() => {
      viewRef.current?.dispatch({ effects: config.current.reconfigure(configuration()) });
    }, [
      props.mode,
      props.settings.codeLineNumbers,
      props.settings.codeWrap,
      props.settings.codeFold,
      props.notePath,
      props.settings.appearance.codeFontSize,
      props.settings.appearance.codeLineHeight,
    ]);

    const snippetKey = JSON.stringify(props.settings.snippets);
    useEffect(() => {
      viewRef.current?.dispatch({ effects: features.current.reconfigure(featureExtensions()) });
    }, [
      props.mode,
      props.settings.codeLineNumbers,
      props.settings.codeWrap,
      props.settings.codeFold,
      snippetKey,
      props.settings.appearance.fontSize,
      props.settings.appearance.lineHeight,
      props.settings.appearance.contentWidth,
      props.settings.appearance.bodyFont,
      props.settings.appearance.codeFont,
      props.settings.appearance.codeFontSize,
      props.settings.appearance.codeLineHeight,
    ]);

    return (
      <div className={`markdown-editor ${props.mode === 'source' ? 'is-source' : 'is-live'}`}>
        <div className="editor-codemirror-host" ref={host} />
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
