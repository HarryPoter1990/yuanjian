import type { OperationProgress } from '../../src/shared/types';

export interface StoreAdapters {
  openFile?: () => Promise<string | null>;
  saveFile?: (suggested: string) => Promise<string | null>;
  selectDirectory?: () => Promise<string | null>;
  trash?: (file: string) => Promise<void>;
  progress?: (progress: OperationProgress) => void;
  changed?: (paths: string[]) => void;
  now?: () => number;
  fetch?: typeof fetch;
}

export const imageExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.avif',
  '.bmp',
  '.ico',
]);
export const noteExtensions = new Set(['.md', '.markdown', '.mdown', '.mkd']);
