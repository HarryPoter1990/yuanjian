import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from '../ui/icons';

export const OperationContext = createContext<{
  busy: string;
  notice: { id: string; message: string; error?: boolean } | null;
  shortcuts?: Record<string, string>;
}>({ busy: '', notice: null });

export function IconButton({
  label,
  shortcut,
  children,
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  shortcut?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const tooltipId = useId();
  const operation = useContext(OperationContext);
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const action = (
    {
      '打开 Markdown 文件': 'open',
      新建空白笔记: 'new',
      新建笔记: 'new',
      打开设置: 'settings',
      保存: 'save',
      查找: 'find',
    } as Record<string, string>
  )[label];
  const binding =
    shortcut ||
    operation.shortcuts?.[action] ||
    (
      { 撤销: 'Ctrl+Z', 重做: 'Ctrl+Shift+Z', 粗体: 'Ctrl+B', 斜体: 'Ctrl+I' } as Record<
        string,
        string
      >
    )[label];
  const text = binding ? `${label} · ${binding}` : label;
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setPosition(null);
  };
  const show = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) {
      const above = rect.bottom + 52 > window.innerHeight;
      setPosition({
        left: Math.max(20, Math.min(window.innerWidth - 20, rect.left + rect.width / 2)),
        top: above ? rect.top - 7 : rect.bottom + 7,
        above,
      });
    }
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="icon-button"
        aria-label={label}
        {...props}
        aria-describedby={position ? tooltipId : props['aria-describedby']}
        onMouseEnter={(event) => {
          onMouseEnter?.(event);
          timer.current = setTimeout(show, 350);
        }}
        onMouseLeave={(event) => {
          onMouseLeave?.(event);
          hide();
        }}
        onFocus={(event) => {
          onFocus?.(event);
          show();
        }}
        onBlur={(event) => {
          onBlur?.(event);
          hide();
        }}
      >
        {children}
      </button>
      {position &&
        createPortal(
          <span
            id={tooltipId}
            role="tooltip"
            className={`icon-tooltip ${position.above ? 'above' : ''}`}
            style={{ left: position.left, top: position.top }}
          >
            {text}
          </span>,
          ref.current?.closest('dialog') || document.querySelector('.app') || document.body,
        )}
    </>
  );
}
export function DropdownMenu({
  label,
  children,
  onClose,
}: {
  label: string;
  children: ReactNode;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        (!document.activeElement?.isConnected || document.activeElement === document.body)
      )
        previous.focus();
    };
  }, []);
  return (
    <>
      <button className="menu-dismiss" aria-label={`关闭${label}`} onClick={onClose} />
      <div
        ref={ref}
        className="dropdown-menu"
        role="menu"
        aria-label={label}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
            return;
          }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const items = Array.from(
            ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ||
              [],
          );
          const current = items.findIndex((item) => item === document.activeElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }}
      >
        {children}
      </div>
    </>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  busy = false,
  pending,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  wide?: boolean;
  busy?: boolean;
  pending?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const operation = useContext(OperationContext);
  const initialNotice = useRef(operation.notice?.id);
  const [changed, setChanged] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [closeMessage, setCloseMessage] = useState('');
  const continueButton = useRef<HTMLButtonElement>(null);
  const requestClose = (discardInput = false) => {
    if (busy || operation.busy) {
      setCloseMessage('当前操作仍在进行，请等待完成后关闭。');
      return;
    }
    if (!discardInput && (pending ?? changed)) {
      setDiscard(true);
      return;
    }
    onClose();
  };
  useEffect(() => {
    if (discard) continueButton.current?.focus();
  }, [discard]);
  const failure =
    operation.notice?.error && operation.notice.id !== initialNotice.current
      ? operation.notice.message
      : '';
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${wide ? 'modal-wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        if (
          e.target === e.currentTarget &&
          (e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom)
        )
          requestClose();
      }}
      onInputCapture={() => setChanged(true)}
      onChangeCapture={() => setChanged(true)}
    >
      <header className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <IconButton label="关闭对话框" onClick={() => requestClose()}>
          <X size={18} />
        </IconButton>
      </header>
      {children}
      {discard && (
        <div className="modal-close-guard" role="alert">
          <p>还有未提交的输入，关闭前要如何处理？</p>
          <button ref={continueButton} onClick={() => setDiscard(false)}>
            继续编辑
          </button>
          <button className="danger-text" onClick={() => requestClose(true)}>
            放弃输入并关闭
          </button>
        </div>
      )}
      {closeMessage && (
        <p className="modal-feedback" role="status">
          {closeMessage}
        </p>
      )}
      {(operation.busy || failure) && (
        <div
          className={`modal-feedback ${failure ? 'inline-error' : ''}`}
          role={failure ? 'alert' : 'status'}
        >
          {operation.busy ? `${operation.busy}中…` : failure}
        </div>
      )}
    </dialog>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty-state">{children}</p>;
}
export function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-field" data-setting-label={label} tabIndex={-1}>
      <div>
        <span className="field-label">{label}</span>
        {description && <p>{description}</p>}
      </div>
      <div className="field-control">{children}</div>
    </div>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange(value: boolean): void;
  label: string;
}) {
  return (
    <input
      className="switch"
      type="checkbox"
      role="switch"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={label}
    />
  );
}
