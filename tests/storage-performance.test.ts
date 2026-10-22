import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NoteStore } from '../electron/storage/store';

const sandboxes: string[] = [];
afterEach(async () => {
  for (const directory of sandboxes.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('long-note storage regression', () => {
  it.each(['LF', 'CRLF', 'mixed'] as const)(
    'saves the %s repeated-paragraph desktop fixture without a long backend stall',
    async (style) => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'qingjian-long-note-'));
      sandboxes.push(directory);
      const notes = path.join(directory, '笔记');
      await mkdir(notes);
      const paragraph =
        '这是用于实际编辑验收的长文段落，包含中文、English、标点和 `inlineCode`。正文保存原样，阅读和源码模式可以切换。\n\n';
      const original = Array.from(
        { length: 60 },
        (_, index) => `## 第 ${index + 1} 节\n\n${paragraph.repeat(40)}`,
      ).join('\n');
      const article =
        style === 'CRLF'
          ? original.replace(/\n/g, '\r\n')
          : style === 'mixed'
            ? original.replace('\n', '\r\n')
            : original;
      const file = path.join(notes, '长文验收.md');
      await writeFile(file, article);
      const store = new NoteStore(path.join(directory, 'data'));
      await store.initialize();
      await store.approveFile(file);
      try {
        const note = (await store.openFile(file))!;
        const appended = article + '长文追加完成。';
        const start = performance.now();
        const result = await store.saveFile({
          path: file,
          content: appended.replace(/\r\n/g, '\n'),
          baseContent: note.content,
          hash: note.hash,
          title: note.title,
        });
        const elapsed = performance.now() - start;
        console.info(
          `Long-note backend ${style}: ${article.split('\n').length} lines, ${Buffer.byteLength(article)} bytes, save ${elapsed.toFixed(1)} ms`,
        );
        expect(result.status).toBe('saved');
        expect(await readFile(file, 'utf8')).toBe(appended);
        expect(result.note?.content.endsWith('长文追加完成。')).toBe(true);
        expect(elapsed).toBeLessThan(5000);
      } finally {
        await store.dispose();
      }
    },
    60000,
  );
});
