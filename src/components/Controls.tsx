import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';

export const OperationContext = createContext<{
  busy: string;
  notice: { id: string; message: string; error?: boolean } | null;
}>({ busy: '', notice: null });

export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button type="button" className="icon-button" title={label} aria-label={label} {...props}>
      {children}
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const operation = useContext(OperationContext);
  const initialNotice = useRef(operation.notice?.id);
  const failure =
    operation.notice?.error && operation.notice.id !== initialNotice.current
      ? operation.notice.message
      : '';
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${wide ? 'modal-wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <IconButton label="关闭对话框" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </header>
      {children}
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
    <div className="setting-field">
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
