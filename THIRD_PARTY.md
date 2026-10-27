# 第三方组件与素材

项目根目录的 MIT License 用于本项目原创源码。第三方组件、字体、图标和其他素材保留各自的版权与许可，不因本项目的 MIT 许可而改授。

- **Fluent System Icons**：`public/icons/` 中的图标来自微软的开源项目，适用 MIT；许可全文见 [LICENSE.txt](public/icons/LICENSE.txt)，来源及校验值见 [SOURCES.json](public/icons/SOURCES.json)。使用开源图标不表示获得微软产品标志或商标的授权。
- **字体**：内置 Inter、Noto Sans SC、Noto Serif SC 和 JetBrains Mono，分别保留上游字体许可。运行时依赖和字体许可由 `scripts/licenses.mjs` 从锁定的已安装依赖生成，产物位于 `dist/licenses/THIRD-PARTY-NOTICES.txt`；Electron/Chromium 的许可随发行包提供。自行下载或导入的字体不在源码仓库中。
- **应用标识图片**：紫色鸢尾标识由维护者使用 AI 生成，原图为 `public/yuanjian.png`，适配图为 `public/app-icon.png` 和 `build/icon.ico`。这些图片作为项目品牌素材保留，不纳入源码的 MIT 授权；复用源码制作其他产品时，请使用自己的名称与标识，或另行取得相应许可。

不要从本仓库的许可证推断第三方软件与本项目有合作、背书或兼容承诺。再分发构建产物时应同时保留项目许可证和相关第三方声明。
