import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
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
  isolateHistory,
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
  prevSnippetField,
} from '@codemirror/autocomplete';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { livePreviewField, previewConfig } from './live-preview';
import { inCode, inMath, isEscaped, mathCompletion } from './completion';
import { compoundClipboardToMarkdown, convertRichText } from './clipboard';
import { setHeading as applyHeading, toggleInlineFormat, toggleLineFormat } from './format';
import { compactSearch, openEditorSearch } from './search-panel';
import { readClipboardContent, type ClipboardPart } from './clipboard-reader';
import { EditorContextMenu, editorMenuAt, type EditorMenuState } from './context-menu';
import { markdownCopy, selectedCopy, writeCopy, type CopyContent } from './clipboard-output';
import { insertNoteSyntax, noteInsertions } from './note-insertions';
import { embeddedClipboardImages } from './clipboard-images';
import type {
  EditorCommand,
  EditorScrollAnchor,
  HeadingLevel,
  MarkdownEditorHandle,
  MarkdownEditorProps,
} from './types';
import 'katex/dist/katex.min.css';
import './editor.css';
import {
  prototypeEnter,
  prototypeDollarBackspace,
  prototypeListIndent,
} from './prototype-commands';
import { prototypeLinks } from './prototype-preview';
import { prototypeVertical, prototypeHorizontal } from './prototype-navigation';

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

