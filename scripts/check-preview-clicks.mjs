import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Isolated real DOM clicks and typing in headless Edge; never starts Electron or reads user notes.
const project = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(project, 'artifacts', 'preview-clicks');
await mkdir(output, { recursive: true });
const built = await build({
  stdin: {
    contents: `
    import { EditorState } from '@codemirror/state';
    import { EditorView } from '@codemirror/view';
    import { livePreviewField, previewConfig } from './src/editor/live-preview';
    let view;
    window.mount = source => {
      view?.destroy(); document.body.replaceChildren();
      view = new EditorView({parent:document.body,state:EditorState.create({
        doc:source,selection:{anchor:0},extensions:[livePreviewField,previewConfig.of({mode:'live'})]
      })}); window.view = view;
    };
  `,
    resolveDir: project,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  logLevel: 'silent',
});
const js = built.outputFiles[0].text;
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'application/javascript' : 'text/html');
  res.end(
    req.url === '/app.js'
      ? js
      : '<!doctype html><style>body{font:20px sans-serif}.cm-editor{height:650px}.cm-content{padding:20px}.markdown-preview-block{padding:10px}</style><script src="/app.js"></script>',
  );
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
let browser;
const errors = [];
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const prose = '# 标题\n\n重复 **重复** 后文';
  await page.evaluate((source) => window.mount(source), prose);
  const point = await page.locator('strong').evaluate((el) => {
    const range = document.createRange();
    range.setStart(el.firstChild, 1);
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    const x = rect.x + 0.1,
      y = rect.y + rect.height / 2;
    const caret = document.caretPositionFromPoint(x, y);
    return { x, y, caretText: caret?.offsetNode.textContent, caretOffset: caret?.offset };
  });
  await page.mouse.click(point.x, point.y);
  const actualPosition = await page.evaluate(() => window.view.state.selection.main.head);
  await page.keyboard.insertText('插入');
  const actualProse = await page.evaluate(() => window.view.state.doc.toString());
  const expectedPosition = prose.indexOf('**重复**') + 2 + point.caretOffset;
  const positions = [];
  for (const fixture of [
    { text: '重复 **重复** 重复 **重复**', selector: 'p', child: 0, offset: 1, expected: 7 },
    { text: '重复 **重复** 重复 **重复**', selector: 'p', child: 2, offset: 2, expected: 17 },
    { text: '重复 **重复** 重复 **重复**', selector: 'strong', nth: 0, offset: 1, expected: 12 },
    { text: '重复 **重复** 重复 **重复**', selector: 'strong', nth: 1, offset: 1, expected: 22 },
    { text: '[显示](target)target **target**', selector: 'p', child: 1, offset: 3, expected: 21 },
    { text: '[显示](target)target **target**', selector: 'strong', offset: 3, expected: 30 },
    { text: '`$x$` 与 `$x$`', selector: 'code', nth: 1, offset: 2, expected: 17 },
    { text: '预算 $50，预算 **预算**', selector: 'strong', offset: 1, expected: 19 },
  ]) {
    await page.evaluate((source) => window.mount(source), '# 标题\n\n' + fixture.text);
    const at = await page
      .locator('.markdown-preview-block ' + fixture.selector)
      .nth(fixture.nth ?? 0)
      .evaluate((el, fixture) => {
        const range = document.createRange();
        range.setStart(el.childNodes[fixture.child ?? 0], fixture.offset);
        range.collapse(true);
        const rect = range.getBoundingClientRect();
        return { x: rect.x + 0.1, y: rect.y + rect.height / 2 };
      }, fixture);
    await page.mouse.click(at.x, at.y);
    positions.push({
      fixture,
      actual: await page.evaluate(() => window.view.state.selection.main.head),
    });
  }
  const table = '# 标题\n\n| A | B |\n| --- | --- |\n| 旧 | 值 |';
  await page.evaluate((source) => window.mount(source), table);
  // Synthetic composition events verify the event handler contract, not a physical Windows IME.
  const ime = await page
    .getByRole('textbox', { name: '表格第 2 行第 1 列', exact: true })
    .evaluate((input) => {
      input.focus();
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      input.value = 'zhong';
      input.setSelectionRange(3, 3);
      input.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertCompositionText',
          data: 'zhong',
          isComposing: true,
        }),
      );
      const sourceBeforeKey = window.view.state.doc.toString();
      const key = new KeyboardEvent('keydown', {
        key: 'Enter',
        keyCode: 229,
        bubbles: true,
        cancelable: true,
        isComposing: true,
      });
      input.dispatchEvent(key);
      return {
        remainedFocused: document.activeElement === input,
        prevented: key.defaultPrevented,
        source: window.view.state.doc.toString(),
        sourceBeforeKey,
        sameNode: input.isConnected,
        caret: [input.selectionStart, input.selectionEnd],
      };
    });
  const expectedProse = prose.slice(0, expectedPosition) + '插入' + prose.slice(expectedPosition);
  const results = {
    headless: true,
    imeScope: 'Synthetic composition events only; physical Windows IME not verified.',
    preview: { point, expectedPosition, actualPosition, expectedProse, actualProse },
    positions,
    ime: { ...ime, expectedSource: table.replace('| 旧 |', '| zhong |'), expectedFocus: true },
    errors,
  };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(results, null, 2));
  const failures = [];
  try {
    assert.equal(
      actualPosition,
      expectedPosition,
      'preview click must target the clicked repeated word',
    );
  } catch (error) {
    failures.push(error);
  }
  try {
    assert.equal(
      actualProse,
      expectedProse,
      'typing must update only the clicked source occurrence',
    );
  } catch (error) {
    failures.push(error);
  }
  try {
    assert.equal(ime.remainedFocused, true, 'composition Enter must not blur the table input');
  } catch (error) {
    failures.push(error);
  }
  try {
    assert.equal(ime.prevented, false, 'composition confirmation must retain its default behavior');
  } catch (error) {
    failures.push(error);
  }
  try {
    assert.equal(
      ime.sourceBeforeKey,
      table.replace('| 旧 |', '| zhong |'),
      'cell input must enter the document immediately',
    );
    assert.equal(
      ime.source,
      ime.sourceBeforeKey,
      'composition Enter must not add a document change',
    );
    assert.equal(ime.sameNode, true, 'input updates must preserve the active DOM node');
    assert.deepEqual(ime.caret, [3, 3], 'input updates must preserve the native cell caret');
  } catch (error) {
    failures.push(error);
  }
  for (const { fixture, actual } of positions) {
    try {
      assert.equal(actual, fixture.expected, fixture.text);
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    assert.deepEqual(errors, [], 'headless preview must not raise page errors');
  } catch (error) {
    failures.push(error);
  }
  if (failures.length) throw new AggregateError(failures, 'Headless preview input checks failed');
  console.log(
    `Preview clicks passed: ${positions.length} positions, typing and synthetic composition; ${path.join(output, 'result.json')}`,
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
