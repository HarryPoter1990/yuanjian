import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NoteStore } from '../electron/storage/store';

describe('attachment cleanup treats unknown references conservatively', () => {
  let directory: string;
  let root: string;
  let store: NoteStore;
  let image: string;
  let note: string;
  let trash = vi.fn(async (_file: string) => {});
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'yuanjian-attachment-check-'));
    root = path.join(directory, 'notes');
    await mkdir(path.join(root, 'assets'), { recursive: true });
    image = path.join(root, 'assets', 'keep.png');
    note = path.join(root, 'note.md');
    await writeFile(image, 'generated image bytes');
    await writeFile(note, '普通正文');
    trash = vi.fn(async (_file: string) => {});
    store = new NoteStore(path.join(directory, 'profile'), { trash });
    await store.initialize();
    await store.approveDirectory(root);
    await store.saveSettings({ ...store.getSettings(), roots: [root] });
  });
  afterEach(async () => {
    await store.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  it.each([
    '<img src="assets/keep.png">',
    '<video poster="assets/keep.png"></video>',
    '---\ntags: [未完成\n---\n正文',
  ])(
    'marks uncertain resource syntax as protected and rejects direct cleanup: %j',
    async (source) => {
      await writeFile(note, source);
      const candidate = (await store.scanAttachments()).find((item) => item.path === image);
      expect(candidate?.uncertainReasons?.length).toBeGreaterThan(0);
      await expect(store.trashAttachments([image])).rejects.toThrow(/确认|不确定|引用/);
      expect(trash).not.toHaveBeenCalled();
      expect(await readFile(image, 'utf8')).toBe('generated image bytes');
    },
  );
  it('returns uncertainty instead of treating an unreadable note as zero references', async () => {
    await writeFile(note, Buffer.from([0xff, 0xfe, 0xff]));
    const candidate = (await store.scanAttachments()).find((item) => item.path === image);
    expect(candidate?.uncertainReasons?.join(' ')).toMatch(/读取|UTF|编码/);
    await expect(store.trashAttachments([image])).rejects.toThrow(/确认|不确定|引用/);
    expect(trash).not.toHaveBeenCalled();
  });
  it('does not mark literal HTML examples in code as unknown references', async () => {
    await writeFile(
      note,
      '```html\n<img src="assets/keep.png">\n```\n\n`<video poster="assets/keep.png">`',
    );
    const candidate = (await store.scanAttachments()).find((item) => item.path === image);
    expect(candidate).toBeDefined();
    expect(candidate?.uncertainReasons).toBeUndefined();
  });
  it('does not permanently block cleanup for an approved note already confirmed deleted', async () => {
    await store.approveFile(note);
    trash.mockImplementation(async (file: string) => rm(file));
    await store.trashFile(note);
    expect(store.getApprovedPaths().files).toContain(note);
    const candidate = (await store.scanAttachments()).find((item) => item.path === image);
    expect(candidate).toBeDefined();
    expect(candidate?.uncertainReasons).toBeUndefined();
    await store.trashAttachments([image]);
    expect(trash).toHaveBeenLastCalledWith(image);
  });
  it('still marks a note that disappears after tree collection as uncertain for this scan', async () => {
    const read = store.readNote.bind(store);
    vi.spyOn(store, 'readNote').mockImplementation(async (file) => {
      if (file === note) await rm(note, { force: true });
      return read(file);
    });
    const candidate = (await store.scanAttachments()).find((item) => item.path === image);
    expect(candidate?.uncertainReasons?.length).toBeGreaterThan(0);
    expect(trash).not.toHaveBeenCalled();
  });
  it('keeps references in a dirty session even when its approved source was deleted', async () => {
    await store.approveFile(note);
    const document = (await store.openFile(note))!;
    await store.saveSession({
      tabs: [
        {
          ...document,
          baseContent: document.content,
          dirty: true,
          content: '![未保存引用](assets/keep.png)',
          cursor: 0,
          scrollTop: 0,
          mode: 'live',
        },
      ],
      activeId: document.id,
    });
    await rm(note);
    expect((await store.scanAttachments()).map((candidate) => candidate.path)).not.toContain(image);
    await expect(store.trashAttachments([image])).rejects.toThrow(/引用|确认/);
    expect(trash).not.toHaveBeenCalled();
  });
  it('rechecks inside the write queue after an earlier queued edit adds a reference', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const edit = store.queue.run(async () => {
      await gate;
      await writeFile(note, '![新引用](assets/keep.png)');
    });
    const request = vi.spyOn(store, 'trashFile');
    const cleanup = store.trashAttachments([image]).then(
      () => ({ saved: true, error: '' }),
      (error: unknown) => ({ saved: false, error: String(error) }),
    );
    try {
      await vi.waitFor(() => expect(request).toHaveBeenCalled(), { timeout: 2000 });
    } finally {
      release();
    }
    await edit;
    const result = await cleanup;
    expect(result.saved).toBe(false);
    expect(result.error).toMatch(/引用|确认/);
    expect(trash).not.toHaveBeenCalled();
    expect(await readFile(image, 'utf8')).toBe('generated image bytes');
  });
});
