// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { validateExportContent } from '../src/ui/exportValidation';
import { exportCanvasStyle } from '../src/ui/exportStyle';

function content(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}
describe('UI export completeness gate', () => {
  it('rejects local images that hydration could not resolve', () => {
    expect(() =>
      validateExportContent(content('<img data-asset-src="assets/丢失.png" title="图片无法读取">')),
    ).toThrow('assets/丢失.png');
  });
  it('allows real network image references without silently downloading them', () => {
    expect(() =>
      validateExportContent(
        content(
          '<img src="https://example.test/image.png" data-asset-src="https://example.test/image.png">',
        ),
      ),
    ).not.toThrow();
  });
  it('rejects failed or unfinished Mermaid rendering', () => {
    expect(() =>
      validateExportContent(
        content(
          '<div data-mermaid="true" data-rendered="error"><small class="diagram-error">图表语法错误</small></div>',
        ),
      ),
    ).toThrow('图表语法错误');
    expect(() =>
      validateExportContent(
        content('<div data-mermaid="true" data-rendered="pending"><pre>flowchart LR</pre></div>'),
      ),
    ).toThrow('图表尚未成功排版');
  });
  it('accepts an authorized local asset and a completed SVG diagram', () => {
    expect(() =>
      validateExportContent(
        content(
          '<img src="note-asset://authorized-token"><div data-mermaid="true" data-rendered="true"><svg viewBox="0 0 100 100"></svg></div>',
        ),
      ),
    ).not.toThrow();
  });
  it.each([
    { background: '#fff', expected: 'rgb(255, 255, 255)' },
    { background: '#1c2227', expected: 'rgb(28, 34, 39)' },
  ])(
    'paints the entire export canvas $background after desktop root styles are injected',
    ({ background, expected }) => {
      const styles = document.createElement('style');
      styles.textContent = `:root{background:#f6f5f1;color:#292d32}html,body{height:100%;overflow:hidden}${exportCanvasStyle(background, '#252b2a')}`;
      document.head.append(styles);
      try {
        expect(getComputedStyle(document.documentElement).backgroundColor).toBe(expected);
        expect(getComputedStyle(document.body).backgroundColor).toBe(expected);
      } finally {
        styles.remove();
      }
    },
  );
});
