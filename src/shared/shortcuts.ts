export function shortcutKey(value: string): string {
  const parts = value
    .toLocaleLowerCase()
    .split('+')
    .map((part) => part.trim());
  const key = parts.pop();
  if (
    !key ||
    parts.some((part) => !['ctrl', 'alt', 'shift'].includes(part)) ||
    new Set(parts).size !== parts.length
  )
    return '';
  if (
    !/^(?:[^\s]|f(?:[1-9]|1\d|2[0-4])|arrow(?:left|right|up|down)|enter|escape|backspace|delete|home|end|pageup|pagedown|tab|insert|plus|space)$/u.test(
      key,
    )
  )
    return '';
  if (!parts.includes('ctrl') && !parts.includes('alt') && !/^f(?:[1-9]|1\d|2[0-4])$/.test(key))
    return '';
  return [...['ctrl', 'alt', 'shift'].filter((part) => parts.includes(part)), key].join('+');
}
const fixed: Record<string, string> = {
  'Ctrl+w': '关闭当前笔记',
  'Ctrl+Tab': '切换标签',
  'Ctrl+Shift+Tab': '反向切换标签',
  'Ctrl+c': '复制',
  'Ctrl+x': '剪切',
  'Ctrl+v': '粘贴',
  'Ctrl+Shift+v': '纯文本粘贴',
  'Ctrl+a': '全选',
  'Ctrl+z': '撤销',
  'Ctrl+Shift+z': '重做',
  'Ctrl+y': '重做',
  'Ctrl+b': '粗体',
  'Ctrl+i': '斜体',
  'Ctrl+ArrowLeft': '按词移动',
  'Ctrl+ArrowRight': '按词移动',
  'Ctrl+Shift+ArrowLeft': '按词选择',
  'Ctrl+Shift+ArrowRight': '按词选择',
  'Ctrl+Backspace': '按词删除',
  'Ctrl+Delete': '按词删除',
  'Ctrl+Home': '移动到文档开头',
  'Ctrl+End': '移动到文档结尾',
  'Ctrl+Shift+Home': '选择到文档开头',
  'Ctrl+Shift+End': '选择到文档结尾',
};
export function shortcutConflicts(
  bindings: Record<string, string>,
  action: string,
  value: string,
): { action: string; label: string; fixed: boolean }[] {
  const key = shortcutKey(value);
  if (!key) return [];
  return [
    ...Object.entries(fixed)
      .filter(([binding]) => shortcutKey(binding) === key)
      .map(([, label]) => ({ action: '', label, fixed: true })),
    ...Object.entries(bindings)
      .filter(([other, binding]) => other !== action && shortcutKey(binding) === key)
      .map(([other]) => ({ action: other, label: other, fixed: false })),
  ];
}