function wrapSelection(view: EditorView, before: string, after = before, separate = false): void {
  const selection = view.state.selection.main;
  const selected = view.state.sliceDoc(selection.from, selection.to);
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: before + selected + after },
    selection: EditorSelection.range(selection.from + before.length, selection.to + before.length),
    userEvent: 'input.format',
    ...(separate ? { annotations: isolateHistory.of('full') } : {}),
  });
  view.focus();
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(incomingProps, ref) {
    const props = { ...incomingProps, prototypeEditing: incomingProps.prototypeEditing ?? true };
    const host = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const propsRef = useRef(props);
    propsRef.current = props;
    const config = useRef(new Compartment());
    const features = useRef(new Compartment());
    const [error, setError] = useState('');
    const [menu, setMenu] = useState<EditorMenuState | null>(null);
    const pendingImages = useRef<Array<{ from: number; to: number; conflicted: boolean }>>([]);
    const internalDrag = useRef(false);
    const plainClipboardIntent = useRef(false);
    const scrollRestore = useRef<{ top: number; anchor?: EditorScrollAnchor } | null>(null);
    const lastScroll = useRef<number | undefined>(undefined);
    const scrollMeasureKey = useRef({});
    const report = (message: string): void => {
      setError(message);
      propsRef.current.onError?.(message);
    };
    function copyContent(content: CopyContent): Promise<string[]> {
      const current = propsRef.current;
      return writeCopy(
        content,
        current.resolveAssetAsync ??
          ((reference) => window.notes.assetUrl(reference, current.notePath ?? undefined)),
      );
    }
    function copyEvent(event: React.ClipboardEvent<HTMLDivElement>, cut: boolean): void {
      const view = viewRef.current;
      if (
        !view ||
        (event.target instanceof Element && event.target.closest('input,textarea,button,select'))
      )
        return;
      const content = selectedCopy(view);
      if (!content) return;
      event.preventDefault();
      event.stopPropagation();
      const doc = view.state.doc,
        selection = view.state.selection;
      void copyContent(content)
        .then((notices) => {
          if (viewRef.current !== view) return;
          if (cut) {
            if (!content.range) notices.push('该渲染选区无法安全对应源码，已复制，本次未剪切。');
            else if (!view.state.doc.eq(doc) || !view.state.selection.eq(selection))
              notices.push('正文或选区已变化，已复制原文字，本次未剪切。');
            else view.dispatch({ changes: content.range, userEvent: 'delete.cut' });
          }
          if (notices.length) report(notices.join('\n'));
        })
        .catch((error) => {
          if (viewRef.current === view)
            report(`复制未完成：${error instanceof Error ? error.message : String(error)}`);
        });
    }

    function getScrollAnchor(view: EditorView): EditorScrollAnchor {
      const snapshot = view.scrollSnapshot().value;
      return { from: snapshot.range.head, offset: snapshot.yMargin, left: snapshot.xMargin };
    }

    function restoreScroll(view: EditorView, top: number, anchor?: EditorScrollAnchor): void {
      if (!top && !anchor && !view.scrollDOM.scrollTop) {
        scrollRestore.current = null;
        return;
      }
      const target = { top: Math.max(0, top), anchor };
      scrollRestore.current = target;
      // Give CM the distant range before asking it for measured block geometry.
      if (anchor)
        view.dispatch({
          effects: EditorView.scrollIntoView(Math.min(anchor.from, view.state.doc.length), {
            y: 'start',
            yMargin: anchor.offset,
          }),
        });
      view.scrollDOM.scrollTop = target.top;
      let previousHeight = -1;
      const measure = (): void => {
        if (viewRef.current !== view || scrollRestore.current !== target) return;
        view.requestMeasure({
          key: scrollMeasureKey.current,
          read: () => {
            const scroller = view.scrollDOM;
            // The saved pixel is authoritative for the unchanged document. The
            // anchor above renders its distant region before this measurement;
            // estimated block heights must not silently redefine that pixel.
            const wanted = target.top;
            return {
              top: Math.max(0, Math.min(wanted, scroller.scrollHeight - scroller.clientHeight)),
              height: view.contentHeight,
              actual: scroller.scrollTop,
            };
          },
          write: (measured) => {
            if (viewRef.current !== view || scrollRestore.current !== target) return;
            view.scrollDOM.scrollTop = measured.top;
            lastScroll.current = view.scrollDOM.scrollTop;
            if (anchor) view.scrollDOM.scrollLeft = anchor.left;
            const stable =
              previousHeight === measured.height && Math.abs(measured.actual - measured.top) < 1;
            previousHeight = measured.height;
            if (stable) scrollRestore.current = null;
            // Re-measure after CM finishes this layout, rather than chasing it with timers.
            else queueMicrotask(measure);
          },
        });
      };
      measure();
    }

    function configuration(): Extension {
      const current = propsRef.current;
      return previewConfig.of({
        prototypeEditing: current.prototypeEditing,
        prototypeSyntax: current.prototypeEditing,
        resolveNote: current.resolveNote,
        noteRevision: current.noteRevision,
        resolveAsset: current.resolveAsset,
        notePath: current.notePath ?? undefined,
        mode: current.mode,
        codeLineNumbers: current.settings.codeLineNumbers,
        codeWrap: current.settings.codeWrap,
        codeFold: current.settings.codeFold,
        codeFontSize: current.settings.appearance.codeFontSize ?? 16,
        codeLineHeight: current.settings.appearance.codeLineHeight ?? 1.6,
        resolveAssetAsync: (reference, from) =>
          propsRef.current.resolveAssetAsync
            ? from
              ? propsRef.current.resolveAssetAsync(reference, from)
              : propsRef.current.resolveAssetAsync(reference)
            : window.notes.assetUrl(reference, from ?? propsRef.current.notePath ?? undefined),
        onLink: (target, fromPath) =>
          fromPath
            ? propsRef.current.onLink?.(target, fromPath)
            : propsRef.current.onLink?.(target),
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
        current.prototypeEditing ? Prec.highest(prototypeLinks) : [],
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
        mathCompletion(current.settings.snippets, current.prototypeEditing),
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

    async function insertPending(
      view: EditorView,
      resolve: () => Promise<{ markdown: string; notices: string[] }>,
    ): Promise<void> {
      const selection = view.state.selection.main;
      const bookmark = { from: selection.from, to: selection.to, conflicted: false };
      pendingImages.current.push(bookmark);
      try {
        const result = await resolve();
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
              '等待粘贴期间原选区发生变化，已保留原文字与新输入，将粘贴内容放到该区域之后。',
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

    async function importForView(view: EditorView, file: File): Promise<string | null> {
      if (viewRef.current !== view) return null;
      if (!propsRef.current.onImage) throw new Error('请先为文档选择保存位置，再添加图片');
      return propsRef.current.onImage(file);
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
      await insertPending(view, () =>
        compoundClipboardToMarkdown(rich?.html ?? '', rich?.plain ?? '', files, (file) =>
          importForView(view, file),
        ),
      );
    }

    async function pasteClipboard(view: EditorView, plainOnly = false): Promise<void> {
      const position = view.state.selection.main.head;
      const usePlain = plainOnly || inCode(view.state, position) || inMath(view.state, position);
      await insertPending(view, async () => {
        const content = await readClipboardContent(navigator.clipboard, usePlain);
        if (viewRef.current !== view) return { markdown: '', notices: [] };
        const results = [];
        for (const part of content.items) {
          if (viewRef.current !== view) return { markdown: '', notices: [] };
          results.push(await convertPart(view, part));
        }
        return {
          markdown: results
            .map((result) => result.markdown)
            .filter(Boolean)
            .join('\n\n'),
          notices: [...content.notices, ...results.flatMap((result) => result.notices)],
        };
      });
    }
    async function convertPart(view: EditorView, original: ClipboardPart) {
      const { part, notices } = embeddedClipboardImages(original);
      const result =
        part.html || part.files.length
          ? await compoundClipboardToMarkdown(part.html, part.plain, part.files, (file) =>
              importForView(view, file),
            )
          : { markdown: part.plain, notices: [] as string[] };
      return { markdown: result.markdown, notices: [...notices, ...result.notices] };
    }
    async function pasteIntoCell(
      input: HTMLInputElement | HTMLTextAreaElement,
      plainOnly: boolean,
      eventPart?: ClipboardPart,
    ): Promise<void> {
      const view = viewRef.current;
      if (!view) return;
      const source = view.state.doc,
        value = input.value;
      const selectionStart = input.selectionStart,
        selectionEnd = input.selectionEnd;
      const content = eventPart
        ? { items: [eventPart], notices: [] as string[] }
        : await readClipboardContent(navigator.clipboard, plainOnly);
      const parts: ClipboardPart[] = [],
        notices = [...content.notices];
      for (const part of content.items) {
        if (part.files.length || /<img\b[^>]*\bsrc\s*=\s*["']?data:/i.test(part.html)) {
          const converted = await convertPart(view, part);
          notices.push(...converted.notices);
          parts.push({
            html: markdownCopy(converted.markdown).html,
            plain: converted.markdown,
            files: [],
          });
        } else parts.push(part);
      }
      if (viewRef.current !== view || !input.isConnected) return;
      if (
        !view.state.doc.eq(source) ||
        input.value !== value ||
        input.selectionStart !== selectionStart ||
        input.selectionEnd !== selectionEnd
      ) {
        report('等待粘贴期间正文、单元格或选区已变化，未覆盖新输入，请重新粘贴。');
        return;
      }
      const plain = parts
        .map((part) => part.plain || (part.html ? convertRichText(part.html).markdown : ''))
        .join('\n');
      const html =
        parts.length === 1
          ? parts[0].html
          : parts
              .map((part) => {
                if (part.html) return part.html;
                const paragraph = document.createElement('p');
                for (const [index, line] of part.plain.split('\n').entries()) {
                  if (index) paragraph.append(document.createElement('br'));
                  paragraph.append(document.createTextNode(line));
                }
                return paragraph.outerHTML;
              })
              .join('\n');
      input.dispatchEvent(
        new CustomEvent('yuanjian:paste-cell', {
          bubbles: true,
          detail: { html, plain, plainOnly },
        }),
      );
      if (notices.length) report(notices.join('\n'));
    }

    const runCommand = (name: EditorCommand): boolean => {
      const view = viewRef.current;
      if (!view) return false;
      if (name === 'undo') return undo(view);
      if (noteInsertions.some((entry) => entry.command === name)) {
        const changed = insertNoteSyntax(view, name);
        if (!changed) report('请在正文中选择单行文字后应用此格式；代码、公式与跨行选区保持原样。');
        return changed;
      }
      if (name === 'redo') return redo(view);
      if (name === 'find' || name === 'replace') return openEditorSearch(view, name === 'replace');
      if (name === 'bold' || name === 'italic') {
        toggleInlineFormat(view, name);
        return true;
      }
      if (name === 'link') {
        wrapSelection(view, '[', '](链接地址)', propsRef.current.prototypeEditing);
        return true;
      }
      if (name === 'heading') {
        applyHeading(view, 2, propsRef.current.prototypeEditing);
        return true;
      }
      if (name === 'list' || name === 'task' || name === 'quote') {
        toggleLineFormat(view, name, propsRef.current.prototypeEditing);
        return true;
      }
      if (name === 'code') {
        wrapSelection(view, '\n```\n', '\n```\n', propsRef.current.prototypeEditing);
        return true;
      }
      if (name === 'math') {
        wrapSelection(view, '$', '$', propsRef.current.prototypeEditing);
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
        void pasteClipboard(view, true);
        return true;
      }
      return false;
    };

    const setHeading = (level: HeadingLevel): void => {
      const view = viewRef.current;
      if (view) applyHeading(view, level, propsRef.current.prototypeEditing);
    };

    useImperativeHandle(ref, () => ({
      focus: () => viewRef.current?.focus(),
      insert: (text) => {
        if (viewRef.current) replaceSelection(viewRef.current, text);
      },
      insertFiles: async (files, point) => {
        const view = viewRef.current;
        if (!view) return;
        const position = point && view.posAtCoords(point);
        if (typeof position === 'number') view.dispatch({ selection: { anchor: position } });
        await insertImages(view, files);
      },
      wrap: (before, after) => {
        if (viewRef.current)
          wrapSelection(viewRef.current, before, after, propsRef.current.prototypeEditing);
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
        scrollRestore.current = null;
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
      getScroll: () => scrollRestore.current?.top ?? viewRef.current?.scrollDOM.scrollTop ?? 0,
      getScrollAnchor: () => {
        const view = viewRef.current;
        return view ? (scrollRestore.current?.anchor ?? getScrollAnchor(view)) : undefined;
      },
      restorePosition: (cursor, top, anchor) => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          selection: { anchor: Math.max(0, Math.min(cursor, view.state.doc.length)) },
        });
        view.focus();
        restoreScroll(view, top, anchor);
      },
      getView: () => viewRef.current,
    }));

    useLayoutEffect(() => {
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
              ...(propsRef.current.prototypeEditing
                ? [
                    {
                      key: 'ArrowUp',
                      run: (view: EditorView) => prototypeVertical(view, false),
                      shift: (view: EditorView) => prototypeVertical(view, false, true),
                    },
                    {
                      key: 'ArrowDown',
                      run: (view: EditorView) => prototypeVertical(view, true),
                      shift: (view: EditorView) => prototypeVertical(view, true, true),
                    },
                    {
                      key: 'ArrowLeft',
                      run: (view: EditorView) => prototypeHorizontal(view, false),
                    },
                    {
                      key: 'ArrowRight',
                      run: (view: EditorView) => prototypeHorizontal(view, true),
                    },
                    { key: 'Enter', run: prototypeEnter },
                    { key: 'Backspace', run: prototypeDollarBackspace },
                    {
                      key: 'Tab',
                      run: (view: EditorView) =>
                        nextSnippetField(view) ||
                        acceptCompletion(view) ||
                        prototypeListIndent(view),
                    },
                    {
                      key: 'Shift-Tab',
                      run: (view: EditorView) =>
                        prevSnippetField(view) || prototypeListIndent(view, true),
                    },
                  ]
                : []),
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
              if (update.docChanged || update.selectionSet) scrollRestore.current = null;
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
                scrollRestore.current = null;
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v')
                  plainPaste = event.shiftKey;
                else plainPaste = false;
                return false;
              },
              scroll(_event, editor) {
                lastScroll.current = editor.scrollDOM.scrollTop;
                propsRef.current.onScroll?.(editor.scrollDOM.scrollTop);
              },
              paste(event, editor) {
                const data = event.clipboardData;
                if (!data) return false;
                const plain = data.getData('text/plain');
                const html = data.getData('text/html');
                const position = editor.state.selection.main.head;
                const usePlain =
                  plainPaste ||
                  plainClipboardIntent.current ||
                  inCode(editor.state, position) ||
                  inMath(editor.state, position);
                plainPaste = false;
                plainClipboardIntent.current = false;
                if (usePlain) {
                  event.preventDefault();
                  replaceSelection(editor, plain);
                  if (!plain && (html || data.files.length))
                    report('当前代码或公式位置仅接受纯文字，未插入图片或富文本。');
                  return true;
                }
                const files = Array.from(data.files).filter((file) =>
                  file.type.startsWith('image/'),
                );
                if (files.length || html) {
                  event.preventDefault();
                  void insertPending(editor, () => convertPart(editor, { html, plain, files }));
                  return true;
                }
                return false;
              },
              dragover(event) {
                if (
                  event.dataTransfer?.types.includes('Files') ||
                  (!internalDrag.current && event.dataTransfer?.types.includes('text/html'))
                ) {
                  event.preventDefault();
                  return true;
                }
                return false;
              },
              drop(event, editor) {
                if (internalDrag.current) return false;
                const allFiles = Array.from(event.dataTransfer?.files ?? []);
                const files = allFiles.filter((file) => file.type.startsWith('image/'));
                const html = event.dataTransfer?.getData('text/html') ?? '',
                  plain = event.dataTransfer?.getData('text/plain') ?? '';
                if (!allFiles.length && !html) return false;
                event.preventDefault();
                const position = editor.posAtCoords({ x: event.clientX, y: event.clientY });
                if (position !== null) editor.dispatch({ selection: { anchor: position } });
                if (allFiles.length) {
                  if (files.length) void insertImages(editor, files);
                  if (files.length !== allFiles.length)
                    report('非图片文件未插入正文，请通过打开或导入文件入口处理。');
                } else if (
                  inCode(editor.state, editor.state.selection.main.head) ||
                  inMath(editor.state, editor.state.selection.main.head)
                )
                  replaceSelection(editor, plain);
                else
                  void insertPending(editor, () => convertPart(editor, { html, plain, files: [] }));
                return true;
              },
            }),
          ],
        }),
      });
      viewRef.current = view;
      const copyTable = (event: Event): void => {
        const detail: unknown = event instanceof CustomEvent ? event.detail : null;
        if (
          !detail ||
          typeof detail !== 'object' ||
          !('from' in detail) ||
          !('to' in detail) ||
          !('source' in detail)
        )
          return;
        const { from, to, source } = detail;
        if (
          typeof from !== 'number' ||
          typeof to !== 'number' ||
          typeof source !== 'string' ||
          !Number.isInteger(from) ||
          !Number.isInteger(to) ||
          from < 0 ||
          to > view.state.doc.length ||
          to < from ||
          view.state.sliceDoc(from, to) !== source
        ) {
          report('表格已变化，请重新复制。');
          return;
        }
        void copyContent(markdownCopy(source, view.state.facet(previewConfig)))
          .then((notices) => {
            if (viewRef.current === view && notices.length) report(notices.join('\n'));
          })
          .catch((error) => {
            if (viewRef.current === view)
              report(`复制表格未完成：${error instanceof Error ? error.message : String(error)}`);
          });
      };
      const editorNotice = (event: Event): void => {
        const detail: unknown = event instanceof CustomEvent ? event.detail : null;
        if (
          detail &&
          typeof detail === 'object' &&
          'message' in detail &&
          typeof detail.message === 'string'
        )
          report(detail.message);
      };
      view.dom.addEventListener('yuanjian:copy-table', copyTable);
      view.dom.addEventListener('yuanjian:editor-notice', editorNotice);
      const cancelRestore = (): void => {
        scrollRestore.current = null;
      };
      for (const event of ['wheel', 'touchstart', 'mousedown'])
        view.scrollDOM.addEventListener(event, cancelRestore, { capture: true, passive: true });
      restoreScroll(
        view,
        session && restored ? session.scrollTop : (propsRef.current.initialScroll ?? 0),
        session && restored ? session.scrollAnchor : undefined,
      );
      return () => {
        propsRef.current.onSessionSave?.({
          state: view.state.toJSON({ history: historyField }),
          scrollTop: scrollRestore.current?.top ?? lastScroll.current ?? view.scrollDOM.scrollTop,
          scrollAnchor: scrollRestore.current?.anchor ?? getScrollAnchor(view),
        });
        scrollRestore.current = null;
        view.dom.removeEventListener('yuanjian:copy-table', copyTable);
        view.dom.removeEventListener('yuanjian:editor-notice', editorNotice);
        for (const event of ['wheel', 'touchstart', 'mousedown'])
          view.scrollDOM.removeEventListener(event, cancelRestore, true);
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
      props.prototypeEditing,
      props.resolveNote,
      props.noteRevision,
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
      <div
        className={`markdown-editor ${props.mode === 'source' ? 'is-source' : 'is-live'}`}
        onCopyCapture={(event) => copyEvent(event, false)}
        onCutCapture={(event) => copyEvent(event, true)}
        onKeyDownCapture={(event) => {
          plainClipboardIntent.current =
            (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v';
        }}
        onDragStartCapture={(event) => {
          internalDrag.current =
            event.target instanceof Node &&
            Boolean(viewRef.current?.contentDOM.contains(event.target));
        }}
        onDragEndCapture={() => {
          internalDrag.current = false;
        }}
        onPasteCapture={(event) => {
          const input = event.target;
          if (
            !(input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) ||
            !input.closest('.markdown-table-widget')
          )
            return;
          const usePlain = plainClipboardIntent.current;
          plainClipboardIntent.current = false;
          if (usePlain) return;
          const html = event.clipboardData.getData('text/html'),
            files = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'));
          if (!files.length && !/<img\b[^>]*\bsrc\s*=\s*["']?data:/i.test(html)) return;
          event.preventDefault();
          event.stopPropagation();
          void pasteIntoCell(input, false, {
            html,
            plain: event.clipboardData.getData('text/plain'),
            files,
          }).catch((error) =>
            report(`表格粘贴未完成：${error instanceof Error ? error.message : String(error)}`),
          );
        }}
        onContextMenu={(event) => {
          const view = viewRef.current;
          const next = view && editorMenuAt(view, event.nativeEvent);
          if (next) {
            event.preventDefault();
            setMenu(next);
          }
        }}
      >
        <div className="editor-codemirror-host" ref={host} />
        {menu && viewRef.current && (
          <EditorContextMenu
            state={menu}
            view={viewRef.current}
            onClose={() => setMenu(null)}
            onError={report}
            copyContent={copyContent}
            pasteCell={pasteIntoCell}
            pastePlain={() => {
              const view = viewRef.current;
              if (view) void pasteClipboard(view, true);
            }}
            pasteRich={() => {
              const view = viewRef.current;
              if (view) void pasteClipboard(view);
            }}
          />
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
