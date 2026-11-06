/**
 * Shared UI primitives for SSL Billing ("Ledger" design system, see DESIGN.md).
 *
 * Everything here follows the same rules so screens stay consistent:
 *  - semantic colour tokens only (see src/index.css) - light/dark come for free
 *  - interactive targets are >= 44px, or use `tap-44` to extend the hit area
 *  - focus rings are never removed
 *  - motion is 150 to 220ms ease-out and respects prefers-reduced-motion
 */
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { X, Loader2, Inbox, AlertCircle, Check, Info, AlertTriangle, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useBackLayer } from '../utils/backNav.js';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/* ------------------------------------------------------------------ Button */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * One solid button per screen (`primary`, ink-blue). Everything else is a quiet
 * outline or a ghost. Destructive intent is a red outline plus wording.
 */
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent-strong text-on-accent border border-accent-strong hover:bg-accent-strong-hover hover:border-accent-strong-hover',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-muted hover:border-line-strong',
  ghost: 'text-ink-soft border border-transparent hover:text-ink hover:bg-surface-sunken',
  danger: 'bg-surface text-danger-ink border border-danger-line hover:bg-danger-soft',
  success: 'bg-surface text-positive-ink border border-positive-line hover:bg-positive-soft',
};

// Phones get 40px controls (thumb), desktop 32-36px (mouse, density)
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'text-sm h-9 sm:h-8 px-2.5 gap-1.5 rounded-control',
  md: 'text-sm h-10 sm:h-9 px-3 gap-1.5 rounded-control',
  lg: 'text-base h-11 sm:h-10 px-4 gap-2 rounded-control',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, fullWidth, className, children, disabled, ...rest }, ref
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center font-medium whitespace-nowrap select-none',
        'transition-[background-color,border-color,color] duration-[var(--duration-fast)] ease-out',
        'disabled:opacity-45 disabled:pointer-events-none [&_svg]:w-4 [&_svg]:h-4 [&_svg]:shrink-0',
        !isDisabled && 'cursor-pointer',
        BUTTON_SIZES[size], BUTTON_VARIANTS[variant],
        fullWidth && 'w-full', className
      )}
      {...rest}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
});

/** Square icon-only button. Always pass `label` - it becomes the accessible name. */
export const IconButton = React.forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(
  function IconButton({ label, className, children, variant = 'ghost', ...rest }, ref) {
    return (
      <button
        ref={ref}
        aria-label={label}
        title={label}
        className={cx(
          'tap-44 inline-flex items-center justify-center w-8 h-8 rounded-control cursor-pointer shrink-0',
          'transition-colors duration-[var(--duration-fast)] ease-out disabled:opacity-40 disabled:pointer-events-none',
          '[&_svg]:w-4 [&_svg]:h-4',
          BUTTON_VARIANTS[variant], className
        )}
        {...rest}
      >
        {children}
      </button>
    );
  }
);

/* -------------------------------------------------------------------- Card */
export const Card: React.FC<React.HTMLAttributes<HTMLDivElement> & { padded?: boolean }> = ({
  padded = true, className, children, ...rest
}) => (
  <div className={cx('panel', padded && 'p-3 sm:p-4', className)} {...rest}>
    {children}
  </div>
);

