import React, { createRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MarkdownEditor } from '../../src/editor/MarkdownEditor';
import { defaultSettings } from '../../src/shared/defaults';
import '../../src/styles/app.css';
const ref = createRef(),
  root = createRoot(document.getElementById('root'));
window.notes = { assetUrl: async () => '' };
let serial = 0;
function Fixture({ source, mode }) {
  const [value, setValue] = useState(source);
  return (
    <div className="app" data-theme="light">
      <div style={{ height: '100vh' }}>
        <MarkdownEditor
          ref={ref}
          value={value}
          onChange={setValue}
          mode={mode}
          settings={defaultSettings}
        />
      </div>
    </div>
  );
}
window.perfAudit = {
  reset(source, mode) {
    flushSync(() => root.render(<Fixture key={++serial} source={source} mode={mode} />));
    const view = ref.current.getView();
    view.dispatch({ selection: { anchor: source.length } });
    view.focus();
  },
  async measure() {
    const view = ref.current.getView();
    const before = view.state.doc.length,
      start = performance.now();
    view.dispatch({
      changes: { from: before, insert: 'a' },
      selection: { anchor: before + 1 },
      userEvent: 'input.type',
    });
    const dispatch = performance.now() - start;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      dispatchMs: dispatch,
      throughTwoFramesMs: performance.now() - start,
      length: view.state.doc.length,
    };
  },
};
window.perfAudit.reset('', 'live');
