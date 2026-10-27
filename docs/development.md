# 开发

鸢笺使用 TypeScript、React、CodeMirror 6 和 Electron，Windows 安装包由 electron-builder 与 NSIS 构建。

## 环境

- Windows
- Node.js 22.12+ 与 npm
- 首次安装依赖时需要能够下载 Electron

```powershell
npm ci
npm run dev
```

开发版配置保存在 `.test-data/dev-profile`，与正式版分开。

## 构建与测试

```powershell
npm run typecheck
npm run test:headless
npm run build
```

`npm run verify` 按顺序运行以上三项检查。`npm run package` 通过检查后，在 `release/` 中生成 Windows x64 安装包。

`npm test` 和 `npm run test:e2e` 包含 Electron 窗口测试。专项界面检查命令见 `package.json`；部分脚本需要 Edge，或需要先执行 `npm run build`。

联网端到端测试默认关闭，设置 `LOCAL_NOTES_ONLINE_TEST=1` 后会下载测试字体和公共测试图片。测试文件与运行输出分别位于 `.test-data/` 和 `artifacts/`，不提交到仓库。

## 代码目录

- `src/editor`：编辑器、即时排版、公式、表格与剪贴板转换。
- `src/components`、`src/App.tsx`、`src/ui`：界面、设置与工作区状态。
- `src/shared`：接口、配色、默认设置与 Markdown 解析。
- `electron/storage`：文件访问、保存、历史、附件与文件移动。
- `electron/resources`：字体与导出。
- `electron/main.ts`：窗口与 IPC。
- `tests`、`e2e`、`scripts/fixtures`：测试与夹具。

## 打包

程序归档包含 `dist`、`dist-electron` 和运行清单；依赖与字体的许可声明在构建时生成。用户数据、开发依赖、测试输出和日志不进入程序归档。

安装包通过 GitHub Releases 发布，同时提供 SHA-256 校验文件。当前未配置代码签名或自动更新。可使用 PowerShell 的 `Get-AuthenticodeSignature` 检查安装包签名状态。

## 提交修改

请说明修改目的、复现步骤及测试方法。界面修改可附截图；示例和日志中的个人信息请先去除。源码格式可使用 `npm run format` 统一整理。
