import { useState } from 'react';
import { FileText, Search } from 'lucide-react';
import type { NoteMeta } from '../shared/types';
import { relativeNoteTarget } from '../ui/model';
import { Modal } from './Controls';

export function LinkPanel({
  sourcePath,
  initialLabel,
  index,
  onInsert,
  onClose,
}: {
  sourcePath: string | null;
  initialLabel: string;
  index: NoteMeta[];
  onInsert(label: string, target: string): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState('');
  const [label, setLabel] = useState(initialLabel);
  const [labelEdited, setLabelEdited] = useState(Boolean(initialLabel));
  const notes = index.filter((note) =>
    `${note.title} ${note.path}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Modal title="插入链接" onClose={onClose}>
      <form
        className="panel-content"
        onSubmit={(event) => {
          event.preventDefault();
          if (target.trim()) onInsert(label, target);
        }}
      >
        {!sourcePath && (
          <p className="section-description">
            这篇草稿尚未保存。请先保存笔记再从列表选择，也可以手填相对目标；取消不会改动正文。
          </p>
        )}
        <label className="stack-label">
          显示文字
          <input
            autoFocus
            aria-label="链接显示文字"
            value={label}
            onChange={(event) => {
              setLabel(event.target.value);
              setLabelEdited(true);
            }}
            placeholder="链接文字"
          />
        </label>
        <label className="stack-label">
          链接目标
          <input
            aria-label="链接目标"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder="相对笔记.md#标题，或 https://…"
          />
        </label>
        <div className="input-with-icon">
          <Search size={14} />
          <input
            aria-label="搜索链接笔记"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="从已添加目录中选择笔记…"
          />
        </div>
        <div className="link-target-list">
          {notes.map((note) => (
            <button
              type="button"
              key={note.path}
              disabled={!sourcePath}
              onClick={() => {
                if (sourcePath) setTarget(relativeNoteTarget(sourcePath, note.path));
                if (!labelEdited) setLabel(note.title);
              }}
            >
              <FileText size={14} />
              <span>
                <strong>{note.title}</strong>
                <small>{note.path}</small>
              </span>
            </button>
          ))}
          {!notes.length && <p className="subtle">没有匹配的笔记。也可以直接填写上方目标。</p>}
        </div>
        {sourcePath && (
          <p className="subtle">
            选择笔记时默认填入相对当前文件的路径；位于其他磁盘的文件使用绝对路径。
          </p>
        )}
        <footer className="dialog-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary" disabled={!target.trim()}>
            插入链接
          </button>
        </footer>
      </form>
    </Modal>
  );
}
