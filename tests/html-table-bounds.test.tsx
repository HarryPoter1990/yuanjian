// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { markdownTableFromGrid, readHtmlTable } from '../src/editor/html-table';

it('counts rectangular padding in the expanded HTML grid budget', () => {
  const table = document.createElement('table');
  table.innerHTML =
    '<tr>' + '<td>x</td>'.repeat(1000) + '</tr>' + '<tr><td>y</td></tr>'.repeat(100);
  expect(() => readHtmlTable(table, (html) => html)).toThrow('100000');
});

it('counts ragged row padding before serializing the shared Markdown grid', () => {
  const rows = [Array<string>(1000).fill('x'), ...Array.from({ length: 100 }, () => ['y'])];
  expect(() => markdownTableFromGrid(rows, true)).toThrow('100000');
});

it('counts the inserted empty header in the final Markdown cell budget', () => {
  const rows = [Array<string>(1000).fill('x'), ...Array.from({ length: 99 }, () => ['y'])];
  expect(() => markdownTableFromGrid(rows, false)).toThrow('100000');
  expect(() => markdownTableFromGrid(rows, true)).not.toThrow();
});
