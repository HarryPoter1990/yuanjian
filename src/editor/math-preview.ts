import { WidgetType } from '@codemirror/view';
import { mathHtml } from './renderer';

export class MathPreviewWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  eq(other: MathPreviewWidget): boolean {
    return this.source === other.source;
  }
  toDOM(): HTMLElement {
    const root = document.createElement('aside');
    root.className = 'math-preview';
    root.contentEditable = 'false';
    root.setAttribute('aria-label', '公式即时预览');
    const label = document.createElement('small');
    label.textContent = '公式预览 · Ctrl+Space 补全 · Tab 参数';
    const formula = document.createElement('div');
    formula.className = 'math-preview-content';
    formula.innerHTML = mathHtml(this.source, true);
    root.append(label, formula);
    const error = formula.querySelector('.katex-error')?.getAttribute('title');
    if (error) {
      const message = document.createElement('span');
      message.className = 'math-preview-error';
      message.setAttribute('role', 'status');
      message.textContent = error.replace(/^ParseError:\s*/, '').split('\n')[0];
      root.append(message);
    }
    return root;
  }
  ignoreEvent(): boolean {
    return true;
  }
}
