import React, { createRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MarkdownEditor } from './MarkdownEditor';
import type { MarkdownEditorHandle, EditorCommand } from './types';
import { defaultSettings } from '../shared/defaults';
import { builtinPalettes } from '../shared/palettes';
import '../styles/app.css';
import './editor.prototype.css';
import '@fontsource-variable/noto-sans-sc';
import '@fontsource/jetbrains-mono/400.css';

const examples = {
  综合笔记:
    '# 把想法写下来\n\n今天整理 **接口与多态** 的笔记，也试着让写作更顺手。可以点击加粗内容，观察标记是否只在附近出现。\n\n## 今天要做的事\n\n- 读完一个小节\n- 写下自己的理解\n  - 用一个例子解释\n- [ ] 整理成一篇笔记\n\n> 学习不必一次写得完整。\n> 先记录，再慢慢整理。\n\n1. 定义一个接口\n2. 编写两个实现\n3. 用同一段代码调用\n\n行内公式 $a^2+b^2=c^2$，后面的普通文字仍然可以编辑。\n\n$$\nE=mc^2\n$$\n\n```java\ninterface Shape {\n    double area();\n}\n```\n\n| 项目 | 进度 |\n| --- | --- |\n| 阅读 | 已完成 |\n| 练习 | 进行中 |\n\n在表格后面继续写。',
  列表与引用:
    '# 列表与引用\n\n- 第一项\n\n- 第二项：点击这里编辑\n\n- 第三项\n\n1. 第一步\n2. 第二步：按 Tab 变成子项\n3. 第三步\n\n> 一段引用\n>\n> 引用中的第二段\n\n> > \n\n最后一段不会随着整组列表展开而大幅跳动。',
  代码与公式:
    '# 代码与公式\n\n文字中有 **加粗**、*斜体*、`行内代码` 和 [示例链接](https://example.com)。\n\n公式 $x^2+y^2$ 后面继续写普通文字。\n\n```python\ndef square(x):\n    return x * x\n```\n\n$$\n\\sum_{i=1}^{n} i=\\frac{n(n+1)}{2}\n$$\n\n继续输入：空白行写三个反引号或两个美元符号，再按 Enter。\n\n',
  表格连续输入:
    '# 表格连续输入\n\n从这一段按向下键进入表格。\n\n| 名称 | 说明 |\n| --- | --- |\n| 第一项 | 可以在这一格输入较长的文字，观察自动折行时的方向键移动。 |\n| 第二项 | Shift+Enter 在格内换行 |\n\n从这里按向上键回到表格最后一行。',
  空白自由写: '',
};
const reference = createRef<MarkdownEditorHandle>();
const settings = {
  ...defaultSettings,
  appearance: {
    ...defaultSettings.appearance,
    bodyFont: 'Noto Sans SC Variable',
    codeFont: 'JetBrains Mono',
  },
};
let resetDemo: (
  text: string,
  mode: 'live' | 'source',
  cursor: number,
  experimental: boolean,
) => void;

