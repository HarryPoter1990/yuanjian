import { StateEffect, StateField } from '@codemirror/state';
import { type EditorView, type Panel, runScopeHandlers } from '@codemirror/view';
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search';

const replaceMode = StateEffect.define<boolean>();
const optionsMode = StateEffect.define<boolean>();
const display = StateField.define({
  create: () => ({ replace: false, options: false }),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(replaceMode)) value = { ...value, replace: effect.value };
      if (effect.is(optionsMode)) value = { ...value, options: effect.value };
    }
    return value;
  },
});

class CompactSearchPanel implements Panel {
  dom: HTMLDivElement;
  top = true;
  private find: HTMLInputElement;
  private replacement: HTMLInputElement;
  private result: HTMLSpanElement;
  private replacementRow: HTMLDivElement;
  private optionsRow: HTMLDivElement;
  private caseSensitive: HTMLInputElement;
  private regexp: HTMLInputElement;
  private wholeWord: HTMLInputElement;
  private expand: HTMLButtonElement;
  private options: HTMLButtonElement;
  private next: HTMLButtonElement;
  private previous: HTMLButtonElement;
  private replaceOne: HTMLButtonElement;
  private replaceEvery: HTMLButtonElement;
  private lastDoc?: EditorView['state']['doc'];
  private lastQuery?: SearchQuery;
  private matches: { from: number; to: number }[] = [];

  constructor(readonly view: EditorView) {
    const document = view.dom.ownerDocument;
    const row = (className: string) => {
      const element = document.createElement('div');
      element.className = className;
      return element;
    };
    const input = (name: string, label: string) => {
      const element = document.createElement('input');
      element.name = name;
      element.setAttribute('aria-label', label);
      element.placeholder = label;
      element.className = 'cm-textfield';
      element.setAttribute('form', '');
      element.addEventListener('input', () => this.commit());
      return element;
    };
    const button = (label: string, text: string, run: () => void) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'cm-button';
      element.setAttribute('aria-label', label);
      element.title = label;
      element.textContent = text;
      element.addEventListener('click', run);
      return element;
    };
    const checkbox = (label: string) => {
      const wrap = document.createElement('label');
      const element = document.createElement('input');
      element.type = 'checkbox';
      element.setAttribute('aria-label', label);
      element.addEventListener('change', () => this.commit());
      wrap.append(element, label);
      this.optionsRow.append(wrap);
      return element;
    };
    this.dom = row('cm-search cm-search-compact');
    const main = row('cm-search-main');
    this.find = input('search', '查找正文');
    this.find.setAttribute('main-field', 'true');
    this.result = document.createElement('span');
    this.result.setAttribute('aria-label', '查找结果');
    this.result.setAttribute('role', 'status');
    this.result.setAttribute('aria-live', 'polite');
    this.previous = button('上一项', '↑', () => {
      findPrevious(view);
    });
    this.next = button('下一项', '↓', () => {
      findNext(view);
    });
    this.expand = button('展开替换', '替换', () => {
      view.dispatch({ effects: replaceMode.of(!view.state.field(display).replace) });
      if (view.state.field(display).replace) this.replacement.focus();
    });
    this.options = button('查找选项', '选项', () =>
      view.dispatch({ effects: optionsMode.of(!view.state.field(display).options) }),
    );
    main.append(
      this.find,
      this.previous,
      this.next,
      this.result,
      this.expand,
      this.options,
      button('关闭查找', '×', () => {
        closeSearchPanel(view);
      }),
    );
    this.replacementRow = row('cm-search-replace');
    this.replacement = input('replace', '替换为');
    this.replaceOne = button('替换当前项', '替换', () => {
      replaceNext(view);
    });
    this.replaceEvery = button('全部替换', '全部替换', () => {
      replaceAll(view);
    });
    this.replacementRow.append(this.replacement, this.replaceOne, this.replaceEvery);
    this.optionsRow = row('cm-search-options');
    this.caseSensitive = checkbox('区分大小写');
    this.regexp = checkbox('正则表达式');
    this.wholeWord = checkbox('整词匹配');
    this.dom.append(main, this.replacementRow, this.optionsRow);
    this.dom.addEventListener('keydown', (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (runScopeHandlers(view, event, 'search-panel')) {
        event.preventDefault();
        event.stopPropagation();
      } else if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        if (event.target === this.replacement) replaceNext(view);
        else if (event.shiftKey) findPrevious(view);
        else findNext(view);
      }
    });
    this.refresh();
  }
  mount() {
    this.find.focus();
    this.find.select();
  }
  update() {
    this.refresh();
  }
  private commit() {
    const query = getSearchQuery(this.view.state);
    this.view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: this.find.value,
          replace: this.replacement.value,
          caseSensitive: this.caseSensitive.checked,
          regexp: this.regexp.checked,
          wholeWord: this.wholeWord.checked,
          literal: query.literal,
        }),
      ),
    });
  }
  private refresh() {
    const state = this.view.state,
      query = getSearchQuery(state),
      mode = state.field(display);
    if (this.find.value !== query.search) this.find.value = query.search;
    if (this.replacement.value !== query.replace) this.replacement.value = query.replace;
    this.caseSensitive.checked = query.caseSensitive;
    this.regexp.checked = query.regexp;
    this.wholeWord.checked = query.wholeWord;
    this.replacementRow.hidden = !mode.replace;
    this.optionsRow.hidden = !mode.options;
    this.expand.setAttribute('aria-label', mode.replace ? '收起替换' : '展开替换');
    this.expand.setAttribute('aria-expanded', String(mode.replace));
    this.options.setAttribute('aria-expanded', String(mode.options));
    if (this.lastDoc !== state.doc || !this.lastQuery?.eq(query)) {
      this.lastDoc = state.doc;
      this.lastQuery = query;
      this.matches = [];
      if (query.valid) {
        const cursor = query.getCursor(state.doc);
        for (let match = cursor.next(); !match.done; match = cursor.next())
          this.matches.push(match.value);
      }
    }
    const selected = state.selection.main;
    const current =
      this.matches.findIndex((match) => match.from === selected.from && match.to === selected.to) +
      1;
    this.result.textContent = !query.search
      ? '输入查找内容'
      : !query.valid
        ? '正则表达式无效'
        : `${current} / ${this.matches.length} 项`;
    this.find.setAttribute('aria-invalid', String(Boolean(query.search && !query.valid)));
    const focused = this.view.dom.ownerDocument.activeElement;
    let restoreSearchFocus = false;
    for (const button of [this.next, this.previous, this.replaceOne, this.replaceEvery]) {
      const disabled = !query.valid || !this.matches.length;
      if (disabled && button === focused) restoreSearchFocus = true;
      button.disabled = disabled;
    }
    // Chromium drops focus when a clicked action becomes disabled after its last match disappears.
    if (restoreSearchFocus) this.find.focus({ preventScroll: true });
  }
}

export const compactSearch = [
  display,
  search({ top: true, createPanel: (view) => new CompactSearchPanel(view) }),
];
export function openEditorSearch(view: EditorView, replace = false): boolean {
  view.dispatch({ effects: replaceMode.of(replace) });
  openSearchPanel(view);
  if (replace && getSearchQuery(view.state).search)
    view.dom.querySelector<HTMLInputElement>('input[name="replace"]')?.focus();
  return true;
}
