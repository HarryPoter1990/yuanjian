// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { extractHeadings } from '../src/shared/markdown';
import { renderMarkdown } from '../src/editor/renderer';
import { NoteStore } from '../electron/storage/store';
it('allocates globally unique heading ids in both metadata and exported HTML',()=>{
  const source='# a\n\n# a\n\n# a-1\n\n# a\n';
  const ids=extractHeadings(source).map(item=>item.id);
  expect(new Set(ids).size).toBe(ids.length);
  const root=document.createElement('div');root.innerHTML=renderMarkdown(source);
  expect([...root.querySelectorAll('h1')].map(item=>item.id)).toEqual(ids);
});
it('decodes Chinese fragments returned by the renderer without decoding them twice',async()=>{
  const store=new NoteStore('D:\\generated');
  store.authorize=async file=>file;
  const root=document.createElement('div');root.innerHTML=renderMarkdown('[跳](#中文标题)');
  const result=await store.resolveLink('D:\\generated\\note.md',root.querySelector('a')!.getAttribute('href')!);
  expect(result.heading).toBe('中文标题');
  expect((await store.resolveLink('D:\\generated\\note.md','#%2520')).heading).toBe('%20');
});
