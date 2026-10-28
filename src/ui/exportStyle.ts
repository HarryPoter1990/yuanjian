import { syntaxColors } from '../shared/appearance';
import type { Appearance } from '../shared/types';
interface ExportStyleOptions {
  surface?: string;
  border?: string;
  muted?: string;
  codeTheme?: Appearance['codeTheme'];
  dark?: boolean;
}
export function exportCanvasStyle(
  background: string,
  foreground: string,
  options: ExportStyleOptions = {},
): string {
  // The injected desktop :root paints beyond body content, so reset the root canvas too.
  const variables = {
    '--background': background,
    '--foreground': foreground,
    '--surface': options.surface ?? '#efefec',
    '--border': options.border ?? '#ccd3cf',
    '--muted': options.muted ?? '#666',
    ...syntaxColors(options.codeTheme, options.dark ?? false),
  };
  return `html:root,body{height:auto;overflow:visible;background:${background};color:${foreground}}body{${Object.entries(
    variables,
  )
    .map(([key, value]) => `${key}:${value}`)
    .join(';')}}article.markdown-rendered{color:${foreground}}`;
}
