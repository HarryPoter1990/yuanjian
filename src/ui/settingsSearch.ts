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
const entries: Array<[Section, string, string, string?]> = [
  ['appearance', '内置配色', '切换苔绿、中性墨灰和暖铜纸色，保留字体与壁纸。'],
  ['appearance', '明暗模式', '使用浅色、深色或跟随系统外观。'],
  ['appearance', '强调色', '调整当前明暗模式的强调颜色。'],
  ['appearance', '背景色', '调整当前明暗模式的背景颜色。'],
  ['appearance', '文字色', '调整当前明暗模式的正文颜色。'],
  ['appearance', '正文字号', '调整笔记正文大小。'],
  ['appearance', '行距', '调整笔记正文行间距。'],
  ['appearance', '正文宽度', '调整写作区域的最大宽度。'],
  ['appearance', '静态壁纸', '选择本地图片，调整透明度、模糊、亮度与填充位置。', '本地图片'],
  ['appearance', '正文底色透明度', '调整壁纸上方正文背景的不透明程度。'],
  ['appearance', '侧栏底色透明度', '调整左右侧栏背景的不透明程度。'],
  ['appearance', '已保存的主题', '保存、复制或切换包含字体和壁纸的完整外观。'],
  ['fonts', '界面字体', '选择菜单、按钮与设置使用的字体。'],
  ['fonts', '正文字体', '选择笔记正文的字体。'],
  ['fonts', '标题字体', '选择 Markdown 标题的字体。'],
  ['fonts', '代码字体', '选择代码块和行内代码的字体。'],
  ['fonts', '导入字体 / ZIP', '搜索、预览、刷新系统字体，或导入字体文件和压缩包。'],
  ['fonts', '可按需下载的开源字体', '查看许可并主动下载，下载后离线使用。'],
  ['editor', '自动保存', '已命名笔记在编辑后写入文件，未命名草稿保留在会话中。'],
  ['editor', '代码字号', '单独调整代码块文字大小。'],
  ['editor', '代码行距', '单独调整代码块的行间距。'],
  ['editor', '代码行号', '控制代码块是否显示行号。'],
  ['editor', '代码自动换行', '长代码换行，或仅在代码块内横向滚动。'],
  ['editor', '代码折叠', '控制代码块的折叠入口。'],
  ['editor', '显示其他文件', '在目录导航中显示笔记和附件以外的文件。'],
  ['editor', '索引排除目录', '每行填写一个目录名，不纳入笔记索引。'],
  ['editor', '附件目录规则', '设置粘贴和导入图片的相对目录，例如 assets。'],
  ['layout', '显示左侧导航', '显示或收起文件、搜索、标签和日历。'],
  ['layout', '显示右侧大纲', '显示或收起大纲、标签和反向引用。'],
  ['layout', '显示编辑工具栏', '显示或隐藏格式操作，编辑模式始终可切换。'],
  ['layout', '显示底部状态栏', '控制字数、行号和自动保存状态的显示。'],
  ['layout', '工具栏按钮', '选择常用格式与更多菜单中的按钮。'],
  ['layout', '应用快捷键', '记录保存、新建、打开、查找、设置和源码模式的组合键。'],
  ['history', '保留天数', '设置历史版本的保留时间。'],
  ['history', '容量上限（MB）', '限制历史文字与去重图片占用的容量。'],
  ['history', '按当前规则清理历史', '查看容量统计并清理过期历史，原笔记和附件保留。'],
  ['templates', '笔记模板', '新增、编辑或删除普通笔记和日周月记模板。'],
  ['templates', '公式片段', '设置补全触发词、LaTeX 内容与启用状态。'],
  ['journal', '日记文件夹', '设置日记、周记和月记的保存目录。'],
  ['journal', '日记命名', '设置年、月、日期目录与文件名规则。'],
  ['journal', '周记命名', '使用年份和周数生成周记路径。'],
  ['journal', '月记命名', '使用年份和月份生成月记路径。'],
  ['journal', '启用周记', '在日历中显示打开或创建周记的入口。'],
  ['journal', '启用月记', '在日历中显示打开或创建月记的入口。'],
];

export function searchSettings(query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return entries
    .map(([section, label, description, target = label]) => ({
      section,
      group: settingsGroups.find((group) => group.id === section)!.label,
      label,
      description,
      target,
    }))
    .filter((item) => {
      const text = `${item.group} ${item.label} ${item.description}`.toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    });
}
