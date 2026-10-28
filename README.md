# 鸢笺 · Yuanjian

鸢笺是一款本地 Markdown 编辑器，支持即时排版、文件管理和桌面便笺。

打开已有笔记即可开始写作，多个目录共用一套设置。写长文时可以收起侧栏，临时记事时可以切换到置顶的小便笺。笔记保存在你选择的位置，字体和配色也可以按自己的习惯调整。

**Windows x64 · 预览版 0.11.2 · MIT**

[下载](https://github.com/HarryPoter1990/yuanjian/releases/tag/v0.11.2) · [使用说明](docs/usage.md) · [反馈问题](https://github.com/HarryPoter1990/yuanjian/issues) · [更新记录](CHANGELOG.md)

## 功能

- 即时排版、源码、阅读和源码对照模式，支持专注写作。
- 多标签拖动排序，文件目录、大纲、标签、日历和搜索。
- 代码高亮、数学公式、表格、任务列表、脚注与 Mermaid 图表。
- 图文和表格粘贴，支持 HTML、CSV/TSV 导入。
- 可移动、调整大小和置顶的桌面便笺。
- 自动保存、草稿恢复、历史版本和外部修改冲突提示。
- 八套明暗配色，可调整字体、行距、行宽和壁纸。
- PDF、HTML，以及包含本地图片的 Markdown ZIP 导出。

## 下载与开始使用

在 [0.11.2 下载页](https://github.com/HarryPoter1990/yuanjian/releases/tag/v0.11.2) 的 **Assets** 中下载 `Yuanjian-Setup-0.11.2-x64.exe`。同页的 `SHA256SUMS.txt` 可用于核对文件完整性。“Source code” 是源码归档，安装软件请选择 `.exe` 文件。

目前提供 Windows x64 安装包，尚未签名，暂不支持自动更新。

安装后，按 `Ctrl+O` 打开 `.md` 或 `.txt` 文件，或按 `Ctrl+N` 新建笔记，再按 `Ctrl+S` 保存。也可以添加多个目录，在左侧浏览文件；移除目录入口不会删除其中的文件。

常用快捷键：

- `Ctrl+P`：快速打开笔记。
- `Ctrl+F` / `Ctrl+H`：查找 / 替换。
- `Ctrl+Shift+F`：跨笔记搜索。
- `Ctrl+Tab` / `Ctrl+Shift+Tab`：切换标签。
- `Ctrl+Shift+T`：重开最近关闭的已命名笔记。
- `Ctrl+Shift+M`：切换即时排版与源码。
- `Ctrl+,`：打开设置。
- `Alt+←` / `Alt+→`：回退 / 前进到阅读位置。

## 文件与数据

笔记以普通文件保存在你选择的位置。设置、草稿、历史和字体等默认保存在 `%APPDATA%/鸢笺`，可从程序设置中打开该目录。自动保存和历史版本之外，重要内容仍建议单独备份。

本地编辑无需登录账号。下载字体、显示远程图片或打开网页链接时，会访问相应网站。保存、恢复与旧版数据迁移的具体操作见 [使用说明](docs/usage.md)。

## 目前的限制

暂不支持 Obsidian 插件、云同步、白板和动态壁纸。公式使用 KaTeX 渲染，不支持完整的 `.tex` 文档编译。

当前版本仍处于预览阶段，重要笔记请保留独立备份。

## 开发

需要 Windows、Node.js 22.12+ 和 npm。

```powershell
npm ci
npm run dev
```

构建、打包、测试及代码目录说明见 [开发文档](docs/development.md)。

## 反馈与贡献

遇到问题或有功能建议，可以提交 [Issue](https://github.com/HarryPoter1990/yuanjian/issues)。请附上软件版本、Windows 版本和复现步骤；如果方便，也可以提供示例文件或截图。上传前请去除个人信息，不要附带账户凭据。

欢迎提交 Pull Request。涉及安全漏洞的问题，请参照 [安全反馈说明](SECURITY.md)。

## 许可证

源码采用 [MIT License](LICENSE)。第三方依赖、字体和图标保留各自许可；应用标识作为品牌素材单独说明，不纳入源码的 MIT 授权。详见 [第三方与素材说明](THIRD_PARTY.md)。
