// Run with `node scripts/check-settings-layout.mjs`. Uses Edge headlessly and in-memory settings.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const bundle = await build({
  stdin: {
    contents: `
      import {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {SettingsPanel} from './src/components/SettingsPanel';
      import {OperationContext} from './src/components/Controls';
      import {defaultSettings} from './src/shared/defaults';
      window.notes = {};
      function Fixture() {
        const [settings, update] = useState(structuredClone(defaultSettings));
        const [open, setOpen] = useState(false);
        const [operation, setOperation] = useState({busy:'',notice:null});
        window.settingsLayoutFixture = {setOperation};
        return <div className="app" data-theme="light" style={{'--ui-font':'sans-serif','--foreground':'#202020','--surface':'#F0F0F0','--border':'#D9D9D9','--accent':'#526B57'}}>
          <button onClick={()=>setOpen(true)}>打开设置检查</button>
          <OperationContext.Provider value={operation}>
            {open && <SettingsPanel settings={settings} fonts={[]} dataDirectory="in-memory" version="test" onChange={update} onFonts={()=>{}} onClose={()=>setOpen(false)} onError={console.error} saveState="设置已保存"/>}
          </OperationContext.Provider>
        </div>;
      }
      createRoot(document.getElementById('root')).render(<Fixture/>);
    `,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
});
const css = (
  await Promise.all(
    ['src/styles/app.css', 'src/styles/writing.css'].map((file) => readFile(file, 'utf8')),
  )
).join('\n');
const server = createServer((request, response) => {
  const script = request.url === '/fixture.js';
  const style = request.url === '/app.css';
  response.writeHead(200, {
    'Content-Type': script ? 'text/javascript' : style ? 'text/css' : 'text/html',
  });
  response.end(
    script
      ? bundle.outputFiles[0].text
      : style
        ? css
        : '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

async function checkLayout(page, stage) {
  const geometry = await page.locator('dialog').evaluate((dialog) => {
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: box.height };
    };
    const inside = (element) => {
      const box = element.getBoundingClientRect();
      const outer = dialog.getBoundingClientRect();
      const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
      return (
        box.top >= outer.top &&
        box.bottom <= outer.bottom &&
        (hit === element || element.contains(hit))
      );
    };
    return {
      scrollTop: dialog.scrollTop,
      scrollHeight: dialog.scrollHeight,
      clientHeight: dialog.clientHeight,
      dialog: rect(dialog),
      header: rect(dialog.querySelector('.modal-header')),
      closeVisible: inside(dialog.querySelector('[aria-label="关闭对话框"]')),
      footers: [...dialog.querySelectorAll('.modal-close-guard,.modal-feedback')].map(
        (element) => ({
          rect: rect(element),
          visible: inside(element),
        }),
      ),
      guardButtonsVisible: [...dialog.querySelectorAll('.modal-close-guard button')].every(inside),
    };
  });
  const context = `${stage}: ${JSON.stringify(geometry)}`;
  assert.equal(geometry.scrollTop, 0, `Dialog must not jump-scroll. ${context}`);
  assert.ok(
    geometry.scrollHeight <= geometry.clientHeight + 1,
    `Dialog must not overflow. ${context}`,
  );
  assert.ok(geometry.header.top >= geometry.dialog.top, `Header must stay visible. ${context}`);
  assert.ok(
    geometry.closeVisible && geometry.guardButtonsVisible,
    `Dismissal controls must remain reachable. ${context}`,
  );
  assert.ok(
    geometry.footers.every((footer) => footer.visible),
    `Feedback must remain visible. ${context}`,
  );
  return geometry.scrollTop;
}

let browser;
const errors = [];
const results = [];
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const width of [800, 1000, 600]) {
    const page = await browser.newPage({ viewport: { width, height: 480 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('button', { name: '打开设置检查', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '设置', exact: true });
    const categories = dialog.locator('.settings-categories-toggle');
    if (await categories.isVisible()) await categories.click();
    const navScroll = await dialog.locator('.settings-nav').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return element.scrollTop;
    });
    await dialog
      .locator('.settings-nav')
      .getByRole('button', { name: '外观与主题', exact: true })
      .click();
    await dialog.getByRole('textbox', { name: '方案名称', exact: true }).fill('未提交的主题');
    await page.keyboard.press('Escape');
    await expect(dialog.getByRole('button', { name: '继续编辑', exact: true })).toBeFocused();
    await checkLayout(page, `${width}x480 pending`);
    assert.ok(navScroll > 0, `${width}x480: setting categories must scroll internally`);
    const contentScroll = await dialog.locator('.settings-content').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return element.scrollTop;
    });
    assert.ok(contentScroll > 0, `${width}x480: setting fields must scroll internally`);
    await checkLayout(page, `${width}x480 content scroll`);
    await page.evaluate(() =>
      window.settingsLayoutFixture.setOperation({ busy: '测试操作', notice: null }),
    );
    await expect(dialog.locator('.modal-feedback')).toContainText('测试操作中');
    await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click();
    await expect(dialog.locator('.modal-feedback')).toHaveCount(2);
    await checkLayout(page, `${width}x480 pending plus busy and blocked-close feedback`);
    await page.evaluate(() =>
      window.settingsLayoutFixture.setOperation({
        busy: '',
        notice: { id: 'failure', error: true, message: '测试操作失败，内容仍保留。' },
      }),
    );
    await expect(dialog.locator('.modal-feedback.inline-error')).toContainText('内容仍保留');
    await checkLayout(page, `${width}x480 pending plus failure feedback`);
    await dialog.getByRole('button', { name: '放弃输入并关闭', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    results.push({ width, height: 480, outerScrollTop: 0, navScroll, contentScroll, states: 4 });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ headless: true, errors, results }));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
