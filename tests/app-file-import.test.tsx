// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ImportPanel } from '../src/components/ImportPanel';
import { defaultSettings } from '../src/shared/defaults';
import { asTab } from '../src/ui/model';
import type { ImportSource, SaveOutcome, SaveRequest, TransferItem } from '../src/shared/types';

vi.mock('virtual:yuanjian-graph', () => ({ loadGraphModule: vi.fn() }));
let host: HTMLDivElement, root: Root;
const alpha = asTab({
  id: 'A',
  path: 'D:/generated/Alpha.md',
  title: 'Alpha',
  content: '原文 Alpha',
  hash: 'a',
  modifiedAt: 1,
});
const beta = asTab({
  id: 'B',
  path: 'D:/generated/Beta.md',
  title: 'Beta',
  content: '原文 Beta',
  hash: 'b',
  modifiedAt: 1,
});
const gamma = {
  ...alpha,
  id: 'C',
  path: 'D:/generated/Gamma.md',
  title: 'Gamma',
  content: '文件 Gamma',
};
const table: ImportSource = {
  id: 'source-csv',
  path: 'D:/generated/表.csv',
  name: '表.csv',
  format: 'csv',
  encoding: 'utf-8',
  text: '姓名;说明\n甲;"一,二\n三"',
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, 1, 20),
  });
  Object.defineProperty(File.prototype, 'arrayBuffer', {
    configurable: true,
    value: async () => new Uint8Array([1, 2, 3]).buffer,
  });
  window.matchMedia = (media) => ({
    matches: false,
    media,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount(overrides: Record<string, unknown> = {}) {
  Reflect.set(window, 'notes', {
    bootstrap: async () => ({
      settings: { ...structuredClone(defaultSettings), autoSave: false },
      session: { tabs: structuredClone([alpha, beta]), activeId: 'A' },
      fonts: [],
      dataDirectory: 'generated-only',
      version: 'test',
    }),
    getIndex: async () => [],
    getTree: async () => [],
    saveSession: async () => {},
    saveSettings: async (value: unknown) => value,
    centerWindow: async () => {},
    getWindowMode: async () => ({ mode: 'full', pinned: false }),
    setWindowMode: async (mode: string) => ({ mode, pinned: false }),
    setStickyPinned: async (pinned: boolean) => ({ mode: 'sticky', pinned }),
    setWindowTheme: async () => {},
    onWindowModeChanged: () => () => {},
    onFilesChanged: () => () => {},
    onCloseRequested: () => () => {},
    onOpenRequested: () => () => {},
    onProgress: () => () => {},
    prepareFiles: async () => [],
    chooseImports: async () => [],
    assetUrl: async () => '',
    ...overrides,
  });
  await act(async () => root.render(<App />));
}
const view = () => EditorView.findFromDOM(host.querySelector('.cm-content')!)!;
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('button')];
async function click(text: string) {
  await act(async () =>
    buttons()
      .find((button) => button.textContent === text)!
      .click(),
  );
}
async function drop(files: File[], target: Element = host.querySelector('.cm-content')!) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files } });
  Object.defineProperties(event, { clientX: { value: 0 }, clientY: { value: 0 } });
  await act(async () => target.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
}
async function choose() {
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="应用菜单"]')!.click());
  await click('导入文件');
}
async function select(label: string, value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

it('routes file drops before CodeMirror default and preserves the existing note text', async () => {
  const prepare = vi.fn(
    async () =>
      [
        { kind: 'note', name: 'Gamma.md', note: gamma },
        { kind: 'error', name: 'binary.exe', message: '不支持此文件' },
      ] satisfies TransferItem[],
  );
  await mount({ prepareFiles: prepare });
  await drop([new File(['raw content that must never be inserted'], 'Gamma.md')]);
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(view().state.doc.toString()).toBe(gamma.content);
  expect(host.textContent).toContain('binary.exe');
  expect(host.textContent).toContain('不支持此文件');
  await click('完成');
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent?.includes('Alpha'))!
      .click(),
  );
  expect(view().state.doc.toString()).toBe(alpha.content);
});
it('keeps mixed-drop images in their original editor before opening Markdown tabs', async () => {
  const attach = vi.fn(async () => ({ reference: 'assets/generated.png' }));
  await mount({
    putAttachment: attach,
    prepareFiles: async () => [
      { kind: 'note', name: 'Gamma.md', note: gamma },
      { kind: 'image', name: 'generated.png', mime: 'image/png', bytes: [1, 2, 3] },
    ],
  });
  vi.spyOn(view(), 'posAtCoords').mockReturnValue(4);
  await drop([
    new File(['md'], 'Gamma.md'),
    new File(['png'], 'generated.png', { type: 'image/png' }),
  ]);
  await vi.waitFor(() => expect(host.textContent).toContain('文件处理结果'));
  expect(attach).toHaveBeenCalledWith(alpha.path, 'generated.png', [1, 2, 3]);
  expect(view().state.doc.toString()).toBe(gamma.content);
  await click('完成');
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent?.includes('Alpha'))!
      .click(),
  );
  expect(view().state.doc.toString()).toContain('![generated.png](assets/generated.png)');
});
it('cancels image insertion when the user changes editor while file preparation is pending', async () => {
  let finish!: (items: TransferItem[]) => void;
  const attach = vi.fn();
  await mount({
    putAttachment: attach,
    prepareFiles: () =>
      new Promise<TransferItem[]>((resolve) => {
        finish = resolve;
      }),
  });
  await drop([new File(['png'], 'generated.png', { type: 'image/png' })]);
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent?.includes('Beta'))!
      .click(),
  );
  await act(async () =>
    finish([{ kind: 'image', name: 'generated.png', mime: 'image/png', bytes: [1, 2, 3] }]),
  );
  expect(attach).not.toHaveBeenCalled();
  expect(view().state.doc.toString()).toBe(beta.content);
  expect(host.textContent).toContain('目标已切换时不会插入另一篇');
});
it('previews CSV choices and produces a new unsaved draft using all quoted cell data', async () => {
  await mount({ chooseImports: async () => [{ kind: 'source', name: table.name, source: table }] });
  await choose();
  expect(host.querySelectorAll('[aria-label="表格导入预览"] tr')).toHaveLength(2);
  expect(host.querySelector('[aria-label="表格导入预览"]')?.textContent).toContain('一,二\n三');
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click('生成 Markdown 草稿');
  expect(view().state.doc.toString()).toContain('| 姓名 | 说明 |');
  expect(view().state.doc.toString()).toContain('一,二<br>三');
  expect(view().state.doc.toString().split('\n')[0]).toBe('|  |  |');
  expect(host.querySelectorAll('.tabs-bar [role="tab"]')).toHaveLength(3);
});
it('cancelling a table preview creates no draft and the existing text stays intact', async () => {
  await mount({ chooseImports: async () => [{ kind: 'source', name: table.name, source: table }] });
  await choose();
  await click('取消导入');
  expect(host.textContent).toContain('已取消本文件导入');
  expect(host.querySelectorAll('.tabs-bar [role="tab"]')).toHaveLength(2);
  expect(view().state.doc.toString()).toBe(alpha.content);
});
it('adds selected folders and preserves individual unsupported-file feedback', async () => {
  const settings = vi.fn(async (value: unknown) => value);
  await mount({
    saveSettings: settings,
    chooseImports: async () => [
      { kind: 'directory', name: '资料', path: 'D:/generated/资料' },
      { kind: 'error', name: '演示.pptx', message: '不支持此文件' },
    ],
  });
  await choose();
  expect(host.textContent).toContain('已添加到左侧目录');
  expect(host.textContent).toContain('演示.pptx');
  await vi.waitFor(() => expect(settings).toHaveBeenCalled());
  expect(settings.mock.lastCall?.[0]).toMatchObject({ roots: ['D:/generated/资料'] });
});
it('keeps previous preview data and an explicit failure when an encoding cannot be decoded', async () => {
  const imported = vi.fn();
  Reflect.set(window, 'notes', {
    readImport: vi.fn(async () => {
      throw Error('此编码无法解码，原文未修改');
    }),
  });
  await act(async () =>
    root.render(<ImportPanel source={table} onClose={() => {}} onImport={imported} />),
  );
  await select('导入字符编码', 'utf-16be');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('无法解码');
  expect(host.querySelector('[aria-label="表格导入预览"]')?.textContent).toContain('姓名');
  expect(buttons().find((button) => button.textContent === '生成 Markdown 草稿')?.disabled).toBe(
    true,
  );
  expect(imported).not.toHaveBeenCalled();
});
it('changes delimiter live without flattening the original rows', async () => {
  const imported = vi.fn();
  await act(async () =>
    root.render(
      <ImportPanel
        source={{ ...table, text: '姓名,值\n甲,1' }}
        onClose={() => {}}
        onImport={imported}
      />,
    ),
  );
  await select('导入分隔符', ';');
  expect(host.querySelector('[role="status"]')?.textContent).toContain('1 列');
  await select('导入分隔符', ',');
  await click('生成 Markdown 草稿');
  expect(imported).toHaveBeenCalledWith(
    expect.objectContaining({ id: table.id }),
    expect.stringContaining('| 甲 | 1 |'),
  );
});
it('keeps HTML source authority in its draft and sends it only through the existing save workflow', async () => {
  const source: ImportSource = {
    ...table,
    id: 'source-html',
    name: '文章.html',
    format: 'html',
    text: '<p>导入的正文</p><img src="local.png" alt="图片"><table><tr><th>列</th></tr><tr><td>内容</td></tr></table>',
  };
  const resolve = vi.fn(async () => 'note-asset://generated/local.png');
  const save = vi.fn(async (request: { content: string }) => ({
    status: 'saved',
    note: {
      ...gamma,
      id: 'saved-import',
      title: '文章',
      content: request.content.replace('local.png', 'assets/local.png'),
    },
  }));
  await mount({
    chooseImports: async () => [{ kind: 'source', name: source.name, source }],
    importAssetUrl: resolve,
    saveFile: save,
  });
  await choose();
  expect(view().state.doc.toString()).toContain('| 内容 |');
  expect(view().state.doc.toString()).toContain('导入的正文');
  await vi.waitFor(() => expect(resolve).toHaveBeenCalledWith('source-html', 'local.png'));
  await click('完成');
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }),
    ),
  );
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      path: null,
      importSourceId: 'source-html',
      content: expect.stringContaining('![图片](local.png)'),
    }),
  );
  expect(view().state.doc.toString()).toContain('assets/local.png');
});
it('offers each CSV source in order and can cancel the second without losing the first draft', async () => {
  const second = {
    ...table,
    id: 'source-second',
    name: '第二份.tsv',
    format: 'tsv' as const,
    text: '列\t值\n乙\t2',
  };
  await mount({
    chooseImports: async () => [
      { kind: 'source', name: table.name, source: table },
      { kind: 'source', name: second.name, source: second },
    ],
  });
  await choose();
  await click('生成 Markdown 草稿');
  expect(host.textContent).toContain('导入表格 · 第二份.tsv');
  await click('取消导入');
  expect(host.querySelectorAll('.tabs-bar [role="tab"]')).toHaveLength(3);
  expect(view().state.doc.toString()).toContain('一,二<br>三');
  expect(host.textContent).toContain('已取消本文件导入');
});
it.each(['keep-both', 'save-ours'])(
  'keeps imported source authority through the %s conflict action',
  async (action) => {
    const source: ImportSource = {
      ...table,
      id: 'source-conflict',
      format: 'html',
      name: '冲突.html',
      text: '<p>导入的正文</p><img src="local.png" alt="图片">',
    };
    let calls = 0;
    const save = vi.fn(async (request: { content: string }) =>
      ++calls === 1
        ? {
            status: 'conflict',
            conflict: {
              path: gamma.path!,
              base: '',
              ours: request.content,
              theirs: '已有文件',
              hash: 'existing',
            },
          }
        : {
            status: 'saved',
            note: { ...gamma, content: request.content.replace('local.png', 'assets/local.png') },
          },
    );
    await mount({
      chooseImports: async () => [{ kind: 'source', name: source.name, source }],
      importAssetUrl: async () => 'note-asset://generated/local.png',
      saveFile: save,
    });
    await choose();
    await click('完成');
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }),
      ),
    );
    expect(host.querySelector('[aria-label="冲突本地版本"]')).not.toBeNull();
    if (action === 'keep-both') {
      await click('保留双方，稍后整理');
      await act(async () =>
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 's',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    } else await click('以我的编辑保存');
    expect(save.mock.calls[1]?.[0]).toMatchObject({ importSourceId: source.id });
    expect(view().state.doc.toString()).toContain('assets/local.png');
  },
);
it('returns from the sticky import action to one full-window CSV preview without losing its queue', async () => {
  const mode = vi.fn(async (mode: string) => ({ mode, pinned: false }));
  await mount({
    getWindowMode: async () => ({ mode: 'sticky', pinned: true }),
    setWindowMode: mode,
    chooseImports: async () => [{ kind: 'source', name: table.name, source: table }],
  });
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="便笺更多操作"]')!.click(),
  );
  await click('导入文件');
  expect(mode).toHaveBeenCalledWith('full');
  expect(host.querySelectorAll('dialog')).toHaveLength(1);
  expect(host.querySelector('[aria-label="表格导入预览"]')).not.toBeNull();
  expect(host.querySelector('.app')?.getAttribute('data-window-mode')).toBe('full');
  await click('生成 Markdown 草稿');
  expect(view().state.doc.toString()).toContain('一,二<br>三');
});
it.each(['ordinary', 'force'])(
  'retains source authority for images added while the %s save is pending',
  async (mode) => {
    const source: ImportSource = {
      ...table,
      id: 'source-pending',
      name: '待保存.html',
      format: 'html',
      text: '<p>顶部</p><img src="local.png" alt="图片"><p>中段</p><img src="unused.png" alt="稍后插入"><p>尾段</p>',
    };
    let finish!: (result: SaveOutcome) => void;
    let pendingRequest: SaveRequest | undefined;
    let calls = 0;
    const save = vi.fn(async (request: SaveRequest): Promise<SaveOutcome> => {
      calls++;
      if (mode === 'force' && calls === 1)
        return {
          status: 'conflict',
          conflict: {
            path: gamma.path!,
            base: '',
            ours: request.content,
            theirs: '已有文件',
            hash: 'existing',
          },
        };
      if (calls === (mode === 'force' ? 2 : 1)) {
        pendingRequest = request;
        return new Promise<SaveOutcome>((resolve) => {
          finish = resolve;
        });
      }
      return {
        status: 'saved',
        note: {
          ...gamma,
          content: request.importSourceId
            ? request.content
                .replaceAll('](local.png)', '](assets/local.png)')
                .replaceAll('](unused.png)', '](assets/unused.png)')
            : request.content,
        },
      };
    });
    await mount({
      chooseImports: async () => [{ kind: 'source', name: source.name, source }],
      importAssetUrl: async () => 'note-asset://generated/image.png',
      saveFile: save,
    });
    await choose();
    await click('完成');
    await act(async () =>
      view().dispatch({
        changes: {
          from: 0,
          to: view().state.doc.length,
          insert: '顶部\n\n![图片](local.png)\n\n中段\n\n尾段',
        },
      }),
    );
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }),
      ),
    );
    if (mode === 'force') await click('以我的编辑保存');
    expect(pendingRequest).toBeDefined();
    await act(async () =>
      view().dispatch({
        changes: { from: view().state.doc.length, insert: '\n\n![稍后插入](unused.png)' },
      }),
    );
    await act(async () =>
      finish({
        status: 'saved',
        note: {
          ...gamma,
          content: pendingRequest!.content.replace('](local.png)', '](assets/local.png)'),
        },
      }),
    );
    expect(host.querySelector('[aria-label="冲突本地版本"]')).toBeNull();
    expect(view().state.doc.toString()).toContain('assets/local.png');
    if (mode === 'force') {
      expect(view().state.doc.toString()).toContain('![稍后插入](unused.png)');
      await act(async () =>
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 's',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    }
    expect(save.mock.lastCall?.[0]).toMatchObject({ importSourceId: source.id });
    expect(view().state.doc.toString()).toContain('assets/unused.png');
  },
);
