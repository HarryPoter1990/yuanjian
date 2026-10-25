import { createRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { MarkdownEditor } from '../../src/editor/MarkdownEditor';
import { defaultSettings } from '../../src/shared/defaults';

// Generated source and synthetic clipboard events; no user files or system clipboard.
const root = createRoot(document.getElementById('root'));
const editor = createRef();
let generation = 0;
window.tableInputFixture = {
  reset(source) {
    flushSync(() =>
      root.render(
        <MarkdownEditor
          key={++generation}
          ref={editor}
          value={source}
          mode="live"
          initialCursor={source.length}
          settings={defaultSettings}
          onChange={() => {}}
        />,
      ),
    );
  },
  source: () => editor.current.getView().state.doc.toString(),
  paste(html, plain) {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { files: [], getData: (type) => (type === 'text/html' ? html : plain) },
    });
    document.activeElement.dispatchEvent(event);
  },
};
