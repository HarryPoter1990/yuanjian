export interface NoteDocument {
  id: string;
  path: string | null;
  title: string;
  content: string;
  hash: string;
  modifiedAt: number;
}
export interface Heading {
  level: number;
  text: string;
  line: number;
  id: string;
}
export interface NoteLink {
  target: string;
  label: string;
  image: boolean;
  line: number;
}
export interface NoteMeta {
  path: string;
  title: string;
  tags: string[];
  headings: Heading[];
  links: NoteLink[];
  modifiedAt: number;
}
export interface FileEntry {
  path: string;
  name: string;
  kind: 'directory' | 'note' | 'attachment' | 'other';
  children?: FileEntry[];
}
export interface SearchHit {
  path: string;
  title: string;
  line: number;
  snippet: string;
  tags: string[];
}
export interface Template {
  id: string;
  name: string;
  kind: 'note' | 'daily' | 'weekly' | 'monthly';
  content: string;
}
export interface Snippet {
  trigger: string;
  body: string;
  enabled: boolean;
}
export interface Appearance {
  palette?: 'ink' | 'moss' | 'paper';
  paletteOverrides?: {
    light?: Partial<Record<'background' | 'foreground' | 'accent', string>>;
    dark?: Partial<Record<'background' | 'foreground' | 'accent', string>>;
  };
  mode: 'light' | 'dark' | 'system';
  accent: string;
  background: string;
  foreground: string;
  uiFont: string;
  bodyFont: string;
  codeFont: string;
  codeFontSize?: number;
  codeLineHeight?: number;
  headingFont: string;
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  wallpaper: string;
  wallpaperOpacity: number;
  wallpaperBlur: number;
  wallpaperBrightness: number;
  wallpaperFit: 'cover' | 'contain' | 'repeat';
  wallpaperPosition: string;
  editorOpacity: number;
  sidebarOpacity?: number;
}
export interface ThemePreset {
  id: string;
  name: string;
  appearance: Appearance;
}
export interface GraphPreferences {
  local: boolean;
  depth: number;
  tags: boolean;
  attachments: boolean;
  root: string;
  tag: string;
  positions: Record<string, { x: number; y: number }>;
  zoom: number;
  pan: { x: number; y: number };
}
export interface Settings {
  roots: string[];
  excluded: string[];
  showAllFiles: boolean;
  autoSave: boolean;
  leftVisible: boolean;
  rightVisible: boolean;
  leftWidth: number;
  rightWidth: number;
  rightGroups?: Record<string, boolean>;
  toolbarVisible: boolean;
  toolbarButtons: string[];
  statusVisible: boolean;
  appearance: Appearance;
  themes: ThemePreset[];
  codeLineNumbers: boolean;
  codeWrap: boolean;
  codeFold: boolean;
  attachmentPattern: string;
  historyDays: number;
  historyLimitMB: number;
  journalDirectory: string;
  dailyPattern: string;
  weeklyPattern: string;
  monthlyPattern: string;
  weeklyEnabled: boolean;
  monthlyEnabled: boolean;
  templates: Template[];
  snippets: Snippet[];
  shortcuts: Record<string, string>;
  graph: GraphPreferences;
}
export interface TabState extends NoteDocument {
  baseContent: string;
  dirty: boolean;
  cursor: number;
  scrollTop: number;
  mode: 'live' | 'source';
}
export interface SessionState {
  tabs: TabState[];
  activeId: string | null;
}
export interface FontEntry {
  id: string;
  name: string;
  source: 'system' | 'bundled' | 'downloaded' | 'imported';
  url?: string;
  path?: string;
  bytes?: number;
}
export interface FontCatalogEntry {
  id: string;
  name: string;
  description: string;
  url: string;
  fileName: string;
  licenseUrl: string;
}
export interface Bootstrap {
  settings: Settings;
  session: SessionState;
  fonts: FontEntry[];
  dataDirectory: string;
  version: string;
  warnings?: string[];
}
export interface SaveRequest {
  path: string | null;
  content: string;
  baseContent: string;
  hash: string;
  title: string;
}
export interface SaveOutcome {
  status: 'saved' | 'cancelled' | 'conflict';
  note?: NoteDocument;
  merged?: boolean;
  conflict?: { path: string; base: string; ours: string; theirs: string; hash: string };
}
export interface HistoryEntry {
  id: string;
  path: string;
  createdAt: number;
  pinned: boolean;
  reason: string;
  textBytes: number;
  imageBytes: number;
  deletedAt?: number;
}
export interface HistoryStats {
  textBytes: number;
  imageBytes: number;
  totalBytes: number;
  count: number;
  warning?: string;
}
export interface AttachmentCandidate {
  path: string;
  bytes: number;
  references: string[];
}
export interface LocalizationResult {
  url: string;
  path?: string;
  error?: string;
}
export interface MoveOutcome {
  path: string;
  affected: string[];
  undoId: string;
}
export interface ResolvedLink {
  path: string | null;
  heading?: string;
  exists: boolean;
  candidates: string[];
  external?: string;
}
export interface OperationProgress {
  id: string;
  kind: string;
  completed: number;
  total?: number;
  message: string;
}
export type WindowMode = 'full' | 'sticky';
export interface WindowModeState {
  mode: WindowMode;
  pinned: boolean;
}
export interface DesktopAPI {
  getWindowMode(): Promise<WindowModeState>;
  setWindowMode(mode: WindowMode): Promise<WindowModeState>;
  setStickyPinned(pinned: boolean): Promise<WindowModeState>;
  onWindowModeChanged(callback: (state: WindowModeState) => void): () => void;
  setWindowTheme(theme: { background: string; foreground: string }): Promise<void>;
  bootstrap(): Promise<Bootstrap>;
  saveSettings(settings: Settings): Promise<Settings>;
  saveSession(session: SessionState): Promise<void>;
  openFile(path?: string): Promise<NoteDocument | null>;
  openLinkedFile(fromPath: string, target: string): Promise<NoteDocument | null>;
  saveFile(request: SaveRequest): Promise<SaveOutcome>;
  selectDirectory(): Promise<string | null>;
  getTree(root: string): Promise<FileEntry[]>;
  getIndex(): Promise<NoteMeta[]>;
  search(query: string, options?: { root?: string; tag?: string }): Promise<SearchHit[]>;
  resolveLink(fromPath: string, target: string): Promise<ResolvedLink>;
  moveFile(fromPath: string, toPath?: string): Promise<MoveOutcome | null>;
  undoMove(undoId: string): Promise<void>;
  trashFile(path: string): Promise<void>;
  setTags(path: string, tags: string[]): Promise<NoteDocument>;
  putAttachment(
    notePath: string,
    name: string,
    bytes: number[],
  ): Promise<{ path: string; reference: string }>;
  assetUrl(path: string, fromPath?: string): Promise<string>;
  localizeImages(
    notePath: string,
    content: string,
    urls?: string[],
  ): Promise<{ content: string; results: LocalizationResult[] }>;
  scanAttachments(): Promise<AttachmentCandidate[]>;
  trashAttachments(paths: string[]): Promise<void>;
  listHistory(path?: string): Promise<HistoryEntry[]>;
  readHistory(id: string): Promise<{ content: string; entry: HistoryEntry }>;
  restoreHistory(id: string): Promise<NoteDocument>;
  pinHistory(id: string, pinned: boolean): Promise<void>;
  historyStats(): Promise<HistoryStats>;
  pruneHistory(): Promise<HistoryStats>;
  periodicNote(
    kind: 'daily' | 'weekly' | 'monthly',
    date: string,
    templateId?: string,
    createAdditional?: boolean,
  ): Promise<NoteDocument | null>;
  getFonts(refresh?: boolean): Promise<FontEntry[]>;
  getFontCatalog(): Promise<FontCatalogEntry[]>;
  importFonts(): Promise<FontEntry[]>;
  downloadFont(catalogId: string): Promise<FontEntry[]>;
  removeFont(id: string): Promise<void>;
  chooseWallpaper(): Promise<string | null>;
  exportDocument(request: {
    format: 'html' | 'pdf';
    html: string;
    notePath: string | null;
    title: string;
  }): Promise<string | null>;
  exportBundle(notePath: string, content: string): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  revealPath(path: string): Promise<void>;
  closeReady(): Promise<void>;
  onFilesChanged(callback: (paths: string[]) => void): () => void;
  onCloseRequested(callback: () => void): () => void;
  onOpenRequested(callback: (path: string) => void): () => void;
  onProgress(callback: (progress: OperationProgress) => void): () => void;
}
declare global {
  interface Window {
    notes: DesktopAPI;
  }
}
