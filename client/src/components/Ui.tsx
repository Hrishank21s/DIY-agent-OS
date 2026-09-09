import { ReactNode, useEffect } from 'react';
import StatusBadge from './StatusBadge';

export { StatusBadge };

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function LoadingBlock({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loading-block">
      <Spinner />
      <span>{label}...</span>
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return <div className="error-block">{message}</div>;
}

export function InlineError({ message }: { message: string }) {
  return <div className="inline-error">{message}</div>;
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Button({
  children,
  variant = 'default',
  type = 'button',
  disabled,
  onClick,
  title,
}: {
  children: ReactNode;
  variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'success';
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      className={`btn btn-${variant}`}
      type={type}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}

export function IconButton({ children, onClick, title }: { children: ReactNode; onClick?: () => void; title?: string }) {
  return (
    <button className="icon-btn" type="button" onClick={onClick} title={title}>
      {children}
    </button>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required,
  autoFocus,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <input
        type={type}
        className="input"
        value={value}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <textarea
        className="input textarea"
        value={value}
        placeholder={placeholder}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle ${disabled ? 'toggle-disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
      {label && <span className="toggle-label">{label}</span>}
    </label>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 'md',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal modal-${width}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <IconButton onClick={onClose} title="Close">
            x
          </IconButton>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  danger,
  busy,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working...' : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="modal-message">{message}</p>
    </Modal>
  );
}

export function TagList({ tags, onRemove }: { tags: string[]; onRemove?: (t: string) => void }) {
  if (!tags.length) {
    return <span className="muted">none</span>;
  }
  return (
    <div className="tag-list">
      {tags.map((t) => (
        <span key={t} className="tag">
          {t}
          {onRemove && (
            <button className="tag-remove" onClick={() => onRemove(t)} title={`Remove ${t}`}>
              x
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

function formatWhen(value: string | null): string {
  if (!value) {
    return '';
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return value;
  }
  return d.toLocaleString();
}

export function TimeText({ value }: { value: string | null }) {
  return <span className="time-text">{formatWhen(value)}</span>;
}