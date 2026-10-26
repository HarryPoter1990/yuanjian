import { useEffect, useState } from 'react';
import { shortcutConflicts, shortcutKey } from '../shared/shortcuts';
import { shortcutLabels, shortcutSetting } from '../ui/settingsFields';
export function ShortcutControl({
  action,
  bindings,
  defaultValue,
  onChange,
}: {
  action: string;
  bindings: Record<string, string>;
  defaultValue?: string;
  onChange(bindings: Record<string, string>): void;
}) {
  const value = bindings[action] ?? '';
  const [draft, setDraft] = useState(value),
    [recording, setRecording] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const conflicts = shortcutConflicts(bindings, action, draft);
  const invalid = Boolean(draft.trim() && !shortcutKey(draft));
  function assign(candidate: string, replace = false) {
    setDraft(candidate);
    const found = shortcutConflicts(bindings, action, candidate);
    if (
      (candidate.trim() && !shortcutKey(candidate)) ||
      found.some((item) => item.fixed) ||
      (!replace && found.length)
    )
      return;
    const next = { ...bindings, [action]: candidate };
    if (replace) for (const item of found) next[item.action] = '';
    onChange(next);
  }
  return (
    <div className="shortcut-control">
      <input
        aria-label={shortcutSetting(action).label}
        value={draft}
        onFocus={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onChange={(event) => assign(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.key === 'Tab') return;
          if (event.ctrlKey || event.metaKey || event.altKey || /^F\d+$/.test(event.key)) {
            event.preventDefault();
            if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
            assign(
              [
                event.ctrlKey || event.metaKey ? 'Ctrl' : '',
                event.altKey ? 'Alt' : '',
                event.shiftKey ? 'Shift' : '',
                event.key === '+' ? 'Plus' : event.key === ' ' ? 'Space' : event.key.toLowerCase(),
              ]
                .filter(Boolean)
                .join('+'),
            );
          }
        }}
      />
      <button
        aria-label={`恢复${shortcutLabels[action] || action}默认快捷键`}
        disabled={!defaultValue || draft === defaultValue}
        onClick={() => assign(defaultValue!)}
      >
        恢复默认
      </button>
      {recording && <p className="subtle">正在录制：请按下组合键，Tab 移到下一项。</p>}
      {invalid && (
        <p className="inline-error" role="alert">
          组合键无效，原绑定尚未改变。请使用 Ctrl/Alt 加按键或 F1–F24。
        </p>
      )}
      {conflicts.length > 0 && (
        <>
          <p className="inline-error" role="alert">
            与{conflicts.map((item) => `“${shortcutLabels[item.action] || item.label}”`).join('、')}
            使用相同组合键，原绑定尚未改变。
            {conflicts.some((item) => item.fixed) ? '这是固定编辑操作，请选择其他组合键。' : ''}
          </p>
          {!conflicts.some((item) => item.fixed) && (
            <button onClick={() => assign(draft, true)}>替换原绑定</button>
          )}
        </>
      )}
    </div>
  );
}
