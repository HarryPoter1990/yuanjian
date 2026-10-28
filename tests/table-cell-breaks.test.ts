// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/editor/renderer';

const table = (cell: string) => `| A | B |\n| --- | --- |\n| ${cell} | 2 |`;
function rendered(source: string) {
  const host = document.createElement('div');
  host.innerHTML = renderMarkdown(source);
  return host;
}
describe('safe breaks inside Markdown table cells', () => {
  it.each(['<br>', '<br/>', '<br />', '<BR>'])(
    'renders %s and consecutive breaks without changing row or column count',
    (marker) => {
      const host = rendered(table(`first${marker}${marker}second`));
      expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
      expect(host.querySelectorAll('tbody td')).toHaveLength(2);
      expect(host.querySelector('tbody td')!.querySelectorAll('br')).toHaveLength(2);
      expect(host.querySelector('tbody td')!.textContent?.replace(/\n/g, '')).toBe('firstsecond');
    },
  );
  it('keeps emphasis and links spanning a safe line break', () => {
    const host = rendered(table('**first<br>second** [link<br>label](https://example.org)'));
    expect(host.querySelector('strong br')).not.toBeNull();
    expect(host.querySelector('a br')).not.toBeNull();
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.org');
  });
  it.each(['`<br>`', '\\<br>', '&lt;br&gt;', '<br onclick="evil()">'])(
    'keeps literal or unsupported cell syntax %s inert',
    (source) => {
      const host = rendered(table(source));
      expect(host.querySelector('tbody br')).toBeNull();
      expect(host.querySelector('[onclick]')).toBeNull();
    },
  );
  it('allows the approved BR subset outside tables while keeping executable HTML inert', () => {
    const host = rendered(
      'ordinary<br>text\n\n<img src=x onerror=evil()>\n\n' + table('<script>evil()</script>'),
    );
    expect(host.querySelectorAll('br')).toHaveLength(1);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('ordinarytext');
    expect(host.querySelector('[onerror]')).toBeNull();
  });
});