/** Card header row: title on the left, actions on the right, hairline below. */
export const CardHeader: React.FC<{ title: React.ReactNode; hint?: React.ReactNode; actions?: React.ReactNode; className?: string }> = ({
  title, hint, actions, className,
}) => (
  <div className={cx('flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b border-line', className)}>
    <div className="min-w-0">
      <h2 className="text-sm font-semibold text-ink truncate">{title}</h2>
      {hint && <p className="text-xs text-ink-faint truncate">{hint}</p>}
    </div>
    {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
  </div>
);

export const SectionHeading: React.FC<{ title: string; hint?: string; actions?: React.ReactNode }> = ({
  title, hint, actions,
}) => (
  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
    <div className="min-w-0">
      <h2 className="text-sm font-semibold text-ink truncate">{title}</h2>
      {hint && <p className="text-xs text-ink-faint mt-0.5">{hint}</p>}
    </div>
    {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
  </div>
);

/* --------------------------------------------------------------- StatCard */
const TONE_TEXT = {
  default: 'text-ink',
  positive: 'text-positive-ink',
  warning: 'text-warning-ink',
  danger: 'text-danger-ink',
  accent: 'text-accent-ink',
} as const;

export const StatCard: React.FC<{
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'default' | 'positive' | 'warning' | 'danger' | 'accent';
  icon?: React.ReactNode;
  loading?: boolean;
  onClick?: () => void;
  className?: string;
}> = ({ label, value, sub, tone = 'default', icon, loading, onClick, className }) => {
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={cx(
        'panel px-3 py-2.5 sm:px-4 sm:py-3 text-left w-full min-w-0',
        onClick && 'cursor-pointer panel-hover',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-faint truncate">{label}</span>
        {icon && <span className="text-ink-faint shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5" aria-hidden="true">{icon}</span>}
      </div>
      {loading ? (
        <div className="skeleton h-6 w-24 mt-1.5" />
      ) : (
        <div className={cx('numeral text-lg sm:text-xl leading-tight mt-0.5 truncate', TONE_TEXT[tone])}>
          {value}
        </div>
      )}
      {sub && !loading && <div className="text-xs text-ink-faint mt-0.5 truncate">{sub}</div>}
    </Tag>
  );
};

/* ------------------------------------------------------------------- Badge */
export type BadgeTone = 'neutral' | 'positive' | 'warning' | 'danger' | 'info' | 'accent';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-ink-soft',
  positive: 'bg-positive-soft text-positive-ink',
  warning: 'bg-warning-soft text-warning-ink',
  danger: 'bg-danger-soft text-danger-ink',
  info: 'bg-info-soft text-info-ink',
  accent: 'bg-accent-soft text-accent-ink',
};

const DOT_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-ink-faint', positive: 'bg-positive', warning: 'bg-warning',
  danger: 'bg-danger', info: 'bg-info', accent: 'bg-accent',
};

export const Badge: React.FC<{
  tone?: BadgeTone;
  icon?: React.ReactNode;
  /** Lead with a small dot (status) instead of an icon. */
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ tone = 'neutral', icon, dot, className, children }) => (
  <span className={cx(
    'inline-flex items-center gap-1 h-5 px-1.5 rounded-[4px] text-xs font-medium whitespace-nowrap leading-none',
    '[&_svg]:w-3 [&_svg]:h-3',
    BADGE_TONES[tone], className
  )}>
    {dot && <span className={cx('status-dot', DOT_TONES[tone])} aria-hidden="true" />}
    {!dot && icon}
    {children}
  </span>
);

/** Invoice status. A dot and a word, so it never depends on colour alone. */
export const StatusBadge: React.FC<{ status?: string }> = ({ status }) => {
  const s = (status || 'issued').toLowerCase();
  const map: Record<string, { tone: BadgeTone; label: string }> = {
    paid: { tone: 'positive', label: 'Paid' },
    partially_paid: { tone: 'warning', label: 'Part paid' },
    overdue: { tone: 'danger', label: 'Overdue' },
    cancelled: { tone: 'neutral', label: 'Cancelled' },
    draft: { tone: 'neutral', label: 'Draft' },
    issued: { tone: 'info', label: 'Unpaid' },
  };
  const cfg = map[s] || map.issued;
  return <Badge tone={cfg.tone} dot>{cfg.label}</Badge>;
};

/* -------------------------------------------------------------- EmptyState */
export const EmptyState: React.FC<{
  title: string;
  message?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}> = ({ title, message, icon, action }) => (
  <div className="py-10 px-6 text-center">
    <div className="text-ink-faint flex justify-center [&_svg]:w-6 [&_svg]:h-6" aria-hidden="true">
      {icon || <Inbox />}
    </div>
    <h3 className="mt-2 text-sm font-semibold text-ink">{title}</h3>
    {message && <p className="mt-0.5 text-sm text-ink-faint max-w-sm mx-auto">{message}</p>}
    {action && <div className="mt-3 flex justify-center">{action}</div>}
  </div>
);

