const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const [fixture, entry, report] = process.argv.slice(2);
assert.ok(path.resolve(fixture).startsWith(path.resolve('.test-data') + path.sep));
assert.equal(path.resolve(entry), path.resolve('dist/index.html'));
assert.ok(path.resolve(report).startsWith(path.resolve('artifacts') + path.sep));
app.setPath('userData', path.join(fixture, 'profile'));
app.setPath('sessionData', path.join(fixture, 'profile'));
app.setPath('logs', path.join(fixture, 'logs'));
const watchdog = setTimeout(() => app.exit(2), 25000);
let target,
  everVisible = false;
app
  .whenReady()
  .then(async () => {
    target = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      webPreferences: {
        preload: path.join(fixture, 'preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    target.on('show', () => {
      everVisible = true;
      target.destroy();
      app.exit(1);
    });
    await target.loadFile(entry);
    const details = await target.webContents.executeJavaScript(`(async()=>{
    const wait=async(test)=>{const deadline=Date.now()+12000;while(!test()){if(Date.now()>deadline)throw Error('Built renderer condition timed out');await new Promise(resolve=>setTimeout(resolve,40));}};
    await wait(()=>document.querySelector('.cm-content'));
    await document.fonts.ready;
    const initialGraphRequests=performance.getEntriesByType('resource').filter(item=>item.name.includes('yuanjian-graph')).length;
    document.querySelector('button[aria-label="关系图谱"]').click();
    await wait(()=>document.querySelector('.graph-canvas canvas')&&document.querySelector('.graph-legend')?.textContent.includes('2 个节点'));
    const graphResources=performance.getEntriesByType('resource').filter(item=>item.name.includes('yuanjian-graph')).map(item=>item.name);
    document.querySelector('.tabs-bar [role="tab"]').click();
    await wait(()=>document.querySelector('.cm-content')?.textContent.includes('生成内容'));
    return {protocol:location.protocol,initialGraphRequests,graphResources,bodyPreserved:true,fontsReady:document.fonts.status==='loaded'};
  })()`);
    assert.equal(details.protocol, 'file:');
    assert.equal(details.initialGraphRequests, 0);
    assert.ok(details.graphResources.some((url) => url.includes('yuanjian-graph-engine')));
    assert.equal(details.fontsReady, true);
    assert.equal(target.isVisible(), false);
    fs.writeFileSync(
      report,
      JSON.stringify({ passed: true, everVisible, desktopInputTested: false, ...details }, null, 2),
    );
    target.destroy();
    clearTimeout(watchdog);
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    fs.writeFileSync(
      report,
      JSON.stringify({ passed: false, everVisible, message: String(error.stack) }, null, 2),
    );
    target?.destroy();
    clearTimeout(watchdog);
    app.exit(1);
  });
