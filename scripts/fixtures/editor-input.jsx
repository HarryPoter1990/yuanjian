import React, { createRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MarkdownEditor } from '../../src/editor/MarkdownEditor';
import { defaultSettings } from '../../src/shared/defaults';
import { activeMathRange, inMath } from '../../src/editor/completion';
import { createMarkdownParser } from '../../src/editor/renderer';
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
  math() {
    const state = reference.current.getView().state;
    return {
      inside: inMath(state, state.selection.main.head),
      preview: activeMathRange(state),
      renderedFormulas: createMarkdownParser()
        .parse(state.doc.toString(), {})
        .flatMap((token) => token.children ?? [token])
        .filter((token) => ['inline_math', 'block_math'].includes(token.type))
        .map((token) => token.content),
    };
  },
};
window.editorInputFixture.reset('', 'live');