/** Failed request: what went wrong and the way out. */
export const ErrorState: React.FC<{ message?: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="py-10 px-6 text-center">
    <AlertCircle className="w-6 h-6 mx-auto text-danger" aria-hidden="true" />
    <h3 className="mt-2 text-sm font-semibold text-ink">Could not load this</h3>
    <p className="mt-0.5 text-sm text-ink-faint max-w-sm mx-auto">{message || 'Check your connection and try again.'}</p>
    {onRetry && <div className="mt-3 flex justify-center"><Button size="sm" onClick={onRetry}>Try again</Button></div>}
  </div>
);

export const Spinner: React.FC<{ label?: string; className?: string }> = ({ label = 'Loading', className }) => (
  <div className={cx('py-10 flex items-center justify-center gap-2', className)} role="status" aria-live="polite">
    <Loader2 className="w-4 h-4 animate-spin text-ink-faint" aria-hidden="true" />
    <span className="text-sm text-ink-faint">{label}…</span>
  </div>
);

/** Skeleton rows - shown instead of a blank screen so layout does not jump. */
export const SkeletonRows: React.FC<{ rows?: number; className?: string }> = ({ rows = 5, className }) => (
  <div className={cx('divide-y divide-line', className)} aria-hidden="true">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex items-center gap-3 px-3 sm:px-4 py-3">
        <div className="skeleton h-3.5 w-24" />
        <div className="skeleton h-3.5 flex-1 max-w-[40%]" />
        <div className="skeleton h-3.5 w-16 ml-auto" />
      </div>
    ))}
  </div>
);

/* ------------------------------------------------------------------- Field */
export const Field: React.FC<{
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ label, htmlFor, required, hint, error, action, className, children }) => (
  <div className={cx('min-w-0', className)}>
    {(label || action) && (
      <div className="flex items-center justify-between gap-2 mb-1 min-h-4">
        <label htmlFor={htmlFor} className="text-xs font-medium text-ink-soft">
          {label}
          {required && <span className="text-danger ml-0.5" aria-hidden="true">*</span>}
          {required && <span className="sr-only"> (required)</span>}
        </label>
        {action}
      </div>
    )}
    {children}
    {hint && !error && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    {error && (
      <p role="alert" className="mt-1 text-xs text-danger-ink flex items-center gap-1">
        <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
        {error}
      </p>
    )}
  </div>
);

export const inputCls =
  'w-full bg-surface border border-line rounded-control px-2.5 h-10 sm:h-9 text-sm text-ink ' +
  'placeholder:text-ink-faint transition-[border-color,box-shadow] duration-[var(--duration-fast)] ' +
  'hover:border-line-strong focus:border-accent focus:outline-none focus:ring-focus ' +
  'disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-surface-sunken ' +
  '[&:read-only:not(select)]:bg-surface-muted [&:read-only:not(select)]:text-ink-soft';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cx(inputCls, className)} {...rest} />;
  }
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cx(inputCls, 'h-auto py-2 leading-snug', className)} {...rest} />;
  }
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={cx(inputCls, 'cursor-pointer appearance-none bg-no-repeat pr-8', className)}
        style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23818179' stroke-width='2'%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3C/svg%3E\")",
          backgroundPosition: 'right 0.5rem center',
          backgroundSize: '1rem',
        }}
        {...rest}
      >
        {children}
      </select>
    );
  }
);

