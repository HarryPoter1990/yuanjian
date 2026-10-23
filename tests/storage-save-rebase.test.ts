import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NoteStore } from '../electron/storage/store';
import { acceptSave, asTab } from '../src/ui/model';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
describe('accepting merged saves through the actual file service', () => {
  it.each(['\n', '\r\n'])(
    'keeps later input, external changes and the original %j file format',
    async (newline) => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-save-rebase-'));
      directories.push(directory);
      const file = path.join(directory, '笔记.md');
      const store = new NoteStore(path.join(directory, 'profile'));
      await store.initialize();
      await store.approveFile(file);
      const encode = (text: string) => `\ufeff${text.replace(/\n/g, newline)}`;
      await writeFile(file, encode('A\nmiddle\nB\n'));
      const initial = (await store.openFile(file))!;
      const submitted = 'Local1\nmiddle\nB\n';
      await writeFile(file, encode('A\nmiddle\nExternal\n'));
      const outcome = await store.saveFile({
        path: file,
        content: submitted,
        baseContent: initial.content,
        hash: initial.hash,
        title: initial.title,
      });
      expect(outcome.merged).toBe(true);
      const accepted = acceptSave(
        { ...asTab(initial), content: 'Local2\nmiddle\nB\n', dirty: true },
        submitted,
        outcome,
      );
      expect(accepted.conflict).toBeUndefined();
      expect(accepted.tab.content).toBe('Local2\nmiddle\nExternal\n');
      const result = await store.saveFile({
        path: file,
        content: accepted.tab.content,
        baseContent: accepted.tab.baseContent,
        hash: accepted.tab.hash,
        title: accepted.tab.title,
      });
      expect(result.status).toBe('saved');
      expect(await readFile(file, 'utf8')).toBe(encode('Local2\nmiddle\nExternal\n'));
      const clean = acceptSave(
        { ...accepted.tab, content: accepted.tab.content },
        accepted.tab.content,
        result,
      );
      expect(clean.tab.dirty).toBe(false);
      expect(clean.tab.content).toBe(result.note!.content);
      await store.dispose();
    },
  );
});
