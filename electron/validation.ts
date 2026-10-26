import { z } from 'zod';

const text = z.string().max(64 * 1024 * 1024);
const file = z.string().min(1).max(32768);
const short = z.string().max(1024);
const number = z.number().finite();
const paletteId = z.enum(['ink', 'moss', 'paper']);
const colorOverrides = z.object(
  Object.fromEntries(
    ['background', 'foreground', 'accent', 'sidebar', 'surface', 'muted', 'border', 'selected'].map(
      (key) => [key, short.optional()],
    ),
  ),
);
const template = z.object({
  id: short,
  name: short,
  kind: z.enum(['note', 'daily', 'weekly', 'monthly']),
  content: text,
});
const appearance = z.object({
  density: z.enum(['standard', 'compact']).optional(),
  codeTheme: z.enum(['classic', 'calm', 'contrast']).optional(),
  colorThemeId: short.optional(),
  schemeId: short.optional(),
  paletteByMode: z.object({ light: paletteId.optional(), dark: paletteId.optional() }).optional(),
  mode: z.enum(['light', 'dark', 'system']),
  palette: z.enum(['ink', 'moss', 'paper']).optional(),
  paletteOverrides: z
    .object({
      light: colorOverrides.optional(),
      dark: colorOverrides.optional(),
    })
    .optional(),
  accent: short,
  background: short,
  foreground: short,
  uiFont: short,
  bodyFont: short,
  codeFont: short,
  headingFont: short,
  fontSize: number.min(8).max(72),
  codeFontSize: number.min(8).max(72).optional(),
  codeLineHeight: number.min(1).max(4).optional(),
  lineHeight: number.min(1).max(4),
  contentWidth: number.min(300).max(4000),
  wallpaper: z.string().max(32768),
  wallpaperOpacity: number.min(0).max(1),
  wallpaperBlur: number.min(0).max(100),
  wallpaperBrightness: number.min(0).max(3),
  wallpaperFit: z.enum(['cover', 'contain', 'repeat']),
  wallpaperPosition: short,
  editorOpacity: number.min(0).max(1),
  sidebarOpacity: number.min(0).max(1).optional(),
});
export const settingsSchema = z.object({
  roots: z.array(file).max(100),
  excluded: z.array(short).max(300),
  showAllFiles: z.boolean(),
  autoSave: z.boolean(),
  leftVisible: z.boolean(),
  rightVisible: z.boolean(),
  leftWidth: number.min(120).max(1000),
  rightWidth: number.min(120).max(1000),
  rightGroups: z.record(short, z.boolean()).optional(),
  toolbarVisible: z.boolean(),
  toolbarButtons: z.array(short).max(100),
  statusVisible: z.boolean(),
  appearance,
  themes: z
    .array(
      z.object({
        id: short,
        name: short,
        appearance,
        includes: z
          .object({ colors: z.boolean(), fonts: z.boolean(), wallpaper: z.boolean() })
          .optional(),
      }),
    )
    .max(500),
  colorThemes: z
    .array(
      z.object({
        id: short,
        name: short,
        appearance: appearance.pick({
          palette: true,
          paletteByMode: true,
          paletteOverrides: true,
          accent: true,
          background: true,
          foreground: true,
          density: true,
          codeTheme: true,
        }),
      }),
    )
    .max(500)
    .optional(),
  codeLineNumbers: z.boolean(),
  codeWrap: z.boolean(),
  codeFold: z.boolean(),
  attachmentPattern: short,
  historyDays: number.min(1).max(36500),
  historyLimitMB: number.min(1).max(1024000),
  journalDirectory: z.string().max(32768),
  dailyPattern: short,
  weeklyPattern: short,
  monthlyPattern: short,
  weeklyEnabled: z.boolean(),
  monthlyEnabled: z.boolean(),
  templates: z.array(template).max(1000),
  snippets: z
    .array(z.object({ trigger: short, body: z.string().max(100000), enabled: z.boolean() }))
    .max(5000),
  shortcuts: z.record(z.string().max(100), z.string().max(100)),
  treeCollapsed: z.array(file).max(100000).optional(),
  graph: z.object({
    local: z.boolean(),
    depth: number.int().min(1).max(10),
    tags: z.boolean(),
    attachments: z.boolean(),
    root: z.string().max(32768),
    tag: short,
    positions: z
      .record(z.string().max(32768), z.object({ x: number, y: number }))
      .refine((value) => Object.keys(value).length <= 100000),
    zoom: number.min(0.001).max(100),
    pan: z.object({ x: number, y: number }),
  }),
});
const tab = z.object({
  importSourceId: z.string().min(1).max(200).optional(),
  id: file,
  path: file.nullable(),
  title: short,
  content: text,
  hash: short,
  modifiedAt: number,
  baseContent: text,
  dirty: z.boolean(),
  cursor: number.int().min(0),
  scrollTop: number.min(0),
  mode: z.enum(['live', 'source']),
});
export const sessionSchema = z.object({
  tabs: z.array(tab).max(200),
  activeId: file.nullable(),
  viewOrder: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('note'), id: file }).strict(),
        z.object({ kind: z.literal('graph') }).strict(),
      ]),
    )
    .max(201)
    .optional(),
  graphActive: z.boolean().optional(),
});

