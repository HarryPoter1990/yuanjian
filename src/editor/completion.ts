import {
  autocompletion,
  snippetCompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { EditorState, type Extension } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { Snippet } from '../shared/types';

const commands = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'theta',
  'lambda',
  'pi',
  'sigma',
  'omega',
  'Gamma',
  'Delta',
  'Omega',
  'infty',
  'partial',
  'nabla',
  'times',
  'cdot',
  'div',
  'leq',
  'geq',
  'neq',
  'approx',
  'equiv',
  'in',
  'notin',
  'subset',
  'cup',
  'cap',
  'forall',
  'exists',
  'rightarrow',
  'Rightarrow',
  'leftrightarrow',
  'sin',
  'cos',
  'tan',
  'log',
  'ln',
  'lim',
  'sum',
  'prod',
  'int',
  'sqrt',
  'frac',
  'text',
  'left',
  'right',
  'begin',
  'end',
];

export function inCode(state: EditorState, position: number): boolean {
  for (let node = syntaxTree(state).resolve(position, -1); node;) {
    if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) return true;
    if (!node.parent) break;
    node = node.parent;
  }
  return false;
}

export function isEscaped(text: string, position: number): boolean {
  let start = position;
  while (start > 0 && text[start - 1] === '\\') start--;
  return (position - start) % 2 === 1;
}

export function inMath(state: EditorState, position: number): boolean {
  if (inCode(state, position)) return false;
  const before = state.doc.sliceString(0, position);
  const fences = before.match(/^\s*(```|~~~).*$/gm) ?? [];
  if (fences.length % 2) return false;
  const blocks = Array.from(before.matchAll(/\$\$/g)).filter(
    (match) => !isEscaped(before, match.index),
  ).length;
  if (blocks % 2) return true;
  const line = state.doc.lineAt(position);
  const lineBefore = line.text.slice(0, position - line.from);
  const inline = Array.from(lineBefore.matchAll(/\$\$|\$/g)).filter(
    (match) => match[0] === '$' && !isEscaped(lineBefore, match.index),
  );
  return inline.length % 2 === 1;
}

export function mathCompletionSource(
  snippets: Snippet[],
): (context: CompletionContext) => CompletionResult | null {
  return (context) => {
    if (!inMath(context.state, context.pos)) return null;
    const command = context.matchBefore(/\\[a-zA-Z]*/);
    const trigger = context.matchBefore(/[a-zA-Z]+/);
    const match = command ?? trigger;
    if (!match && !context.explicit) return null;
    const options = command
      ? commands.map((label) => ({ label: `\\${label}`, type: 'function' }))
      : snippets
          .filter((snippet) => snippet.enabled)
          .map((item) =>
            snippetCompletion(item.body, {
              label: item.trigger,
              detail: '公式片段 · Tab 切换参数',
              type: 'snippet',
            }),
          );
    return {
      from: match?.from ?? context.pos,
      options,
      validFor: command ? /^\\[a-zA-Z]*$/ : /^[a-zA-Z]*$/,
    };
  };
}

export function mathCompletion(snippets: Snippet[]): Extension {
  return autocompletion({
    override: [mathCompletionSource(snippets)],
    activateOnTyping: true,
    defaultKeymap: true,
  });
}

export interface MathRange {
  source: string;
  from: number;
  to: number;
}

export function activeMathRange(state: EditorState): MathRange | null {
  const position = state.selection.main.head;
  if (inCode(state, position)) return null;
  const text = state.doc.toString();
  const delimiters = Array.from(text.matchAll(/\$\$/g)).filter(
    (match) => !isEscaped(text, match.index) && !inCode(state, match.index),
  );
  for (let index = 0; index + 1 < delimiters.length; index += 2) {
    const from = delimiters[index].index;
    const end = delimiters[index + 1].index;
    if (position >= from && position <= end + 2)
      return { source: text.slice(from + 2, end), from, to: end + 2 };
  }
  const line = state.doc.lineAt(position);
  const offset = position - line.from;
  const inline = Array.from(line.text.matchAll(/\$\$|\$/g)).filter(
    (match) => match[0] === '$' && !isEscaped(line.text, match.index),
  );
  for (let index = 0; index + 1 < inline.length; index += 2) {
    const from = inline[index].index;
    const end = inline[index + 1].index;
    if (offset >= from && offset <= end + 1)
      return {
        source: line.text.slice(from + 1, end),
        from: line.from + from,
        to: line.from + end + 1,
      };
  }
  return null;
}

export function activeMath(state: EditorState): string | null {
  return activeMathRange(state)?.source ?? null;
}
