import katexStyle from 'katex/dist/katex.min.css?inline';
import editorStyle from './editor.css?inline';
import { renderMarkdown } from './renderer';
import type { RenderOptions } from './types';

let offlineStyle: Promise<string> | undefined;
function embeddedStyles(): Promise<string> {
  if (!offlineStyle) {
    const urls = [
      ...new Set([...katexStyle.matchAll(/url\((?:["']?)([^)"']+)["']?\)/g)].map((m) => m[1])),
    ];
    offlineStyle = Promise.all(
      urls.map(async (reference) => {
        if (reference.startsWith('data:')) return [reference, reference] as const;
        const url = new URL(reference, location.href);
        if (url.origin !== location.origin) throw Error('导出字体来源不属于本地样稿');
        const response = await fetch(url);
        if (!response.ok) throw Error('导出字体读取失败');
        const blob = await response.blob();
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(Error('导出字体编码失败'));
          reader.readAsDataURL(blob);
        });
        return [reference, data] as const;
      }),
    )
      .then((pairs) => {
        let css = katexStyle;
        for (const [reference, data] of pairs) css = css.split(reference).join(data);
        return css + '\n' + editorStyle;
      })
      .catch((error) => {
        offlineStyle = undefined;
        throw error;
      });
  }
  return offlineStyle;
}

/** Same document is downloaded by the sample UI and printed by the headless check. */
export async function exportPrototypeHtml(source: string, options: RenderOptions): Promise<string> {
  const body = renderMarkdown(source, options),
    style = await embeddedStyles();
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>鸢笺 · 语法示例</title><style>${style}\nhtml,body{height:auto;margin:0;background:#fff;color:#292724}body{font:17px/1.8 system-ui,sans-serif;padding:32px}main{max-width:76ch;margin:auto}img{max-width:100%;height:auto}pre{overflow:auto}h1,h2,h3{line-height:1.4}a{color:#665947}summary{cursor:pointer}.code-copy{display:none}@page{margin:18mm}@media print{body{padding:0}.note-embed-open{display:none}}</style></head><body><main class="markdown-rendered">${body}</main></body></html>`;
}