/* --------------------------------------------------------- Segmented control */
/** Compact single-choice switch (filters, modes). Active = raised paper chip. */
export function Segmented<T extends string>({ options, value, onChange, label, className, size = 'md' }: {
  options: readonly { value: T; label: React.ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label}
      className={cx('inline-flex items-center p-0.5 rounded-control bg-surface-sunken border border-line max-w-full overflow-x-auto scrollbar-none', className)}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex items-center gap-1.5 px-2.5 rounded-[4px] text-sm whitespace-nowrap cursor-pointer',
              'transition-colors duration-[var(--duration-fast)]',
              size === 'sm' ? 'h-7' : 'h-8 sm:h-7',
              on ? 'bg-surface text-ink font-medium shadow-[0_1px_2px_rgb(0_0_0/0.08)] ring-1 ring-line'
                 : 'text-ink-faint hover:text-ink'
            )}>
            {o.label}
            {o.count !== undefined && (
              <span className={cx('text-xs tabular-nums', on ? 'text-ink-faint' : 'text-ink-faint/80')}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------- Modal */
/**
 * Accessible dialog: Escape closes, focus is trapped and restored, background
 * scroll is locked, and on phones it becomes a bottom sheet.
 */
export const Modal: React.FC<{
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}> = ({ onClose, title, subtitle, size = 'md', headerActions, footer, children }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  // Phone Back button closes the dialog instead of leaving the app
  useBackLayer(onClose);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    // Focus the dialog itself: screen readers announce it, Tab moves into it, and
    // phones don't pop the keyboard (or ring the Close button) on open.
    const t = window.setTimeout(() => panelRef.current?.focus({ preventScroll: true }), 30);
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = overflow;
      restoreFocusRef.current?.focus?.();
    };
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!nodes || nodes.length === 0) return;
    const list = Array.from(nodes as NodeListOf<HTMLElement>).filter((n) => n.offsetParent !== null);
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, [onClose]);

  const width = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl', '2xl': 'sm:max-w-6xl' }[size];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6 bg-scrim animate-fade-in"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          'sheet w-full flex flex-col shadow-overlay outline-none',
          'max-h-[94dvh] sm:max-h-[88dvh] rounded-t-overlay sm:rounded-overlay border-t sm:border border-line',
          'animate-sheet sm:animate-rise', width
        )}
      >
        <div className="sm:hidden pt-2 flex justify-center shrink-0" aria-hidden="true">
          <div className="w-9 h-1 rounded-full bg-line-strong" />
        </div>

        <header className="flex items-center justify-between gap-3 pl-4 pr-2 sm:pl-5 sm:pr-3 h-12 border-b border-line shrink-0">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-ink truncate leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-ink-faint truncate leading-tight">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {headerActions}
            <IconButton label="Close" onClick={onClose}><X /></IconButton>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4">{children}</div>

        {footer && (
          <footer className="px-4 sm:px-5 py-2.5 border-t border-line shrink-0 pb-safe sm:pb-2.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------- Toast */
/**
 * Floats at the bottom (above the phone tab bar), auto-dismisses, never steals
 * focus. Rendered in place, positioned fixed, so callers need no portal.
 */
export const Toast: React.FC<{ message: string; tone?: 'success' | 'error' | 'info'; onDismiss: () => void }> = ({
  message, tone = 'success', onDismiss,
}) => {
  useEffect(() => {
    const t = window.setTimeout(onDismiss, 4000);
    return () => window.clearTimeout(t);
  }, [message, onDismiss]);

  const cfg = {
    success: { cls: 'text-positive', icon: <Check /> },
    error: { cls: 'text-danger', icon: <AlertCircle /> },
    info: { cls: 'text-info', icon: <Info /> },
  }[tone];

  return (
    <div aria-live="polite"
      className="fixed z-[60] left-3 right-3 bottom-[76px] lg:bottom-5 lg:left-auto lg:right-5 lg:w-[380px]
                 flex items-center gap-2.5 pl-3 pr-1 py-1.5 rounded-card bg-ink text-ink-inverse shadow-overlay animate-rise">
      <span className={cx('shrink-0 [&_svg]:w-4 [&_svg]:h-4', cfg.cls)} aria-hidden="true">{cfg.icon}</span>
      <span className="text-sm flex-1 min-w-0">{message}</span>
      <button onClick={onDismiss} aria-label="Dismiss message"
        className="tap-44 w-7 h-7 inline-flex items-center justify-center rounded-control opacity-70 hover:opacity-100 cursor-pointer">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

/** Inline form error banner that moves keyboard focus to itself when it appears. */
export const FormError: React.FC<{ message?: string | null }> = ({ message }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (message) ref.current?.focus(); }, [message]);
  if (!message) return null;
  return (
    <div ref={ref} tabIndex={-1} role="alert"
      className="px-3 py-2 bg-danger-soft border border-danger-line rounded-control text-danger-ink text-sm flex items-start gap-2 outline-none">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
};

/* ------------------------------------------------------- Responsive table */
/**
 * A data table that becomes a list of rows below `sm`, so phones never scroll
 * sideways.
 */
export interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
  /** Hide this column on small screens inside the desktop table */
  hideBelow?: 'sm' | 'md' | 'lg';
  cell: (row: T) => React.ReactNode;
}

export function DataTable<T extends { id: string }>({
  columns, rows, onRowClick, mobileCard, loading, empty, caption, rowClassName,
}: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  mobileCard: (row: T) => React.ReactNode;
  loading?: boolean;
  empty?: React.ReactNode;
  caption?: string;
  rowClassName?: (row: T) => string | undefined;
}) {
  if (loading) return <SkeletonRows rows={6} />;
  if (rows.length === 0) return <>{empty || <EmptyState title="Nothing here yet" />}</>;

  const hideCls = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' };

  return (
    <>
      <ul className="sm:hidden divide-y divide-line">
        {rows.map((row) => (
          <li key={row.id} className={rowClassName?.(row)}>
            {onRowClick ? (
              <div role="button" tabIndex={0} onClick={() => onRowClick(row)}
                onKeyDown={(e) => { if (e.key === 'Enter') onRowClick(row); }}
                className="w-full text-left px-3 py-2.5 active:bg-surface-muted transition-colors cursor-pointer">
                {mobileCard(row)}
              </div>
            ) : (
              <div className="px-3 py-2.5">{mobileCard(row)}</div>
            )}
          </li>
        ))}
      </ul>

      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-left text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-surface-muted border-b border-line">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col"
                  className={cx(
                    'h-8 px-3 first:pl-4 last:pr-4 text-xs font-medium text-ink-faint whitespace-nowrap',
                    c.align === 'right' && 'text-right', c.align === 'center' && 'text-center',
                    c.hideBelow && hideCls[c.hideBelow]
                  )}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row); } : undefined}
                className={cx(
                  'transition-colors duration-[var(--duration-fast)]',
                  onRowClick && 'cursor-pointer hover:bg-surface-muted focus-visible:bg-surface-muted',
                  rowClassName?.(row)
                )}>
                {columns.map((c) => (
                  <td key={c.key}
                    className={cx('py-2 px-3 first:pl-4 last:pr-4 text-ink-soft align-middle',
                      c.align === 'right' && 'text-right', c.align === 'center' && 'text-center',
                      c.hideBelow && hideCls[c.hideBelow], c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ------------------------------------------------------- Trend indicator */
/** Change vs the previous period: arrow + sign + colour, never colour alone. */
export const TrendChip: React.FC<{
  value: number;
  /** Set when a rise is bad news (outstanding, overdue). */
  invert?: boolean;
  className?: string;
}> = ({ value, invert, className }) => {
  const up = value >= 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cx(
      'inline-flex items-center gap-0.5 text-xs font-medium tabular-nums',
      good ? 'text-positive-ink' : 'text-danger-ink',
      className
    )}>
      <Icon className="w-3 h-3" aria-hidden="true" />
      {Math.abs(value) > 999 ? '999+' : Math.abs(value).toFixed(0)}%
    </span>
  );
};

/* ------------------------------------------------------------ Metric strip */
/** KPI band: one surface split by hairlines. 2-up on phones, 4-up on desktop. */
export const MetricStrip: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cx('panel overflow-hidden metric-strip grid-cols-2 lg:grid-cols-4', className)}>
    {children}
  </div>
);

export const Metric: React.FC<{
  label: string;
  value: React.ReactNode;
  compare?: React.ReactNode;
  trend?: number;
  invertTrend?: boolean;
  visual?: React.ReactNode;
  tone?: 'default' | 'positive' | 'warning' | 'danger' | 'accent';
  loading?: boolean;
  onClick?: () => void;
}> = ({ label, value, compare, trend, invertTrend, visual, tone = 'default', loading, onClick }) => {
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={cx(
        'px-3 py-2.5 sm:px-4 sm:py-3 text-left w-full min-w-0 transition-colors duration-[var(--duration-fast)]',
        onClick && 'cursor-pointer hover:bg-surface-muted'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-faint truncate">{label}</span>
        {trend !== undefined && !loading && <TrendChip value={trend} invert={invertTrend} />}
      </div>
      <div className="flex items-end justify-between gap-3 mt-0.5">
        <div className="min-w-0">
          {loading ? (
            <div className="skeleton h-6 w-24 mt-1" />
          ) : (
            <div className={cx('numeral text-lg sm:text-xl leading-tight truncate', TONE_TEXT[tone])}>{value}</div>
          )}
          {compare && !loading && <div className="text-xs text-ink-faint mt-0.5 truncate">{compare}</div>}
        </div>
        {visual && !loading && <div className="shrink-0 hidden sm:block">{visual}</div>}
      </div>
    </Tag>
  );
};

/* ---------------------------------------------------------------- Sparkline */
/** Tiny inline bar chart - indicative only, no axes. Latest bar in accent. */
export const Sparkbars: React.FC<{ data: number[]; className?: string; label?: string }> = ({ data, className, label }) => {
  if (data.length < 3) return null;
  const max = Math.max(...data, 1);
  return (
    <div className={cx('flex items-end gap-[2px] h-7', className)} role="img" aria-label={label || 'Trend'}>
      {data.map((v, i) => (
        <span
          key={i}
          className={cx('w-[3px] rounded-[1px]', i === data.length - 1 ? 'bg-accent' : 'bg-line-strong')}
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
};

/* ------------------------------------------------------------- Ring gauge */
/** Small progress ring, value 0-100. */
export const RingGauge: React.FC<{ value: number; size?: number; label?: string }> = ({ value, size = 36, label }) => {
  const pct = Math.max(0, Math.min(100, value));
  const r = (size - 5) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
      aria-label={label || `${pct.toFixed(0)} percent`} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth="3" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c}
        style={{ transition: 'stroke-dashoffset 500ms var(--ease-out-soft)' }}
      />
    </svg>
  );
};

/* ------------------------------------------------------------ Avatar chip */
/** Initials chip, neutral - identity by letters, not by random colours. */
export const AvatarChip: React.FC<{ name?: string; className?: string; square?: boolean }> = ({ name, className, square }) => {
  const initials = String(name || '?')
    .split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  return (
    <span
      className={cx('inline-flex items-center justify-center w-6 h-6 text-[11px] font-semibold shrink-0',
        'bg-surface-sunken text-ink-soft border border-line',
        square ? 'rounded-control' : 'rounded-full', className)}
      title={name}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
};

/* -------------------------------------------------------------- Pill tabs */
/** Tabs as a segmented control. */
export function PillTabs<T extends string>({ tabs, value, onChange, className }: {
  tabs: { key: T; label: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (k: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cx('inline-flex items-center p-0.5 rounded-control bg-surface-sunken border border-line max-w-full overflow-x-auto scrollbar-none', className)}>
      {tabs.map(t => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={cx(
              'inline-flex items-center gap-1.5 px-2.5 h-8 sm:h-7 rounded-[4px] text-sm whitespace-nowrap [&_svg]:w-3.5 [&_svg]:h-3.5',
              'cursor-pointer transition-colors duration-[var(--duration-fast)]',
              active ? 'bg-surface text-ink font-medium shadow-[0_1px_2px_rgb(0_0_0/0.08)] ring-1 ring-line' : 'text-ink-faint hover:text-ink'
            )}
          >
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- Bar ranking */
/** Ranked "label - value - bar" rows. */
export const BarRank: React.FC<{
  rows: { label: string; value: number; sub?: string }[];
  format?: (n: number) => string;
  className?: string;
}> = ({ rows, format, className }) => {
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <ul className={cx('space-y-2.5', className)}>
      {rows.map((r, i) => (
        <li key={i} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <span className="text-sm text-ink-soft truncate">{r.label}</span>
            <span className="text-sm text-ink tabular-nums font-medium shrink-0">{format ? format(r.value) : r.value}</span>
          </div>
          <div className="h-1 rounded-full bg-surface-sunken overflow-hidden">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
};

/* ------------------------------------------------------------------- Theme */
export type ThemeChoice = 'light' | 'dark' | 'system';

export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [theme, setThemeState] = useState<ThemeChoice>(() => {
    // Light is the default; dark and system are explicit choices.
    try { return (localStorage.getItem('ssl_theme') as ThemeChoice) || 'light'; } catch { return 'light'; }
  });

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.body.setAttribute('data-theme', dark ? 'dark' : 'light');
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    };
    apply();
    if (theme === 'system') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [theme]);

  const setTheme = useCallback((t: ThemeChoice) => {
    try { localStorage.setItem('ssl_theme', t); } catch { /* private mode */ }
    setThemeState(t);
  }, []);

  return [theme, setTheme];
}
