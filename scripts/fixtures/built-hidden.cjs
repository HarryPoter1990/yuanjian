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
    // file:// requests are omitted from Resource Timing in this Electron build.
    // Observe actual protocol requests through CDP instead of treating an empty timing list as evidence.
    const requests = [];
    await target.loadURL('about:blank');
    target.webContents.debugger.attach('1.3');
    target.webContents.debugger.on('message', (_event, method, params) => {
      if (method === 'Network.requestWillBeSent') requests.push(params.request.url);
    });
    await target.webContents.debugger.sendCommand('Network.enable');
    await target.loadFile(entry);
    await target.webContents.executeJavaScript(`(async()=>{
      const deadline=Date.now()+12000;
      while(!document.querySelector('.cm-content')) {if(Date.now()>deadline)throw Error('Built editor timed out');await new Promise(resolve=>setTimeout(resolve,40));}
      await document.fonts.ready;
    })()`);
    const initialGraphRequests = requests.filter((url) => url.includes('yuanjian-graph')).length;
    const details = await target.webContents.executeJavaScript(`(async()=>{
    const wait=async(test)=>{const deadline=Date.now()+12000;while(!test()){if(Date.now()>deadline)throw Error('Built renderer condition timed out');await new Promise(resolve=>setTimeout(resolve,40));}};
    await wait(()=>document.querySelector('.cm-content'));
    await document.fonts.ready;
    document.querySelector('button[aria-label="关系图谱"]').click();
    await wait(()=>document.querySelector('.graph-canvas canvas')&&document.querySelector('.graph-legend')?.textContent.includes('2 个节点'));
    document.querySelector('.tabs-bar [role="tab"]').click();
    await wait(()=>document.querySelector('.cm-content')?.textContent.includes('生成内容'));
    document.querySelector('button[aria-label="打开设置"]').click();
    await wait(()=>document.querySelector('.settings-nav'));
    [...document.querySelectorAll('.settings-nav button')].find(button=>button.textContent.includes('字体管理')).click();
    await wait(()=>document.querySelector('button[aria-label="正文字体"]'));
    document.querySelector('button[aria-label="正文字体"]').click();
    await wait(()=>document.querySelector('.font-picker-panel')?.matches(':popover-open'));
    const input=document.querySelector('input[aria-label="搜索正文字体"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Generated System Font');
    input.dispatchEvent(new Event('input',{bubbles:true}));
    await wait(()=>[...document.querySelectorAll('.font-option-name')].some(node=>node.textContent==='Generated System Font'));
    [...document.querySelectorAll('.font-option-name')].find(node=>node.textContent==='Generated System Font').closest('[role="option"]').click();
    await wait(()=>!document.querySelector('.font-picker-panel')&&document.querySelector('button[aria-label="正文字体"]').textContent.includes('Generated System Font'));
    document.querySelector('button[aria-label="关闭对话框"]').click();
    await wait(()=>!document.querySelector('.settings-layout'));
    await wait(()=>!document.querySelector('.app').style.getPropertyValue('--body-font').includes('Generated System Font'));
    document.querySelector('button[aria-label="打开设置"]').click();
    await wait(()=>document.querySelector('select[aria-label="明暗模式"]'));
    const mode=document.querySelector('select[aria-label="明暗模式"]');
    mode.value='dark';mode.dispatchEvent(new Event('change',{bubbles:true}));
    await wait(()=>document.querySelector('.app').dataset.theme==='dark');
    [...document.querySelectorAll('button')].find(button=>button.textContent==='应用外观').click();
    await wait(()=>document.querySelector('.settings-feedback')?.textContent.includes('外观已应用'));
    const stored=await window.notes.bootstrap();
    if(stored.settings.appearance.mode!=='dark')throw Error('Appearance apply not committed');
    document.querySelector('button[aria-label="关闭对话框"]').click();
    await wait(()=>!document.querySelector('.settings-layout'));
    if(document.querySelector('.app').dataset.theme!=='dark')throw Error('Applied appearance reverted on close');
    return {protocol:location.protocol,bodyPreserved:true,fontsReady:document.fonts.status==='loaded',fontPickerVerified:true,appearanceCancelVerified:true,appearanceApplyVerified:true};
  })()`);
    details.initialGraphRequests = initialGraphRequests;
    details.graphResources = requests.filter((url) => url.includes('yuanjian-graph'));
    assert.equal(details.protocol, 'file:');
    assert.equal(details.initialGraphRequests, 0);
    assert.ok(details.graphResources.some((url) => url.includes('yuanjian-graph-engine')));
    assert.equal(details.fontsReady, true);
    assert.equal(details.fontPickerVerified, true);
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
