// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/editor/MarkdownEditor';
import type { MarkdownEditorHandle } from '../src/editor/types';
import { defaultSettings } from '../src/shared/defaults';
import { compoundClipboardToMarkdown } from '../src/editor/clipboard';
let host: HTMLDivElement, root: Root;
let ref = createRef<MarkdownEditorHandle>();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, 1, 20),
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  ref = createRef<MarkdownEditorHandle>();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mount(onImage: (file: File) => Promise<string | null>, value = '') {
  const error = vi.fn();
  await act(async () =>
    root.render(
      <MarkdownEditor
        ref={ref}
        value={value}
        mode="source"
        settings={defaultSettings}
        onChange={() => {}}
        onImage={onImage}
        onError={error}
      />,
    ),
  );
  return { view: ref.current!.getView()!, error };
}
async function paste(html: string, plain: string, fileName = 'clip.png', pure = false) {
  const view = ref.current!.getView()!;
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files: [new File(['x'], fileName, { type: 'image/png' })],
      getData: (type: string) => (type === 'text/html' ? html : type === 'text/plain' ? plain : ''),
    },
  });
  await act(async () => {
    view.focus();
    if (pure)
      view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true, bubbles: true }),
      );
    view.contentDOM.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
describe('compound clipboard preserves text and image identity', () => {
  it('does not append duplicate file representations of the same in-place data image', async () => {
    const files = [
      new File(['x'], 'a.png', { type: 'image/png' }),
      new File(['x'], 'b.png', { type: 'image/png' }),
    ];
    const image = vi.fn(async () => 'assets/image.png');
    const result = await compoundClipboardToMarkdown(
      '<p>前<img src="data:image/png;base64,eA==" alt="图">后</p>',
      '前图后',
      files,
      image,
    );
    expect(result.markdown).toBe('前![图](assets/image.png)后');
    expect(image).toHaveBeenCalledOnce();
  });
  it('keeps HTML image order when the files array has the opposite order', async () => {
    const a = new File(['a'], 'a.png', { type: 'image/png' });
    const b = new File(['b'], 'b.png', { type: 'image/png' });
    const image = vi.fn(async (file: File) => `assets/${file.name}`);
    const result = await compoundClipboardToMarkdown(
      '<p>前<img src="cid:b.png" alt="乙">中<img src="cid:a.png" alt="甲">后</p>',
      '前乙中甲后',
      [a, b],
      image,
    );
    expect(result.markdown).toBe('前![乙](assets/b.png)中![甲](assets/a.png)后');
    expect(image.mock.calls.map(([file]) => file.name)).toEqual(['b.png', 'a.png']);
  });
  it('imports a repeated matched image only once while retaining both intended image positions', async () => {
    const file = new File(['a'], 'a.png', { type: 'image/png' });
    const image = vi.fn(async () => 'assets/a.png');
    const result = await compoundClipboardToMarkdown(
      '<p><img src="cid:a.png" alt="一">文字<img src="cid:a.png" alt="二"></p>',
      '一文字二',
      [file],
      image,
    );
    expect(result.markdown).toBe('![一](assets/a.png)文字![二](assets/a.png)');
    expect(image).toHaveBeenCalledOnce();
  });
  it('replaces a unique matching CID image in place while preserving surrounding rich text', async () => {
    const image = vi.fn(async () => 'assets/clip.png');
    const { view } = await mount(image);
    await paste('<p>前 <b>加粗</b><img src="cid:clip.png" alt="图"> 后</p>', '前 加粗 图 后');
    expect(view.state.doc.toString()).toBe('前 **加粗**![图](assets/clip.png) 后');
    expect(image).toHaveBeenCalledOnce();
  });
  it('matches data images by actual file bytes rather than the files array position', async () => {
    const image = vi.fn(async () => 'assets/data.png');
    const { view } = await mount(image);
    await paste(
      '<p>前<img src="data:image/png;base64,eA==" alt="图">后</p>',
      '前图后',
      'unrelated.png',
    );
    expect(view.state.doc.toString()).toBe('前![图](assets/data.png)后');
    expect(image).toHaveBeenCalledOnce();
  });
  it('keeps unknown CID alt text and appends each unmatched file once with a placement notice', async () => {
    const image = vi.fn(async () => 'assets/clip.png');
    const { view, error } = await mount(image);
    await paste('<p>前<img src="cid:unknown.png" alt="原图">后</p>', '前原图后');
    const source = view.state.doc.toString();
    expect(source).toContain('前');
    expect(source).toContain('原图');
    expect(source).toContain('后');
    expect(source).not.toContain('cid:');
    expect(source.match(/assets\/clip.png/g)).toHaveLength(1);
    expect(source.indexOf('后')).toBeLessThan(source.indexOf('assets/clip.png'));
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/位置.*文字之后/));
  });
  it('preserves an unrelated usable remote image and does not silently add a possible duplicate file', async () => {
    const image = vi.fn(async () => 'assets/clip.png');
    const { view, error } = await mount(image);
    await paste('<p>前<img src="https://example.com/remote.png" alt="远程图">后</p>', '前远程图后');
    expect(view.state.doc.toString()).toBe('前![远程图](https://example.com/remote.png)后');
    expect(image).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/未重复添加.*未全部本地化/));
  });
  it('retains the paragraph and a visible alt placeholder when image import fails', async () => {
    const { view, error } = await mount(async () => {
      throw new Error('自建导图失败');
    });
    await paste(
      '<p>必须保留的文字<img src="cid:clip.png" alt="原图">末尾</p>',
      '必须保留的文字原图末尾',
    );
    expect(view.state.doc.toString()).toContain('必须保留的文字');
    expect(view.state.doc.toString()).toContain('末尾');
    expect(view.state.doc.toString()).toContain('原图');
    expect(view.state.doc.toString()).not.toContain('assets/');
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/导图失败/));
  });
  it('maps a pending compound insertion past intervening typing and preserves it on undo', async () => {
    let finish!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const { view } = await mount(() => pending);
    await paste('<p>粘贴文字<img src="cid:clip.png" alt="图"></p>', '粘贴文字图');
    await act(async () => ref.current!.insert('期间输入'));
    await act(async () =>
      root.render(
        <MarkdownEditor
          ref={ref}
          value={view.state.doc.toString()}
          mode="live"
          settings={defaultSettings}
          onChange={() => {}}
          onImage={() => pending}
        />,
      ),
    );
    expect(ref.current!.getView()).toBe(view);
    await act(async () => {
      finish('assets/clip.png');
      await pending;
    });
    expect(view.state.doc.toString()).toBe('期间输入粘贴文字![图](assets/clip.png)');
    await act(async () => ref.current!.command('undo'));
    expect(view.state.doc.toString()).toBe('期间输入');
  });
  it('does not complete a pending compound paste after the original view is unmounted', async () => {
    let finish!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    await mount(() => pending);
    await paste('<p>旧文<img src="cid:clip.png"></p>', '旧文');
    await act(async () => root.render(null));
    await mount(async () => 'other.png', '新笔记');
    await act(async () => {
      finish('assets/clip.png');
      await pending;
    });
    expect(ref.current!.getView()!.state.doc.toString()).toBe('新笔记');
  });
  it('honors plain-text paste before the image branch and never imports files', async () => {
    const image = vi.fn(async () => 'assets/clip.png');
    const { view } = await mount(image);
    await paste('<p>富文本<img src="cid:clip.png"></p>', '只要纯文本', 'clip.png', true);
    expect(view.state.doc.toString()).toBe('只要纯文本');
    expect(image).not.toHaveBeenCalled();
  });
});