function Demo() {
  const [value, setValue] = useState(examples['综合笔记']);
  const [seed, setSeed] = useState(0),
    [cursor, setCursor] = useState(0);
  const [experimental, setExperimental] = useState(true),
    [mode, setMode] = useState<'live' | 'source'>('live');
  const [theme, setTheme] = useState<'light' | 'dark'>('light'),
    [notice, setNotice] = useState('');
  const [scenario, setScenario] = useState('综合笔记');
  resetDemo = (text, nextMode, position, nextExperimental) => {
    setNotice('');
    setValue(text);
    setMode(nextMode);
    setCursor(position);
    setExperimental(nextExperimental);
    setSeed((n) => n + 1);
  };
  const changeExample = (name: string) => {
    if (
      value !== examples[scenario as keyof typeof examples] &&
      !confirm('切换示例会替换本页内容，是否继续？')
    )
      return;
    setScenario(name);
    resetDemo(examples[name as keyof typeof examples], mode, 0, experimental);
    setNotice('');
  };
  const toggleVariant = (next: boolean) => {
    setCursor(reference.current?.getCursor() ?? cursor);
    setExperimental(next);
    setSeed((n) => n + 1);
  };
  const command = (name: EditorCommand) => reference.current?.command(name);
  const line = value.slice(0, cursor).split('\n').length;
  const colors = builtinPalettes[0][theme];
  const themeStyle: React.CSSProperties & {
    '--background': string;
    '--foreground': string;
    '--accent': string;
  } = { '--background': colors.bg, '--foreground': colors.fg, '--accent': colors.accent };
  return (
    <div className="app editor-prototype" data-theme={theme} style={themeStyle}>
      <header className="prototype-header">
        <div>
          <strong>鸢笺</strong>
          <span>编辑体验试用</span>
        </div>
        <div className="prototype-variants" role="group" aria-label="对比编辑方式">
          <button aria-pressed={experimental} onClick={() => toggleVariant(true)}>
            改进样稿
          </button>
          <button aria-pressed={!experimental} onClick={() => toggleVariant(false)}>
            当前版本
          </button>
        </div>
        <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
          {theme === 'light' ? '深色' : '浅色'}
        </button>
      </header>
      <div className="prototype-intro">
        试试点选、连续输入、方向键和撤销，比较局部排版的手感。内容只保留在本页，刷新后重置，不写入笔记文件。
      </div>
      <nav className="prototype-scenarios" aria-label="示例笔记">
        {Object.keys(examples).map((name) => (
          <button key={name} aria-pressed={scenario === name} onClick={() => changeExample(name)}>
            {name}
          </button>
        ))}
      </nav>
      <div className="prototype-toolbar" role="toolbar" aria-label="编辑工具">
        {(
          [
            ['undo', '撤销'],
            ['redo', '重做'],
            ['bold', '粗体'],
            ['italic', '斜体'],
            ['list', '列表'],
            ['task', '任务'],
            ['quote', '引用'],
            ['code', '代码'],
            ['math', '公式'],
          ] as [EditorCommand, string][]
        ).map(([name, label]) => (
          <button key={name} onMouseDown={(e) => e.preventDefault()} onClick={() => command(name)}>
            {label}
          </button>
        ))}
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => reference.current?.setHeading(2)}
        >
          H2
        </button>
        <button
          className="prototype-mode"
          aria-pressed={mode === 'source'}
          onClick={() => setMode(mode === 'live' ? 'source' : 'live')}
        >
          {mode === 'live' ? '查看源码' : '即时排版'}
        </button>
      </div>
      <main className="prototype-editor">
        <MarkdownEditor
          key={seed}
          ref={reference}
          prototypeEditing={experimental}
          mode={mode}
          settings={settings}
          value={value}
          initialCursor={cursor}
          onChange={setValue}
          onCursor={setCursor}
          onError={setNotice}
          resolveAssetAsync={async () => ''}
          onLink={(target) => setNotice(`链接目标：${target}`)}
        />
      </main>
      {notice && (
        <div role="status" className="prototype-notice">
          {notice}
          <button onClick={() => setNotice('')}>关闭</button>
        </div>
      )}
      <footer className="prototype-footer">
        <span>
          {experimental ? '改进样稿' : '0.10.0 操作对照'} · {mode === 'live' ? '即时排版' : '源码'}{' '}
          · 第 {line} 行
        </span>
        <details>
          <summary>当前 Markdown</summary>
          <textarea aria-label="当前 Markdown 原文" value={value} readOnly />
        </details>
      </footer>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Demo />);
Object.assign(window, {
  editorPrototype: {
    reset(
      text: string,
      mode: 'live' | 'source' = 'live',
      cursor = text.length,
      experimental = true,
    ) {
      flushSync(() => resetDemo(text, mode, cursor, experimental));
      const view = reference.current!.getView()!;
      view.dispatch({ selection: { anchor: cursor } });
      view.focus();
    },
    get view() {
      return reference.current!.getView()!;
    },
    command(name: EditorCommand) {
      return reference.current!.command(name);
    },
    state() {
      const view = reference.current!.getView()!;
      return {
        source: view.state.doc.toString(),
        cursor: view.state.selection.main.head,
        anchor: view.state.selection.main.anchor,
        focused: view.hasFocus,
      };
    },
  },
});
