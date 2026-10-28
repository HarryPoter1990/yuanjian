import type { EditorView } from '@codemirror/view';
import type { Settings } from '../shared/types';
import type { NoteSyntaxOptions } from '../shared/note-syntax';
import type { NoteInsertionCommand } from './note-insertions';

export type EditorCommand =
  | NoteInsertionCommand
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
  noteRevision?: number;
  resolveAsset?: RenderOptions['resolveAsset'];
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
  onLink?(target: string, fromPath?: string): void;
  onImage?(file: File): Promise<string | null>;
  resolveAssetAsync?(reference: string, from?: string): Promise<string>;
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

export interface RenderOptions extends NoteSyntaxOptions {
  noteRevision?: number;
  prototypeSyntax?: boolean;
  resolveAsset?: (path: string, from?: string) => string;
  codeLineNumbers?: boolean;
  codeWrap?: boolean;
  codeFold?: boolean;
  codeFontSize?: number;
  codeLineHeight?: number;
}
