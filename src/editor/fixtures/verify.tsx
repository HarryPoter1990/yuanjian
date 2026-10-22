import { createRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import MarkdownEditor from '../MarkdownEditor';
import type { MarkdownEditorHandle } from '../types';
import { defaultSettings } from '../../shared/defaults';
import sample from './编辑器验收.md?raw';
import '../../styles/app.css';
import { longArticle } from './long-article';

const reference = createRef<MarkdownEditorHandle>();
Object.defineProperty(window, 'editorVerify', { get: () => reference.current });
const pixel =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvLsAAAAASUVORK5CYII=';
Object.defineProperty(window, 'notes', {
  value: { assetUrl: async () => pixel },
  configurable: true,
});

function Verification() {
  const [value, setValue] = useState(
    new URLSearchParams(location.search).has('long') ? longArticle : sample,
  );
  const [mode, setMode] = useState<'source' | 'live'>('live');
  const [target, setTarget] = useState('');
  const jump = (text: string, offset = 0): void =>
    reference.current?.scrollToLine(
      value.slice(0, value.indexOf(text)).split('\n').length + offset,
    );
  return (
    <>
      <style>{`body{margin:0;background:#faf9f5;color:#292d32;font-family:system-ui}header{height:46px;display:flex;align-items:center;gap:8px;padding:0 20px;border-bottom:1px solid #ddd}header button{padding:5px 8px;flex-shrink:0}main{height:calc(100vh - 150px);--content-width:800px;--editor-font-size:16px;--editor-line-height:1.85}textarea{height:90px;width:100%;box-sizing:border-box;font:11px monospace}.markdown-editor{--accent:#3b756b;--background:#faf9f5;--code-font:monospace}`}</style>
      <header>
        <b>编辑器真实窗口验收</b>
        <button onClick={() => setMode('live')}>即时排版</button>
        <button onClick={() => setMode('source')}>完整源码</button>
        <button onClick={() => reference.current?.command('undo')}>撤销编辑</button>
        <button onClick={() => reference.current?.scrollToLine(1)}>文首</button>
        <button onClick={() => jump('## 数学')}>公式位置</button>
        <button onClick={() => jump('## 代码与图表', -1)}>程序位置</button>
        <button onClick={() => jump('flowchart LR', -2)}>流程图位置</button>
        <button onClick={() => jump('sequenceDiagram', -2)}>时序图位置</button>
        <button onClick={() => jump('## 图片与链接')}>链接位置</button>
        <span data-testid="link-target">{target}</span>
      </header>
      <main className="editor-surface">
        <MarkdownEditor
          ref={reference}
          value={value}
          onChange={setValue}
          mode={mode}
          settings={defaultSettings}
          onLink={setTarget}
          onImage={async () => 'assets/测试图.png'}
        />
      </main>
      <textarea data-testid="source-value" aria-label="验收源码镜像" readOnly value={value} />
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Verification />);
