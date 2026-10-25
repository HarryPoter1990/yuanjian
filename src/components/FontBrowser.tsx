import { useState, type ReactNode } from 'react';
import type { FontEntry } from '../shared/types';
import { ChevronRight, Search } from '../ui/icons';
import { bytesLabel } from '../ui/model';
import { fontGroup, fontGroups, fontSources } from './font-options';
import './fonts.css';

export function FontBrowser({
  fonts,
  selected,
  actions,
  disabled,
  onRemove,
}: {
  fonts: FontEntry[];
  selected: string[];
  actions: ReactNode;
  disabled: boolean;
  onRemove(font: FontEntry): void;
}) {
  const [query, setQuery] = useState('');
  const [systemOpen, setSystemOpen] = useState(false);
  const searching = Boolean(query.trim());
  const matching = fonts.filter((font) =>
    font.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <div className="font-actions">
        <div className="input-with-icon">
          <Search size={14} />
          <input
            aria-label="搜索字体"
            placeholder="搜索全部来源的字体…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {actions}
      </div>
      <div className="font-browser">
        {searching && !matching.length && (
          <p role="status" className="empty-state">
            没有匹配的字体
          </p>
        )}
        {fontGroups.map((group) => {
          const items = matching.filter((font) => fontGroup(font) === group.id);
          if (searching && !items.length) return null;
          const expanded = group.id !== 'system' || searching || systemOpen;
          return (
            <section className="font-group" key={group.id} aria-label={group.label}>
              {group.id === 'system' ? (
                <button
                  className="font-group-toggle"
                  type="button"
                  aria-label="系统字体"
                  aria-expanded={expanded}
                  disabled={searching}
                  onClick={() => setSystemOpen(!systemOpen)}
                >
                  <ChevronRight size={14} className={expanded ? 'is-expanded' : ''} />
                  <span>{group.label}</span>
                  <small>{items.length}</small>
                </button>
              ) : (
                <h4>
                  {group.label}
                  <small>{items.length}</small>
                </h4>
              )}
              {expanded &&
                (items.length ? (
                  <div
                    className="font-list"
                    role="region"
                    aria-label={`${group.label}预览`}
                    tabIndex={0}
                  >
                    {items.map((font) => (
                      <div className="font-row" key={font.id}>
                        <div className="font-row-content">
                          <strong title={font.name}>{font.name}</strong>
                          {selected.includes(font.name) && (
                            <span className="font-in-use">使用中</span>
                          )}
                          <small title={font.path}>
                            {fontSources[font.source]}
                            {font.source !== 'system' ? ' · 离线可用' : ''}
                            {font.bytes ? ` · ${bytesLabel(font.bytes)}` : ''}
                          </small>
                          <p style={{ fontFamily: JSON.stringify(font.name) }}>
                            鸢笺，记录每一个想法。 Aa 0123 ∑
                          </p>
                        </div>
                        {['imported', 'downloaded'].includes(font.source) && (
                          <button
                            type="button"
                            aria-label={`移除 ${font.name}`}
                            disabled={disabled}
                            onClick={() => onRemove(font)}
                          >
                            移除
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="font-group-empty">
                    {group.id === 'managed' ? '暂无已下载或导入的字体' : '暂无可用字体'}
                  </p>
                ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
