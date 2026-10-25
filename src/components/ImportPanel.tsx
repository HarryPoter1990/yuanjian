import { useEffect, useMemo, useRef, useState } from 'react';
import type { ImportEncoding, ImportSource } from '../shared/types';
import { markdownTableFromGrid, plainTableCell } from '../editor/html-table';
import { parseDelimited, guessDelimiter, type Delimiter } from '../shared/delimited';
import { Modal } from './Controls';
import './import-panel.css';

export function ImportPanel({
  source,
  onClose,
  onImport,
}: {
  source: ImportSource;
  onClose(): void;
  onImport(source: ImportSource, markdown: string): void;
}) {
  const [current, setCurrent] = useState(source);
  const [encoding, setEncoding] = useState(source.encoding);
  const [delimiter, setDelimiter] = useState<Delimiter>(() =>
    guessDelimiter(source.text, source.format === 'tsv' ? 'tsv' : 'csv'),
  );
  const [hasHeader, setHasHeader] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const parsed = useMemo(() => {
    try {
      return { rows: parseDelimited(current.text, delimiter), error: '' };
    } catch (error) {
      return {
        rows: [] as string[][],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [current.text, delimiter]);
  async function changeEncoding(value: ImportEncoding) {
    const request = ++generation.current;
    setEncoding(value);
    setBusy(true);
    setFailure('');
    try {
      const result = await window.notes.readImport(source.id, value);
      if (request === generation.current) setCurrent(result);
    } catch (error) {
      if (request === generation.current) {
        setFailure(error instanceof Error ? error.message : String(error));
        setEncoding(current.encoding);
      }
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  const width = parsed.rows.reduce((max, row) => Math.max(max, row.length), 0);
  return (
    <Modal title={`导入表格 · ${source.name}`} onClose={onClose} busy={busy} pending={false} wide>
      <div className="import-panel">
        <p>确认预览后生成未保存的 Markdown 草稿，原文件不会被覆盖。</p>
        <div className="import-options">
          <label>
            分隔符{' '}
            <select
              aria-label="导入分隔符"
              value={delimiter}
              onChange={(event) => setDelimiter(event.target.value as Delimiter)}
              disabled={busy}
            >
              <option value=",">逗号</option>
              <option value={'\t'}>制表符（TSV）</option>
              <option value=";">分号</option>
            </select>
          </label>
          <label>
            字符编码{' '}
            <select
              aria-label="导入字符编码"
              value={encoding}
              onChange={(event) => void changeEncoding(event.target.value as ImportEncoding)}
              disabled={busy}
            >
              <option value="utf-8">UTF-8</option>
              <option value="gb18030">GB18030 / GBK</option>
              <option value="utf-16le">UTF-16 LE</option>
              <option value="utf-16be">UTF-16 BE</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(event) => setHasHeader(event.target.checked)}
              disabled={busy}
            />
            首行是表头
          </label>
        </div>
        {(failure || parsed.error) && (
          <p role="alert" className="inline-error">
            {failure || parsed.error}
          </p>
        )}
        <p role="status">
          {parsed.rows.length} 行 · {width} 列
          {parsed.rows.length > 20 ? '，预览前 20 行，导入包含全部行' : ''}
          {width > 12 ? '；预览前 12 列，导入包含全部列' : ''}
        </p>
        <div className="import-preview">
          <table aria-label="表格导入预览">
            <tbody>
              {parsed.rows.slice(0, 20).map((row, i) => (
                <tr key={i}>
                  {Array.from({ length: Math.min(width, 12) }, (_, j) =>
                    hasHeader && i === 0 ? (
                      <th key={j}>{row[j] ?? ''}</th>
                    ) : (
                      <td key={j}>{row[j] ?? ''}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="dialog-actions">
          <button onClick={onClose} disabled={busy}>
            取消导入
          </button>
          <button
            className="primary"
            disabled={busy || Boolean(parsed.error) || Boolean(failure) || !parsed.rows.length}
            onClick={() =>
              onImport(
                current,
                markdownTableFromGrid(
                  parsed.rows.map((row) => row.map(plainTableCell)),
                  hasHeader,
                ),
              )
            }
          >
            生成 Markdown 草稿
          </button>
        </footer>
      </div>
    </Modal>
  );
}
