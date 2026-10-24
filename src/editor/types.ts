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

/** A tab-lifetime snapshot only; never stores extensions, callbacks or an EditorView. */
export interface EditorSession {
  state: Record<string, unknown>;
  scrollTop: number;
}

export interface MarkdownEditorProps {
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
  onError?(message: string): void;
}

export interface MarkdownEditorHandle {
  focus(): void;
  insert(text: string): void;
  wrap(before: string, after?: string): void;
  command(name: EditorCommand): boolean;
  setHeading(level: HeadingLevel): void;
  getHeadingLevel(): HeadingLevel;
  scrollToLine(line: number): void;
  getCursor(): number;
  getScroll(): number;
  getView(): EditorView | null;
}

export interface RenderOptions {
  resolveAsset?: (path: string) => string;
  codeLineNumbers?: boolean;
  codeWrap?: boolean;
  codeFold?: boolean;
  codeFontSize?: number;
  codeLineHeight?: number;
}
