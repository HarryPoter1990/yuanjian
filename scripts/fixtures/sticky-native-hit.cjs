const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { app, BrowserWindow } = require('electron');

const [fixture, report] = process.argv.slice(2);
assert.ok(path.resolve(fixture).startsWith(path.resolve('.test-data') + path.sep));
assert.ok(path.resolve(report).startsWith(path.resolve('artifacts') + path.sep));
app.setPath('userData', path.join(fixture, 'profile'));
app.setPath('sessionData', path.join(fixture, 'profile'));
app.setPath('logs', path.join(fixture, 'logs'));
const timeout = setTimeout(() => app.exit(2), 25000);
let target;
const samples = [];

async function collectGeometry() {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const header = document.querySelector('.sticky-header');
  const grip = header.querySelector('.sticky-drag-handle');
  if (!grip) throw new Error('Missing sticky drag handle');
  const point = (name, element, fraction = 0.5) => {
    const rect = element.getBoundingClientRect();
    return { name, x: rect.left + rect.width / 2, y: rect.top + rect.height * fraction };
  };
  return {
    width: innerWidth,
    height: innerHeight,
    errors: window.fixtureErrors,
    points: [
      point('grip-top', grip, 0.2),
      point('grip-middle', grip),
      point('grip-bottom', grip, 0.8),
      point('title', header.querySelector('.sticky-title')),
      point('pin', header.querySelector('[aria-label="便笺始终置顶"]')),
      point('return', header.querySelector('[aria-label="返回完整窗口"]')),
      point('menu', header.querySelector('[aria-label="便笺更多操作"]')),
      point('body', document.querySelector('#native-fixture-body')),
    ],
  };
}

function nativeHits(window, geometry) {
  const bytes = window.getNativeWindowHandle();
  const handle = bytes.length === 8 ? bytes.readBigUInt64LE() : BigInt(bytes.readUInt32LE());
  const payload = Buffer.from(JSON.stringify(geometry)).toString('base64');
  const script = fs.readFileSync(path.join(__dirname, 'sticky-native-hit.ps1'), 'utf8');
  const command = `$OwnWindowHandle=${handle};$ExpectedProcess=${process.pid};$FixtureGeometry='${payload}';\n${script}`;
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(`${error.message}\n${stderr}`));
        try {
          resolve(JSON.parse(stdout));
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}

app
  .whenReady()
  .then(async () => {
    target = new BrowserWindow({
      show: false,
      x: 400,
      y: 300,
      width: 420,
      height: 640,
      titleBarStyle: 'hidden',
      titleBarOverlay: { height: 44 },
      thickFrame: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    target.on('show', () => {
      console.error('Native hit fixture must never be visible');
      target.destroy();
      app.exit(1);
    });
    await target.loadFile(path.join(fixture, 'index.html'));
    for (const width of [420, 320]) {
      target.setBounds({ x: 400, y: 300, width, height: 640 });
      const geometry = await target.webContents.executeJavaScript(
        `(${collectGeometry.toString()})()`,
      );
      assert.equal(target.isVisible(), false);
      assert.deepEqual(geometry.errors, []);
      // Let Chromium deliver the current draggable regions to its own native window.
      await new Promise((resolve) => setTimeout(resolve, 120));
      const hits = await nativeHits(target, geometry);
      for (const hit of hits) {
        assert.equal(hit.owner, process.pid);
        assert.equal(hit.visible, false);
        assert.equal(hit.callSucceeded, true);
        assert.equal(hit.hit, hit.name.startsWith('grip-') ? 2 : 1, `${width}px ${hit.name}`);
      }
      assert.equal(hits.length, geometry.points.length);
      assert.equal(target.isVisible(), false);
      samples.push({ width, rendererWidth: geometry.width, hits });
    }
    fs.writeFileSync(
      report,
      JSON.stringify(
        {
          checked: true,
          visibleWindowShown: false,
          actualMouseDragTested: false,
          fixture: 'Actual StickyHeader and application CSS; independent in-memory note',
          samples,
        },
        null,
        2,
      ),
    );
    clearTimeout(timeout);
    target.destroy();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    clearTimeout(timeout);
    if (target && !target.isDestroyed()) target.destroy();
    app.exit(1);
  });
