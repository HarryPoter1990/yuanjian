import { isEscaped } from '../shared/math-syntax';
export { isEscaped } from '../shared/math-syntax';
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

export function inMath(state: EditorState, position: number): boolean {
  if (inCode(state, position)) return false;
  return mathRanges(state).some(
    (range) => position > range.from && (range.closed ? position < range.to : position <= range.to),
  );
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

export function mathCompletion(snippets: Snippet[], immediateTab = false): Extension {
  return autocompletion({
    override: [mathCompletionSource(snippets)],
    activateOnTyping: true,
    defaultKeymap: true,
    ...(immediateTab ? { interactionDelay: 0 } : {}),
  });
}

export interface MathRange {
  source: string;
  from: number;
  to: number;
}

interface FormulaRange extends MathRange {
  closed: boolean;
}

// Read delimiters in source order: an inline closing '$' must be consumed before
// testing the next '$' as an opener. Separate '$$' counting loses this context.
function mathRanges(state: EditorState): FormulaRange[] {
  const text = state.doc.toString();
  const ranges: FormulaRange[] = [];
  let opening: { from: number; size: number } | null = null;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\n' && opening?.size === 1) {
      ranges.push({
        source: text.slice(opening.from + 1, index),
        from: opening.from,
        to: index,
        closed: false,
      });
      opening = null;
    }
    if (text[index] !== '$' || isEscaped(text, index) || inCode(state, index + 1)) continue;
    if (!opening) {
      const size = text[index + 1] === '$' ? 2 : 1;
      opening = { from: index, size };
      index += size - 1;
    } else if (opening.size === 1 || text[index + 1] === '$') {
      ranges.push({
        source: text.slice(opening.from + opening.size, index),
        from: opening.from,
        to: index + opening.size,
        closed: true,
      });
      index += opening.size - 1;
      opening = null;
    }
  }
  if (opening)
    ranges.push({
      source: text.slice(opening.from + opening.size),
      from: opening.from,
      to: text.length,
      closed: false,
    });
  return ranges;
}

export function activeMathRange(state: EditorState): MathRange | null {
  const position = state.selection.main.head;
  if (inCode(state, position)) return null;
  for (const { source, from, to, closed } of mathRanges(state)) {
    if (closed && source && position >= from && position <= to) return { source, from, to };
  }
  return null;
}

export function activeMath(state: EditorState): string | null {
  return activeMathRange(state)?.source ?? null;
}