const opaqueHexColor = z.string().regex(/^#[\da-f]{6}$/i);
export const windowThemeSchema = z
  .object({ background: opaqueHexColor, foreground: opaqueHexColor })
  .strict();

export const argumentSchemas = {
  prepareFiles: z.tuple([z.array(file).min(1).max(100)]),
  chooseImports: z.tuple([]),
  readImport: z.tuple([
    z.string().min(1).max(200),
    z.enum(['utf-8', 'gb18030', 'utf-16le', 'utf-16be']),
  ]),
  importAssetUrl: z.tuple([z.string().min(1).max(200), z.string().min(1).max(32768)]),
  centerWindow: z.tuple([]),
  getWindowMode: z.tuple([]),
  setWindowMode: z.tuple([z.enum(['full', 'sticky'])]),
  setStickyPinned: z.tuple([z.boolean()]),
  bootstrap: z.tuple([]),
  setWindowTheme: z.tuple([windowThemeSchema]),
  saveSettings: z.tuple([settingsSchema]),
  saveSession: z.tuple([sessionSchema]),
  openFile: z.tuple([file.optional()]),
  openLinkedFile: z.tuple([file, z.string().max(32768)]),
  saveFile: z.tuple([
    z.object({
      path: file.nullable(),
      importSourceId: z.string().min(1).max(200).optional(),
      content: text,
      baseContent: text,
      hash: short,
      title: short,
    }),
  ]),
  selectDirectory: z.tuple([]),
  getTree: z.tuple([file]),
  getIndex: z.tuple([]),
  search: z.tuple([
    z.string().max(10000),
    z.object({ root: file.optional(), tag: short.optional() }).optional(),
  ]),
  searchNotes: z.tuple([
    z.string().max(10000),
    z
      .object({ root: file.optional(), tag: short.optional(), requestId: short.optional() })
      .optional(),
  ]),
  cancelSearch: z.tuple([short]),
  resolveLink: z.tuple([file, z.string().max(32768)]),
  moveFile: z.tuple([file, file.optional()]),
  undoMove: z.tuple([short]),
  retryMoveHistory: z.tuple([z.string().min(1).max(1024)]),
  pendingHistory: z.tuple([]),
  retryHistoryWork: z.tuple([z.string().min(1).max(1024)]),
  trashFile: z.tuple([file]),
  setTags: z.tuple([file, z.array(z.string().max(200)).max(1000)]),
  putAttachment: z.tuple([
    file,
    short,
    z.array(z.number().int().min(0).max(255)).max(64 * 1024 * 1024),
  ]),
  assetUrl: z.tuple([file, file.optional()]),
  localizeImages: z.tuple([file, text, z.array(z.string().url().max(32768)).max(10000).optional()]),
  scanAttachments: z.tuple([]),
  trashAttachments: z.tuple([z.array(file).max(5000)]),
  listHistory: z.tuple([file.optional()]),
  readHistory: z.tuple([short]),
  restoreHistory: z.tuple([short]),
  pinHistory: z.tuple([short, z.boolean()]),
  historyStats: z.tuple([]),
  pruneHistory: z.tuple([]),
  periodicNote: z.tuple([
    z.enum(['daily', 'weekly', 'monthly']),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    short.optional(),
    z.boolean().optional(),
  ]),
  getFonts: z.tuple([z.boolean().optional()]),
  getFontCatalog: z.tuple([]),
  importFonts: z.tuple([]),
  downloadFont: z.tuple([short]),
  removeFont: z.tuple([short]),
  chooseWallpaper: z.tuple([]),
  exportDocument: z.tuple([
    z.object({
      format: z.enum(['html', 'pdf']),
      html: text,
      notePath: file.nullable(),
      title: short,
    }),
  ]),
  exportBundle: z.tuple([file, text]),
  openExternal: z.tuple([z.string().url().max(32768)]),
  revealPath: z.tuple([file]),
  closeReady: z.tuple([]),
};
export type InvokeMethod = keyof typeof argumentSchemas;
