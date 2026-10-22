import React, { createRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MarkdownEditor } from '../../src/editor/MarkdownEditor';
import { defaultSettings } from '../../src/shared/defaults';
import '../../src/styles/app.css';

const reference = createRef();
const root = createRoot(document.getElementById('root'));
let instance = 0;
window.notes = { assetUrl: async () => '' };

function Fixture({ source, mode }) {
  const [value, setValue] = useState(source);
  return (
    <div className="app" data-theme="light">
      <div style={{ height: '100vh', width: '100%' }}>
        <MarkdownEditor
          ref={reference}
          settings={defaultSettings}
          mode={mode}
          value={value}
          onChange={setValue}
        />
      </div>
    </div>
  );
}

window.editorInputFixture = {
  reset(source, mode, from = source.length, to = from) {
    flushSync(() => root.render(<Fixture key={++instance} source={source} mode={mode} />));
    const view = reference.current.getView();
    view.dispatch({ selection: { anchor: from, head: to } });
    view.focus();
  },
  state() {
    const view = reference.current.getView();
    return {
      source: view.state.doc.toString(),
      selection: view.state.selection.toJSON(),
      focused: view.hasFocus,
    };
  },
};
window.editorInputFixture.reset('', 'live');
