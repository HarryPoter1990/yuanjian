import type { EditorView } from '@codemirror/view';
import type { Settings } from '../shared/types';

export type EditorCommand =
  | 'undo'
  | 'redo'
  | 'find'
  | 'replace'
  | 'bold'
  | 'italic'
  | 'heading'
  | 'list'
  | 'task'
  | 'quote'
  | 'code'
  | 'math'
  | 'table'
  | 'link'
  | 'diagram'
  | 'pastePlain';

export type HeadingLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface EditorScrollAnchor {
  from: number;
  offset: number;
  left: number;
}

/** A tab-lifetime snapshot only; never stores extensions, callbacks or an EditorView. */
export interface EditorSession {
  state: Record<string, unknown>;
  scrollTop: number;
  scrollAnchor?: EditorScrollAnchor;
}

export interface MarkdownEditorProps {
  prototypeEditing?: boolean;
  resolveNote?: RenderOptions['resolveNote'];
  value: string;
  onChange(value: string): void;
  mode: 'live' | 'source';
  settings: Settings;
  notePath?: string | null;
  initialCursor?: number;
  initialScroll?: number;
  initialSession?: EditorSession;
  onSessionSave?(session: EditorSession): void;
  onCursor?(position: number): void;
  onScroll?(top: number): void;
  onLink?(target: string): void;
  onImage?(file: File): Promise<string | null>;
  resolveAssetAsync?(reference: string): Promise<string>;
  onError?(message: string): void;
}

export interface MarkdownEditorHandle {
  focus(): void;
  insert(text: string): void;
  insertFiles(files: File[], point?: { x: number; y: number }): Promise<void>;
  wrap(before: string, after?: string): void;
  command(name: EditorCommand): boolean;
  setHeading(level: HeadingLevel): void;
  getHeadingLevel(): HeadingLevel;
  scrollToLine(line: number): void;
  getCursor(): number;
  getScroll(): number;
  getScrollAnchor(): EditorScrollAnchor | undefined;
  restorePosition(cursor: number, scrollTop: number, scrollAnchor?: EditorScrollAnchor): void;
  getView(): EditorView | null;
}

export interface RenderOptions {
  prototypeSyntax?: boolean;
  notePath?: string;
  resolveNote?: (
    reference: string,
    from?: string,
  ) => { path: string; source: string } | { error: string };
  embedStack?: readonly string[];
  exportMode?: 'html' | 'pdf';
  resolveAsset?: (path: string) => string;
  codeLineNumbers?: boolean;
  codeWrap?: boolean;
  codeFold?: boolean;
  codeFontSize?: number;
  codeLineHeight?: number;
}
