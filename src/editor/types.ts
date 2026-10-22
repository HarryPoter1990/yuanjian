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

export interface MarkdownEditorProps {
  value: string;
  onChange(value: string): void;
  mode: 'live' | 'source';
  settings: Settings;
  notePath?: string | null;
  initialCursor?: number;
  initialScroll?: number;
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
}
