const paragraph =
  '这是用于实际编辑验收的长文段落，包含中文、English、标点和 `inlineCode`。正文保存原样，阅读和源码模式可以切换。\n\n';
export const longArticle = Array.from(
  { length: 60 },
  (_, index) => `## 第 ${index + 1} 节\n\n${paragraph.repeat(40)}`,
).join('');
