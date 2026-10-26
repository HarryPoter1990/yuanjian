declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';
  export const gfm: TurndownService.Plugin;
  export const tables: TurndownService.Plugin;
  export const strikethrough: TurndownService.Plugin;
  export const taskListItems: TurndownService.Plugin;
}
// Match the ESM markdown-it types used by the application; upstream @types selects its CJS copy.
declare module 'markdown-it-footnote' {
  import type MarkdownIt from 'markdown-it';
  export default function footnote(md: MarkdownIt): void;
}
