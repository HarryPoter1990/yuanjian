import React, { createRef, useState, useRef, useCallback, useEffect } from 'react';
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
import {
  fixtureNotes,
  resolveFixtureAsset,
  resolveFixtureNote,
  syntaxExamples,
  syntaxInsertions,
} from './prototype-fixtures';
import { createMarkdownParser, hydrateMarkdown, renderReadingMarkdown } from './renderer';
import { selectNoteFragment } from './note-syntax';
import { footnoteLine } from '../shared/footnotes';
import { isolateHistory } from '@codemirror/commands';
import { exportPrototypeHtml } from './prototype-export';
import { selectedCopy } from './clipboard-output';
import type { RenderOptions } from './types';

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
  ...syntaxExamples,
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
  path?: string,
) => void;
let renderOptions: RenderOptions, currentValue: string, openDemoLink: (target: string) => void;

function Demo() {
  const [value, setValue] = useState(examples['综合笔记']);
  const [seed, setSeed] = useState(0),
    [cursor, setCursor] = useState(0);
  const [experimental, setExperimental] = useState(true),
    [mode, setMode] = useState<'live' | 'source'>('live');
  const [theme, setTheme] = useState<'light' | 'dark'>('light'),
    [notice, setNotice] = useState('');
  const [scenario, setScenario] = useState('综合笔记');
  const [notePath, setNotePath] = useState('综合笔记.md');
  const [reading, setReading] = useState(false);
  const readingRoot = useRef<HTMLDivElement>(null);
  const buffers = useRef(
    new Map([
      ...Object.entries(fixtureNotes),
      ...Object.entries(examples).map(([name, text]) => [name + '.md', text] as const),
    ]),
  );
  buffers.current.set(notePath, value);
  const resolveNote = useCallback(
    (reference: string, from = notePath) => resolveFixtureNote(reference, from, buffers.current),
    [notePath],
  );
  renderOptions = {
    prototypeSyntax: experimental,
    resolveNote,
    resolveAsset: resolveFixtureAsset,
    notePath,
  };
  currentValue = value;
  resetDemo = (text, nextMode, position, nextExperimental, path = '试写.md') => {
    setNotice('');
    setValue(text);
    setNotePath(path);
    setMode(nextMode);
    setCursor(position);
    setExperimental(nextExperimental);
    setSeed((n) => n + 1);
  };
  openDemoLink = (target) => {
    if (/^[a-z][a-z\d+.-]*:/i.test(target) && !target.startsWith('mailto:')) {
      setNotice(`外部链接：${target}（样稿不自动打开）`);
      return;
    }
    const [path, fragment = ''] = target.split('#', 2);
    const found = path ? resolveNote(path) : { path: notePath, source: value };
    if ('error' in found) {
      setNotice(`无法打开 ${target}：${found.error}`);
      return;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(fragment);
    } catch {
      setNotice('链接位置编码无效');
      return;
    }
    const footnote = footnoteLine(found.source, decoded);
    const selected = footnote
      ? { source: '', line: footnote }
      : selectNoteFragment(
          createMarkdownParser({ prototypeSyntax: true }),
          found.source,
          decoded.startsWith('block-') ? '^' + decoded.slice(6) : decoded,
        );
    if ('error' in selected) {
      setNotice(selected.error);
      return;
    }
    const cursor = found.source
      .split('\n')
      .slice(0, selected.line - 1)
      .reduce((n, line) => n + line.length + 1, 0);
    if (found.path === notePath && reference.current?.getView()) {
      reference.current.restorePosition(cursor, reference.current.getScroll());
    } else {
      resetDemo(found.source, mode, cursor, experimental, found.path);
    }
    setReading(false);
    setNotice(`已定位：${target}`);
  };
  useEffect(() => {
    if (reading && readingRoot.current)
      void hydrateMarkdown(readingRoot.current, async (path) => resolveFixtureAsset(path));
  }, [reading, value, experimental]);
  const changeExample = (name: string) => {
    if (
      value !== examples[scenario as keyof typeof examples] &&
      !confirm('切换示例会替换本页内容，是否继续？')
    )
      return;
    setScenario(name);
    resetDemo(examples[name as keyof typeof examples], mode, 0, experimental, name + '.md');
    setNotice('');
  };
  const toggleVariant = (next: boolean) => {
    setCursor(reference.current?.getCursor() ?? cursor);
    setExperimental(next);
    setSeed((n) => n + 1);
  };
  const command = (name: EditorCommand) => reference.current?.command(name);
  const insertSyntax = (index: number) => {
    const view = reference.current?.getView(),
      entry = syntaxInsertions[index];
    if (!view || !entry) return;
    const selection = view.state.selection.main;
    const before =
      entry.block && selection.from !== view.state.doc.lineAt(selection.from).from ? '\n\n' : '';
    const after = entry.block ? '\n\n' : '';
    const at =
      before.length + (entry.select ? entry.text.indexOf(entry.select) : entry.text.length);
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: before + entry.text + after },
      selection: { anchor: selection.from + at, head: selection.from + at + entry.select.length },
      annotations: isolateHistory.of('full'),
      userEvent: 'input.insert',
    });
    view.focus();
  };
  const exportSample = async (pdf = false) => {
    try {
      const html = await exportPrototypeHtml(value, {
        ...renderOptions,
        exportMode: pdf ? 'pdf' : 'html',
      });
      if (pdf) {
        const frame = document.createElement('iframe');
        frame.title = '打印语法示例';
        frame.style.cssText = 'position:fixed;width:0;height:0;border:0';
        frame.onload = () => {
          frame.contentWindow?.addEventListener('afterprint', () => frame.remove(), { once: true });
          frame.contentWindow?.print();
        };
        frame.srcdoc = html;
        document.body.append(frame);
      } else {
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = '鸢笺-语法示例.html';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    } catch (error) {
      setNotice(`导出未完成：${error instanceof Error ? error.message : String(error)}`);
    }
  };
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
        试试局部编辑、提示块和笔记引用。内容只保留在本页，刷新后重置，不写入笔记文件。当前：
        {notePath}
      </div>
      <nav className="prototype-scenarios" aria-label="示例笔记">
        {Object.keys(examples).map((name) => (
          <button key={name} aria-pressed={scenario === name} onClick={() => changeExample(name)}>
            {name}
          </button>
        ))}
      </nav>
      <div className="prototype-toolbar" role="toolbar" aria-label="编辑工具">
        <select
          aria-label="插入语法"
          value=""
          disabled={reading || !experimental}
          onChange={(event) => insertSyntax(Number(event.target.value))}
        >
          <option value="" disabled>
            插入…
          </option>
          {syntaxInsertions.map((entry, index) => (
            <option key={entry.label} value={index}>
              {entry.label}
            </option>
          ))}
        </select>
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
        <button aria-pressed={reading} onClick={() => setReading(!reading)}>
          {reading ? '返回编辑' : '阅读'}
        </button>
        <button onClick={() => void exportSample()}>导出 HTML</button>
        <button onClick={() => void exportSample(true)}>打印 / PDF</button>
      </div>
      <main className="prototype-editor">
        <div className="prototype-edit-pane" hidden={reading}>
          <MarkdownEditor
            key={seed}
            ref={reference}
            prototypeEditing={experimental}
            notePath={notePath}
            resolveNote={resolveNote}
            resolveAsset={resolveFixtureAsset}
            mode={mode}
            settings={settings}
            value={value}
            initialCursor={cursor}
            onChange={setValue}
            onCursor={setCursor}
            onError={setNotice}
            resolveAssetAsync={async (path) => resolveFixtureAsset(path)}
            onLink={(target) => openDemoLink(target)}
          />
        </div>
        {reading && (
          <div
            ref={readingRoot}
            className="prototype-reading markdown-rendered"
            onClick={(event) => {
              const anchor = (event.target instanceof Element ? event.target : null)?.closest('a');
              if (anchor) {
                event.preventDefault();
                openDemoLink(anchor.dataset.noteLink ?? anchor.getAttribute('href') ?? '');
              }
            }}
            dangerouslySetInnerHTML={{ __html: renderReadingMarkdown(value, renderOptions) }}
          />
        )}
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
    render(source = currentValue, exportMode: 'html' | 'pdf' = 'html') {
      return renderReadingMarkdown(source, { ...renderOptions, exportMode });
    },
    exportHtml(source = currentValue, exportMode: 'html' | 'pdf' = 'html') {
      return exportPrototypeHtml(source, { ...renderOptions, exportMode });
    },
    copy() {
      return selectedCopy(reference.current!.getView()!);
    },
    link(target: string) {
      flushSync(() => openDemoLink(target));
    },
  },
});
