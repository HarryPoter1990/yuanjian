import type { Settings } from '../shared/types';

export const settingsGroups = [
  { id: 'appearance', label: '外观与主题' },
  { id: 'fonts', label: '字体管理' },
  { id: 'editor', label: '编辑与文件' },
  { id: 'layout', label: '界面与快捷键' },
  { id: 'history', label: '历史与恢复' },
  { id: 'templates', label: '模板与片段' },
  { id: 'journal', label: '日记与周期' },
] as const;
type Section = (typeof settingsGroups)[number]['id'];
const item = (section: Section, label: string, description: string, explain = false) => ({
  section,
  label,
  description,
  explain,
});

// Rendered controls and search share these identities, labels and descriptions.
export const settingDefinitions = {
  palettes: item(
    'appearance',
    '内置配色',
    '配色包含浅色和深色两版，保留字体、壁纸与布局设置。',
    true,
  ),
  mode: item('appearance', '明暗模式', '使用浅色、深色或跟随系统外观。'),
  accent: item('appearance', '强调色', '调整当前明暗模式的强调颜色。'),
  background: item('appearance', '背景色', '调整当前明暗模式的背景颜色。'),
  foreground: item('appearance', '文字色', '调整当前明暗模式的正文颜色。'),
  density: item('appearance', '控件密度', '标准或紧凑，保持标题栏与正文排版独立。'),
  codeTheme: item('appearance', '代码配色', '独立于强调色，按明暗显示代码高亮。'),
  sidebar: item('appearance', '侧栏底色', '高级颜色，自定义左右侧栏。'),
  surface: item('appearance', '控件底色', '高级颜色，自定义按钮与输入框。'),
  muted: item('appearance', '辅助文字', '高级颜色，自定义辅助文字。'),
  border: item('appearance', '分割线', '高级颜色，自定义细分隔线。'),
  selected: item('appearance', '选区底色', '高级颜色，自定义选区与当前项。'),
  fontSize: item('appearance', '正文字号', '调整笔记正文大小。'),
  lineHeight: item('appearance', '行距', '调整笔记正文行间距。'),
  contentWidth: item('appearance', '正文宽度', '调整写作区域的最大宽度。'),
  wallpaper: item('appearance', '本地图片', '选择或移除静态壁纸图片。'),
  wallpaperOpacity: item('appearance', '壁纸透明度', '调整静态壁纸的透明程度。'),
  wallpaperBlur: item('appearance', '模糊', '调整壁纸模糊半径。'),
  wallpaperBrightness: item('appearance', '亮度', '调整壁纸亮度。'),
  wallpaperFit: item('appearance', '壁纸填充', '填满、完整显示或平铺壁纸。'),
  wallpaperPosition: item('appearance', '壁纸位置', '将壁纸居中或对齐边缘。'),
  editorOpacity: item('appearance', '正文底色透明度', '调整壁纸上方正文背景的不透明程度。'),
  sidebarOpacity: item('appearance', '侧栏底色透明度', '调整左右侧栏背景的不透明程度。'),
  themes: item(
    'appearance',
    '外观方案管理',
    '颜色主题与完整外观方案分开管理，保存方案不会应用外观。',
  ),
  themeName: item('appearance', '方案名称', '保存为新方案或更新、重命名当前方案。'),
  uiFont: item('fonts', '界面字体', '菜单、按钮与设置；可搜索并按来源选择。'),
  bodyFont: item('fonts', '正文字体', '笔记里的普通段落；可搜索并按来源选择。'),
  headingFont: item('fonts', '标题字体', '笔记里的 H1–H6 标题；可搜索并按来源选择。'),
  codeFont: item('fonts', '代码字体', '代码块和行内代码；可搜索并按来源选择。'),
  fontImport: item('fonts', '导入字体 / ZIP', '搜索、预览、刷新系统字体，或导入字体文件和压缩包。'),
  fontDownloads: item('fonts', '可按需下载的开源字体', '查看许可并主动下载，下载后离线使用。'),
  autoSave: item(
    'editor',
    '自动保存',
    '已命名笔记在编辑后写入文件，未命名草稿保留在会话中。',
    true,
  ),
  codeFontSize: item('editor', '代码字号', '单独调整代码块文字大小。'),
  codeLineHeight: item('editor', '代码行距', '单独调整代码块的行间距。'),
  codeLineNumbers: item('editor', '代码行号', '控制代码块是否显示行号。'),
  codeWrap: item('editor', '代码自动换行', '长代码换行，或仅在代码块内横向滚动。'),
  codeFold: item('editor', '代码折叠', '控制代码块的折叠入口。'),
  showAllFiles: item('editor', '显示其他文件', '默认目录仅展示笔记、附件与相关子目录。', true),
  excluded: item('editor', '索引排除目录', '每行一个目录名，修改会自动保存。', true),
  attachmentPattern: item('editor', '附件目录规则', '相对笔记所在目录，如 assets。', true),
  leftVisible: item('layout', '显示左侧导航', '显示或收起文件、搜索、标签和日历。'),
  rightVisible: item('layout', '显示右侧大纲', '显示或收起大纲、标签和反向引用。'),
  toolbarVisible: item('layout', '显示编辑工具栏', '显示或隐藏格式操作，编辑模式始终可切换。'),
  statusVisible: item('layout', '显示底部状态栏', '控制字数、行号和自动保存状态的显示。'),
  toolbarButtons: item('layout', '工具栏按钮', '选择常用格式与更多菜单中的按钮。'),
  shortcuts: item('layout', '应用快捷键', '记录保存、新建、打开、查找、设置和源码模式的组合键。'),
  historyDays: item('history', '保留天数', '设置历史版本的保留时间。'),
  historyLimitMB: item('history', '容量上限（MB）', '限制历史文字与去重图片占用的容量。'),
  historyPrune: item(
    'history',
    '按当前规则清理历史',
    '查看容量统计并清理过期历史，原笔记和附件保留。',
  ),
  templates: item('templates', '笔记模板', '新增、编辑或删除普通笔记和日周月记模板。'),
  templateName: item('templates', '模板名称', '修改当前选择的模板名称。'),
  templateKind: item('templates', '用途', '将模板用于普通笔记、日记、周记或月记。'),
  templateContent: item('templates', '模板正文', '编辑 Markdown 模板及日期、标题变量。'),
  snippets: item('templates', '公式片段', '设置补全触发词、LaTeX 内容与启用状态。'),
  journalDirectory: item('journal', '日记文件夹', '设置日记、周记和月记的保存目录。'),
  dailyPattern: item('journal', '日记命名', '设置年、月、日期目录与文件名规则。'),
  weeklyPattern: item('journal', '周记命名', '使用年份和周数生成周记路径。'),
  monthlyPattern: item('journal', '月记命名', '使用年份和月份生成月记路径。'),
  weeklyEnabled: item('journal', '启用周记', '在日历中显示打开或创建周记的入口。'),
  monthlyEnabled: item('journal', '启用月记', '在日历中显示打开或创建月记的入口。'),
};
export type SettingId = keyof typeof settingDefinitions;
export const shortcutLabels: Record<string, string> = {
  fullSearch: '跨文件搜索',
  focusNext: '聚焦下一区域',
  focusPrevious: '聚焦上一区域',
  save: '保存',
  new: '新建',
  open: '打开',
  find: '查找',
  replace: '替换',
  quickOpen: '快速打开',
  reopen: '重开关闭笔记',
  back: '后退',
  forward: '前进',
  settings: '设置',
  mode: '切换源码',
};
export const shortcutSetting = (action: string) => ({
  id: `shortcut-${action}`,
  ...item(
    'layout',
    `${shortcutLabels[action] || action}快捷键`,
    '录制组合键、核对冲突或恢复此项默认。',
  ),
});
export const snippetSetting = (index: number, part: 'trigger' | 'body' | 'enabled') => ({
  id: `snippet-${index}-${part}`,
  ...item(
    'templates',
    `片段 ${index + 1} ${{ trigger: '触发词', body: '内容', enabled: '启用' }[part]}`,
    '编辑当前公式补全片段。',
  ),
});

export function settingsItems(settings?: Settings) {
  return [
    ...Object.entries(settingDefinitions).map(([id, value]) => ({ id, ...value })),
    ...Object.keys(settings?.shortcuts || shortcutLabels).map(shortcutSetting),
    ...(settings?.snippets || []).flatMap((_, index) =>
      (['trigger', 'body', 'enabled'] as const).map((part) => snippetSetting(index, part)),
    ),
  ];
}
