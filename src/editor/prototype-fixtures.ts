import type { RenderOptions } from './types';

export const syntaxExamples = {
  提示与重点:
    '# 把知识讲清楚\n\n> [!info] 接口是什么\n> 接口描述一组行为，具体实现由类完成。\n> 把 ==约定== 与实现分开，有助于理解多态。\n\n> [!warning]- 容易混淆的地方\n> 实现接口不等于继承实现。\n>\n> > [!tip]+ 怎么记忆\n> > 先想“能做什么”，再想“怎样做到”。\n\n水的分子式是 H~2~O，面积可以记为 x^2^。\n\n这里有一处注释 %%整理时再补一个生活中的例子%%，阅读和导出时隐藏。\n\n<details>\n<summary>展开课后练习</summary>\n\n- [ ] 写一个自己的接口\n- [ ] 试着交换两个实现\n\n</details>\n\n从这里继续写。',
  目录与引用:
    '# 学习记录\n\n[TOC]\n\n## 今天的理解\n\n接口是一份行为契约。 ^contract\n\n用 [[#^contract|这一段]] 回到定义，也可以阅读 [[接口.md#定义|完整笔记]]。\n\n## 另一篇笔记的内容\n\n![[接口.md#^definition]]\n\n## 学习流程图\n\n![[学习流程.png|480]]\n\n## 补充说明\n\n这段文字有一条脚注[^补充]。\n\n[^补充]: 示例内容只用于试写，不读取你的真实笔记。\n\n继续记录。',
  常用语法对照:
    '另一种一级标题\n=============\n\n**重点**、*补充*、~~已作废~~、`行内代码`、==待复习==。\n\n> - [ ] 引用中的任务\n> - [x] 已完成的任务\n\n网址 <https://example.com>，邮件 <study@example.com>，以及 https://example.com。\n\n\\*这里的星号不是斜体\\*，A &amp; B。\n\n![学习流程](学习流程.png "先记录，再理解，最后应用")\n\n<u>下划线</u>，上标 x<sup>2</sup>，下标 H<sub>2</sub>O。<br>这里换行。\n\n<!--这一段只在源码里保留-->\n\n继续自由输入。',
};

export const fixtureNotes: Record<string, string> = {
  '接口.md':
    '# 接口与多态\n\n## 定义\n\n接口是一份行为契约，实现类负责提供具体行为。 ^definition\n\n## 一个例子\n\n```java\ninterface Shape {\n    double area();\n}\n```\n\n可以从 [[目录与引用.md|学习记录]] 回到示例。',
  '循环示例.md': '# 循环引用示例\n\n![[循环示例.md]]',
};

export function resolveFixtureNote(
  reference: string,
  from: string,
  notes: ReadonlyMap<string, string>,
): ReturnType<NonNullable<RenderOptions['resolveNote']>> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(reference).replace(/\\/g, '/');
  } catch {
    return { error: `笔记路径编码无效：${reference}` };
  }
  if (!decoded) decoded = from;
  const normalize = (path: string) => {
    const parts: string[] = [];
    for (const part of path.split('/')) {
      if (part === '..') parts.pop();
      else if (part && part !== '.') parts.push(part);
    }
    return parts.join('/');
  };
  const full = normalize(/\.md$/i.test(decoded) ? decoded : decoded + '.md');
  const relative = normalize(from.split('/').slice(0, -1).concat(full).join('/'));
  const keys = [...notes.keys()];
  const match = (key: string, value: string) =>
    key.toLocaleLowerCase() === value.toLocaleLowerCase();
  const exact = keys.find((key) => match(key, relative)) ?? keys.find((key) => match(key, full));
  const candidates = exact ? [exact] : keys.filter((key) => match(key.split('/').at(-1)!, full));
  if (candidates.length !== 1)
    return {
      error: candidates.length
        ? `同名笔记不止一份，请填写完整路径：${reference}`
        : `演示笔记中找不到：${reference}`,
    };
  return { path: candidates[0], source: notes.get(candidates[0])! };
}

let fixtureImage: string | undefined;
export function resolveFixtureAsset(reference: string): string {
  if (!/(?:^|\/)学习流程\.png$/.test(reference)) return '';
  if (fixtureImage) return fixtureImage;
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 280;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#f3f0e9';
  ctx.fillRect(0, 0, 960, 280);
  ctx.font = '32px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ['记录', '理解', '应用'].forEach((text, i) => {
    ctx.fillStyle = '#e2dacc';
    ctx.fillRect(50 + i * 320, 70, 220, 140);
    ctx.fillStyle = '#443d34';
    ctx.fillText(text, 160 + i * 320, 140);
    if (i < 2) ctx.fillText('→', 320 + i * 320, 140);
  });
  fixtureImage = canvas.toDataURL('image/png');
  return fixtureImage;
}

export const syntaxInsertions = [
  { label: '信息提示块', text: '> [!info] 提示\n> 补充说明', select: '补充说明', block: true },
  { label: '折叠提示块', text: '> [!tip]- 展开查看\n> 补充说明', select: '补充说明', block: true },
  { label: '高亮', text: '==重点==', select: '重点', block: false },
  { label: '上标', text: '^2^', select: '2', block: false },
  { label: '下标', text: '~2~', select: '2', block: false },
  { label: '隐藏注释', text: '%%补充备注%%', select: '补充备注', block: false },
  { label: '文章目录', text: '[TOC]', select: '', block: true },
  { label: '图片嵌入', text: '![[学习流程.png|480]]', select: '480', block: true },
  { label: '笔记嵌入', text: '![[接口.md#定义]]', select: '接口.md#定义', block: true },
  { label: '段落嵌入', text: '![[接口.md#^definition]]', select: 'definition', block: true },
  {
    label: '可折叠区域',
    text: '<details>\n<summary>展开查看</summary>\n\n补充说明\n\n</details>',
    select: '补充说明',
    block: true,
  },
  { label: '脚注', text: '正文[^注]\n\n[^注]: 补充说明', select: '补充说明', block: true },
];
