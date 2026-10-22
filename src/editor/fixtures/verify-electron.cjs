const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1180,
    height: 980,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  await window.loadURL(process.env.EDITOR_TEST_URL);
});
app.on('window-all-closed', () => app.quit());
