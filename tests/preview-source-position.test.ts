// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { livePreviewField, previewConfig } from '../src/editor/live-preview';
import { previewSourcePosition } from '../src/editor/preview-source-position';
import { renderMarkdown } from '../src/editor/renderer';

function rendered(source: string) {
  const root = document.createElement('div');
  root.innerHTML = renderMarkdown(source);
  return root;
}

describe('bounded preview source positions', () => {
  it('uses the current widget dataset after text before the preview changes', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const source = '# 标题\n\n重复 **重复** 后文';
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: source,
        extensions: [livePreviewField, previewConfig.of({ mode: 'live' })],
      }),
    });
    try {
      view.dispatch({ changes: { from: 0, insert: '\n\n' } });
      const node = host.querySelector('strong')!.firstChild;
      Object.defineProperty(document, 'caretPositionFromPoint', {
        configurable: true,
        value: () => ({ offsetNode: node, offset: 1 }),
      });
      host
        .querySelector('strong')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(view.state.selection.main.head).toBe(14);
      expect(view.state.doc.toString()).toBe('\n\n' + source);
    } finally {
      view.destroy();
      host.remove();
      Reflect.deleteProperty(document, 'caretPositionFromPoint');
    }
  });
  it('preserves link activation and checkbox editing instead of routing those controls through text mapping', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const source = '# 标题\n\n[显示](target)target\n\n- [ ] 任务';
    const onLink = vi.fn();
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: source,
        extensions: [livePreviewField, previewConfig.of({ mode: 'live', onLink })],
      }),
    });
    try {
      host
        .querySelector('a')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(onLink).toHaveBeenCalledWith('target');
      expect(view.state.doc.toString()).toBe(source);
      const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      expect(view.state.doc.toString()).toBe('# 标题\n\n[显示](target)target\n\n- [x] 任务');
    } finally {
      view.destroy();
      host.remove();
    }
  });
  it('maps ordinary currency prose containing an unmatched dollar without treating it as math', () => {
    const source = '预算 $50，预算 **预算**';
    const root = rendered(source);
    expect(previewSourcePosition(root, source, root.querySelector('strong')!.firstChild, 1)).toBe(
      13,
    );
  });
  it('maps first and later repeated plain and emphasized text in DOM order', () => {
    const source = '重复 **重复** 重复 **重复**';
    const root = rendered(source);
    const paragraph = root.querySelector('p')!;
    expect(previewSourcePosition(root, source, paragraph.firstChild, 1)).toBe(1);
    expect(
      previewSourcePosition(root, source, root.querySelectorAll('strong')[0].firstChild, 1),
    ).toBe(6);
    expect(previewSourcePosition(root, source, paragraph.childNodes[2], 2)).toBe(11);
    expect(
      previewSourcePosition(root, source, root.querySelectorAll('strong')[1].firstChild, 1),
    ).toBe(16);
  });
  it('skips link destinations rather than mapping following visible text into a URL', () => {
    const source = '[显示](target)target **target**';
    const root = rendered(source);
    expect(previewSourcePosition(root, source, root.querySelector('a')!.firstChild, 1)).toBe(2);
    expect(previewSourcePosition(root, source, root.querySelector('a')!.nextSibling, 3)).toBe(15);
    expect(previewSourcePosition(root, source, root.querySelector('strong')!.firstChild, 3)).toBe(
      24,
    );
  });
  it('maps decoded entities and surrogate-pair offsets back to complete source ranges', () => {
    const source = 'A &amp; A &#x1F600; Z';
    const root = rendered(source);
    const node = root.querySelector('p')!.firstChild;
    expect(previewSourcePosition(root, source, node, 3)).toBe(7);
    expect(previewSourcePosition(root, source, node, 6)).toBe(10);
    expect(previewSourcePosition(root, source, node, 8)).toBe(19);
    const escaped = '\\*字面\\*';
    const escapeRoot = rendered(escaped);
    expect(
      previewSourcePosition(escapeRoot, escaped, escapeRoot.querySelector('p')!.firstChild, 1),
    ).toBe(2);
    expect(
      previewSourcePosition(escapeRoot, escaped, escapeRoot.querySelector('p')!.firstChild, 4),
    ).toBe(6);
  });
  it('retains literal dollars inside repeated inline code', () => {
    const source = '`$x$` 与 `$x$`';
    const root = rendered(source);
    expect(
      previewSourcePosition(root, source, root.querySelectorAll('code')[0].firstChild, 2),
    ).toBe(3);
    expect(
      previewSourcePosition(root, source, root.querySelectorAll('code')[1].firstChild, 2),
    ).toBe(11);
  });
  it('ignores code captions and line numbers when mapping repeated highlighted code', () => {
    const source = '```js\nconst x = x;\nx;\n```';
    const root = rendered(source);
    const lines = root.querySelectorAll('.code-line-content');
    const node = lines[1].firstChild;
    expect(previewSourcePosition(root, source, node, 1)).toBe(20);
    expect(
      previewSourcePosition(root, source, root.querySelector('.code-line-number')!.firstChild, 1),
    ).toBeNull();
  });
  it.each(['> 引用 **引用**', '- 项目 **项目**'])(
    'supports common quote and list prefixes: %s',
    (source) => {
      const root = rendered(source);
      expect(previewSourcePosition(root, source, root.querySelector('strong')!.firstChild, 1)).toBe(
        8,
      );
    },
  );
  it.each([
    { source: '前 $x$ 后', position: 6 },
    { source: '[[目标|显示]] 后', position: 10 },
  ])('maps ordinary text after a supported source atom: $source', ({ source, position }) => {
    const root = rendered(source);
    expect(previewSourcePosition(root, source, root.querySelector('p')!.lastChild, 1)).toBe(
      position,
    );
  });
  it.each(['前 <span>文字</span> 后'])('returns no guess for unsupported source: %s', (source) => {
    const root = rendered(source);
    expect(previewSourcePosition(root, source, root.querySelector('p')!.lastChild, 1)).toBeNull();
  });
});
