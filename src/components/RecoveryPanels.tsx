import { useEffect, useRef, useState } from 'react';
import { Pin, RotateCcw } from '../ui/icons';
import type { AttachmentCandidate, HistoryEntry, TabState } from '../shared/types';
import { bytesLabel, errorText, fileName } from '../ui/model';
import { Empty, Modal } from './Controls';

export function HistoryPanel({
  tab,
  onClose,
  onRestore,
  onError,
}: {
  tab: TabState;
  onClose(): void;
  onRestore(id: string): Promise<void>;
  onError(message: string): void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [selected, setSelected] = useState<HistoryEntry | null>(null);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(true);
  const [failure, setFailure] = useState('');
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const readRequest = useRef(0);
  async function load() {
    setBusy(true);
    setFailure('');
    try {
      setEntries(await window.notes.listHistory(tab.path || undefined));
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, [tab.path]);
  async function select(entry: HistoryEntry) {
    const request = ++readRequest.current;
    setBusy(true);
    setFailure('');
    try {
      const result = await window.notes.readHistory(entry.id);
      if (readRequest.current !== request) return;
      setSelected(result.entry);
      setContent(result.content);
      setRestoreConfirm(false);
    } catch (error) {
      if (readRequest.current === request) setFailure(errorText(error));
    } finally {
      if (readRequest.current === request) setBusy(false);
    }
  }
  return (
    <Modal title={`版本历史 · ${tab.title}`} onClose={onClose} wide>
      <div className="history-layout">
        <nav className="history-list" aria-label="历史版本">
          {entries.map((entry) => (
            <button
              className={selected?.id === entry.id ? 'active' : ''}
              key={entry.id}
              onClick={() => void select(entry)}
            >
              <strong>{new Date(entry.createdAt).toLocaleString('zh-CN')}</strong>
              <small>
                {entry.pinned && '📌 '}
                {entry.reason} · {bytesLabel(entry.textBytes + entry.imageBytes)}
              </small>
            </button>
          ))}
          {!busy && !entries.length && <Empty>这篇笔记还没有历史。实际编辑后会自动记录。</Empty>}
        </nav>
        <div className="history-content">
          {busy && <p role="status">正在读取历史…</p>}
          {failure && (
            <p className="inline-error" role="alert">
              {failure}
            </p>
          )}
          {selected && (
            <>
              <div className="history-actions">
                <span>{new Date(selected.createdAt).toLocaleString('zh-CN')}</span>
                <button
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void window.notes
                      .pinHistory(selected.id, !selected.pinned)
                      .then(() => {
                        setSelected({ ...selected, pinned: !selected.pinned });
                        return load();
                      })
                      .catch((error) => onError(errorText(error)))
                      .finally(() => setBusy(false));
                  }}
                >
                  <Pin size={14} />
                  {selected.pinned ? '取消固定' : '固定此版本'}
                </button>
                <button disabled={busy} onClick={() => setRestoreConfirm(true)}>
                  <RotateCcw size={14} />
                  恢复此版本
                </button>
              </div>
              <div className="compare-grid">
                <label>
                  历史版本
                  <textarea aria-label="历史版本正文" value={content} readOnly />
                </label>
                <label>
                  当前编辑内容
                  <textarea aria-label="当前版本正文" value={tab.content} readOnly />
                </label>
              </div>
              {restoreConfirm && (
                <div className="inline-confirm">
                  <p>恢复前会保存当前状态为历史。尚未命名的草稿需要先另存。</p>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void onRestore(selected.id)
                        .then(onClose)
                        .catch((error) => {
                          onError(errorText(error));
                          setBusy(false);
                        });
                    }}
                  >
                    保存当前状态并恢复
                  </button>
                  <button onClick={() => setRestoreConfirm(false)}>取消</button>
                </div>
              )}
            </>
          )}
          {!selected && !busy && entries.length > 0 && (
            <Empty>选择左侧版本，比较原文后恢复。</Empty>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function AttachmentPanel({
  onClose,
  onError,
  onSuccess,
}: {
  onClose(): void;
  onError(message: string): void;
  onSuccess(message: string): void;
}) {
  const [items, setItems] = useState<AttachmentCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(true);
  const [failure, setFailure] = useState('');
  const [confirm, setConfirm] = useState(false);
  async function scan() {
    setBusy(true);
    setFailure('');
    try {
      setItems(await window.notes.scanAttachments());
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void scan();
  }, []);
  const total = items
    .filter((item) => selected.has(item.path))
    .reduce((sum, item) => sum + item.bytes, 0);
  return (
    <Modal title="检查疑似未引用附件" onClose={onClose} wide>
      <div className="panel-content">
        <p className="section-description">
          仅扫描已添加目录内的附件及引用，不代表整个磁盘。请核对路径后勾选；笔记正文不会被删除。
        </p>
        {busy && <p role="status">正在扫描已添加目录…</p>}
        {failure && (
          <p role="alert" className="inline-error">
            {failure}
          </p>
        )}
        <div className="attachment-list">
          {items.map((item) => (
            <label className="attachment-row" key={item.path}>
              <input
                type="checkbox"
                checked={selected.has(item.path)}
                onChange={(e) =>
                  setSelected((previous) => {
                    const next = new Set(previous);
                    e.target.checked ? next.add(item.path) : next.delete(item.path);
                    return next;
                  })
                }
              />
              <span>
                <strong>{fileName(item.path)}</strong>
                <small>{item.path}</small>
                <small>
                  已检查引用范围：{item.references.join('、') || '已添加目录内未发现引用'}
                </small>
              </span>
              <span>{bytesLabel(item.bytes)}</span>
            </label>
          ))}
        </div>
        {!busy && !items.length && !failure && <Empty>已添加目录中未发现疑似未引用附件。</Empty>}
        <footer className="dialog-actions">
          <span>
            已选 {selected.size} 项 · {bytesLabel(total)}
          </span>
          <button disabled={busy} onClick={() => void scan()}>
            重新扫描
          </button>
          <button
            className="danger-text"
            disabled={busy || !selected.size}
            onClick={() => setConfirm(true)}
          >
            将所选移入回收站
          </button>
        </footer>
        {confirm && (
          <div className="inline-confirm">
            <p>将 {selected.size} 个附件移入系统回收站？如果其他应用仍在使用，请先取消勾选。</p>
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void window.notes
                  .trashAttachments([...selected])
                  .then(async () => {
                    onSuccess(`已将 ${selected.size} 个附件移入回收站`);
                    setSelected(new Set());
                    setConfirm(false);
                    await scan();
                  })
                  .catch((error) => {
                    onError(errorText(error));
                    setBusy(false);
                  });
              }}
            >
              确认移入回收站
            </button>
            <button onClick={() => setConfirm(false)}>取消</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
