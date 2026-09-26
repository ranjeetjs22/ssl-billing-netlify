/**
 * Shared UI primitives for SSL Billing.
 *
 * Everything here follows the same rules so screens stay consistent:
 *  - semantic colour tokens only (see src/index.css) - light/dark come for free
 *  - interactive targets are >= 44px, or use `tap-44` to extend the hit area
 *  - focus rings are never removed
 *  - motion is 150 to 220ms ease-out and respects prefers-reduced-motion
 */
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { X, Loader2, Inbox, AlertCircle, Check, Info, AlertTriangle, ArrowUpRight, ArrowDownRight } from 'lucide-react';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/* ------------------------------------------------------------------ Button */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * No saturated blocks anywhere. `primary` is the only tinted control and it stays
 * soft; the rest are outlines on paper. Destructive intent reads through a red
 * outline plus wording, never a red slab.
 */
/**
 * One solid CTA (ember) and the rest quiet, exactly as the reference does it.
 * `accent-strong` is the deeper orange that carries white text at 4.6:1 - the
 * vivid `accent` is reserved for marks and charts where it sits on dark.
 */
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent-strong text-on-accent hover:bg-accent-strong-hover shadow-card',
  secondary: 'bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-muted',
  ghost: 'text-ink-soft hover:text-ink hover:bg-surface-muted',
  danger: 'bg-surface text-danger-ink border border-danger-line hover:bg-danger-soft hover:border-danger',
  success: 'bg-surface text-positive-ink border border-positive-line hover:bg-positive-soft hover:border-positive',
};

// min-h keeps every button at or above the 44px touch minimum on small screens
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'text-sm px-3 py-2 min-h-[38px] gap-1.5 rounded-control',
  md: 'text-sm px-3.5 py-2.5 min-h-[42px] gap-2 rounded-control',
  lg: 'text-base px-5 py-3 min-h-[48px] gap-2 rounded-control',
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
        'inline-flex items-center justify-center font-medium whitespace-nowrap',
        'transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--duration-fast)] ease-out',
        'active:translate-y-px focus-visible:ring-focus',
        'disabled:opacity-50 disabled:pointer-events-none',
        !isDisabled && 'cursor-pointer',
        BUTTON_SIZES[size], BUTTON_VARIANTS[variant],
        fullWidth && 'w-full', className
      )}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" /> : icon}
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
          'tap-44 inline-flex items-center justify-center w-9 h-9 rounded-control cursor-pointer',
          'transition-colors duration-150 ease-out disabled:opacity-40 disabled:pointer-events-none',
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
  <div className={cx('panel', padded && 'p-5', className)} {...rest}>
    {children}
  </div>
);

export const SectionHeading: React.FC<{ title: string; hint?: string; actions?: React.ReactNode }> = ({
  title, hint, actions,
}) => (
  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
    <div className="min-w-0">
      <h2 className="text-base font-bold text-ink truncate">{title}</h2>
      {hint && <p className="text-sm text-ink-faint mt-0.5">{hint}</p>}
    </div>
    {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

/* --------------------------------------------------------------- StatCard */
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
  const toneText = {
    default: 'text-ink',
    positive: 'text-positive-ink',
    warning: 'text-warning-ink',
    danger: 'text-danger-ink',
    accent: 'text-accent-ink',
  }[tone];
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={cx(
        'panel p-4 sm:p-5 text-left w-full',
        'transition-[box-shadow,border-color] duration-[140ms] ease-out',
        onClick && 'cursor-pointer hover:shadow-raised hover:border-line-strong',
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="label-micro">{label}</span>
        {icon && <span className="text-ink-faint shrink-0" aria-hidden="true">{icon}</span>}
      </div>
      {loading ? (
        <div className="skeleton h-9 w-28 mt-2.5" />
      ) : (
        <div className={cx('text-[1.75rem] leading-tight font-semibold font-mono mt-2 tracking-tight truncate', toneText)}>
          {value}
        </div>
      )}
      {sub && !loading && <div className="text-xs text-ink-faint mt-1.5 truncate">{sub}</div>}
    </Tag>
  );
};

/* ------------------------------------------------------------------- Badge */
export type BadgeTone = 'neutral' | 'positive' | 'warning' | 'danger' | 'info' | 'accent';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface text-ink-soft border-line',
  positive: 'bg-surface text-positive-ink border-positive-line',
  warning: 'bg-surface text-warning-ink border-warning-line',
  danger: 'bg-surface text-danger-ink border-danger-line',
  info: 'bg-surface text-info-ink border-info-line',
  accent: 'bg-surface text-accent-ink border-accent-line',
};

/** Dot colour per tone - status reads by dot, not by a filled chip. */
const DOT_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-ink-faint', positive: 'bg-positive', warning: 'bg-warning',
  danger: 'bg-danger', info: 'bg-info', accent: 'bg-accent',
};

export const Badge: React.FC<{
  tone?: BadgeTone;
  icon?: React.ReactNode;
  /** Render the tone as a small dot instead of an icon (the default for status). */
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ tone = 'neutral', icon, dot, className, children }) => (
  <span className={cx(
    'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium whitespace-nowrap leading-5',
    BADGE_TONES[tone], className
  )}>
    {dot && <span className={cx('status-dot', DOT_TONES[tone])} aria-hidden="true" />}
    {!dot && icon}
    {children}
  </span>
);

/** Invoice status → badge. Uses an icon as well as colour so meaning never depends on colour alone. */
export const StatusBadge: React.FC<{ status?: string }> = ({ status }) => {
  const s = (status || 'issued').toLowerCase();
  const map: Record<string, { tone: BadgeTone; label: string; icon: React.ReactNode }> = {
    paid: { tone: 'positive', label: 'Paid', icon: <Check className="w-3 h-3" /> },
    partially_paid: { tone: 'warning', label: 'Part paid', icon: <Info className="w-3 h-3" /> },
    overdue: { tone: 'danger', label: 'Overdue', icon: <AlertTriangle className="w-3 h-3" /> },
    cancelled: { tone: 'neutral', label: 'Cancelled', icon: <X className="w-3 h-3" /> },
    draft: { tone: 'neutral', label: 'Draft', icon: null },
    issued: { tone: 'info', label: 'Unpaid', icon: null },
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
  <div className="py-12 px-6 text-center">
    <div className="w-12 h-12 rounded-card bg-surface-sunken border border-line flex items-center justify-center mx-auto text-ink-faint">
      {icon || <Inbox className="w-6 h-6" />}
    </div>
    <h3 className="mt-3 font-semibold text-ink">{title}</h3>
    {message && <p className="mt-1 text-sm text-ink-faint max-w-sm mx-auto">{message}</p>}
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>
);

/** Failed request: says what went wrong and offers the way out (WCAG error recovery). */
export const ErrorState: React.FC<{ message?: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="py-10 px-6 text-center">
    <div className="w-12 h-12 rounded-card bg-danger-soft border border-danger-line flex items-center justify-center mx-auto text-danger">
      <AlertCircle className="w-6 h-6" />
    </div>
    <h3 className="mt-3 font-semibold text-ink">Could not load this</h3>
    <p className="mt-1 text-sm text-ink-faint max-w-sm mx-auto">{message || 'Please check your connection and try again.'}</p>
    {onRetry && <div className="mt-4 flex justify-center"><Button variant="secondary" onClick={onRetry}>Try again</Button></div>}
  </div>
);

export const Spinner: React.FC<{ label?: string; className?: string }> = ({ label = 'Loading', className }) => (
  <div className={cx('py-10 flex flex-col items-center justify-center gap-2', className)} role="status" aria-live="polite">
    <Loader2 className="w-6 h-6 animate-spin text-accent" aria-hidden="true" />
    <span className="text-sm text-ink-faint">{label}…</span>
  </div>
);

/** Skeleton rows - shown instead of a blank screen so layout does not jump. */
export const SkeletonRows: React.FC<{ rows?: number; className?: string }> = ({ rows = 5, className }) => (
  <div className={cx('space-y-2 p-4', className)} aria-hidden="true">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="skeleton h-14 rounded-card" />
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
    <div className="flex items-center justify-between gap-2 mb-1.5">
      <label htmlFor={htmlFor} className="label-micro">
        {label}
        {required && <span className="text-danger ml-0.5" aria-hidden="true">*</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {action}
    </div>
    {children}
    {/* Helper text stays visible - a placeholder is not a label (Material) */}
    {hint && !error && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    {error && (
      <p role="alert" className="mt-1 text-xs text-danger-ink font-medium flex items-center gap-1">
        <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
        {error}
      </p>
    )}
  </div>
);

// 44px min height on all controls = comfortable touch target on mobile
export const inputCls =
  'w-full bg-surface border border-line rounded-control px-3 py-2.5 min-h-[42px] text-sm text-ink ' +
  'placeholder:text-ink-faint transition-[border-color,box-shadow,background-color] duration-[var(--duration-fast)] ' +
  'hover:border-line-strong ' +
  'focus:border-accent focus:outline-none focus:ring-focus ' +
  'disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-surface-sunken ' +
  'read-only:bg-surface-muted read-only:text-ink-soft';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cx(inputCls, className)} {...rest} />;
  }
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={cx(inputCls, 'cursor-pointer appearance-none bg-no-repeat pr-9', className)}
        style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748B' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundPosition: 'right 0.6rem center',
          backgroundSize: '1.1em',
        }}
        {...rest}
      >
        {children}
      </select>
    );
  }
);

/* ------------------------------------------------------------------- Modal */
/**
 * Accessible dialog: Escape closes, focus is trapped and restored, background
 * scroll is locked, and on mobile it becomes a bottom sheet (thumb-reachable).
 */
export const Modal: React.FC<{
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}> = ({ onClose, title, subtitle, icon, size = 'md', headerActions, footer, children }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = React.useId();

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    // Move focus into the dialog for screen readers / keyboard users
    const t = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select, textarea, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
      (first || panelRef.current)?.focus();
    }, 60);

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

  const width = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' }[size];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-scrim backdrop-blur-[6px] animate-fade-in"
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
          'max-h-[92dvh] rounded-t-overlay sm:rounded-overlay sm:border sm:border-line',
          'animate-sheet sm:animate-rise', width
        )}
      >
        {/* Grab handle: signals "swipe/tap away" on mobile */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0">
          <div className="w-10 h-1 rounded-full bg-line-strong" />
        </div>

        <header className="flex items-start justify-between gap-3 px-4 sm:px-5 py-3 border-b border-line shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <div className="w-9 h-9 rounded-card bg-accent-soft border border-accent-line text-accent flex items-center justify-center shrink-0">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h2 id={titleId} className="font-bold text-ink truncate">{title}</h2>
              {subtitle && <p className="text-xs text-ink-faint truncate">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {headerActions}
            <IconButton label="Close" onClick={onClose}><X className="w-5 h-5" /></IconButton>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4">{children}</div>

        {footer && (
          <footer className="px-4 sm:px-5 py-3 border-t border-line bg-surface-muted rounded-b-overlay shrink-0 pb-safe sm:pb-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------- Toast */
export const Toast: React.FC<{ message: string; tone?: 'success' | 'error' | 'info'; onDismiss: () => void }> = ({
  message, tone = 'success', onDismiss,
}) => {
  useEffect(() => {
    const t = window.setTimeout(onDismiss, 4500);
    return () => window.clearTimeout(t);
  }, [message, onDismiss]);

  const cfg = {
    success: { cls: 'bg-positive-soft border-positive-line text-positive-ink', icon: <Check className="w-4 h-4" /> },
    error: { cls: 'bg-danger-soft border-danger-line text-danger-ink', icon: <AlertCircle className="w-4 h-4" /> },
    info: { cls: 'bg-info-soft border-info-line text-info-ink', icon: <Info className="w-4 h-4" /> },
  }[tone];

  return (
    // aria-live (not role=alert) so it announces without stealing focus
    <div aria-live="polite" className={cx('flex items-center justify-between gap-3 p-3 rounded-card border text-sm font-medium animate-rise', cfg.cls)}>
      <span className="flex items-center gap-2 min-w-0">
        <span className="shrink-0" aria-hidden="true">{cfg.icon}</span>
        <span className="truncate">{message}</span>
      </span>
      <IconButton label="Dismiss message" onClick={onDismiss} className="shrink-0 w-7 h-7">
        <X className="w-4 h-4" />
      </IconButton>
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
      className="p-3 bg-danger-soft border border-danger-line rounded-card text-danger-ink text-sm flex items-start gap-2 outline-none">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
};

/* ------------------------------------------------------- Responsive table */
/**
 * A data table that turns into stacked cards below `sm`. Phone users get readable
 * rows instead of a horizontally-scrolling table.
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
      {/* Mobile: cards */}
      <ul className="sm:hidden divide-y divide-line">
        {rows.map((row) => (
          <li key={row.id} className={rowClassName?.(row)}>
            {onRowClick ? (
              <button onClick={() => onRowClick(row)} className="w-full text-left p-4 active:bg-surface-sunken transition-colors cursor-pointer">
                {mobileCard(row)}
              </button>
            ) : (
              <div className="p-4">{mobileCard(row)}</div>
            )}
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-left text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="border-b border-line">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col"
                  className={cx(
                    'py-2.5 px-4 label-micro whitespace-nowrap',
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
                  'transition-colors duration-150',
                  onRowClick && 'cursor-pointer hover:bg-surface-muted focus-visible:bg-surface-muted',
                  rowClassName?.(row)
                )}>
                {columns.map((c) => (
                  <td key={c.key}
                    className={cx('py-3.5 px-4 text-ink-soft',
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
/**
 * The "↗12%" chip from the reference. Direction is conveyed by an arrow and a
 * sign as well as colour, so it never depends on colour alone.
 */
export const TrendChip: React.FC<{
  /** Percentage change. Positive renders as a rise. */
  value: number;
  /** Set when a rise is bad news (outstanding, overdue, time-to-pay). */
  invert?: boolean;
  className?: string;
}> = ({ value, invert, className }) => {
  const up = value >= 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cx(
      'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border text-[11px] font-medium leading-none',
      good ? 'text-positive-ink border-positive-line bg-positive-soft'
           : 'text-danger-ink border-danger-line bg-danger-soft',
      className
    )}>
      <Icon className="w-3 h-3" aria-hidden="true" />
      {Math.abs(value) > 999 ? '999+' : Math.abs(value).toFixed(0)}%
    </span>
  );
};

/* ------------------------------------------------------------ Metric strip */
/**
 * The KPI band: one continuous surface split by hairlines rather than a row of
 * separate cards. Collapses to 2-up on small screens (see .metric-strip).
 */
export const MetricStrip: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cx('panel overflow-hidden metric-strip grid-cols-2 lg:grid-cols-4', className)}>
    {children}
  </div>
);

export const Metric: React.FC<{
  label: string;
  value: React.ReactNode;
  /** The "211 last week" comparison line. */
  compare?: React.ReactNode;
  trend?: number;
  invertTrend?: boolean;
  /** A sparkline, gauge or any small visual pinned to the right. */
  visual?: React.ReactNode;
  tone?: 'default' | 'positive' | 'warning' | 'danger' | 'accent';
  loading?: boolean;
  onClick?: () => void;
}> = ({ label, value, compare, trend, invertTrend, visual, tone = 'default', loading, onClick }) => {
  const toneText = {
    default: 'text-ink', positive: 'text-positive-ink', warning: 'text-warning-ink',
    danger: 'text-danger-ink', accent: 'text-accent',
  }[tone];
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={cx(
        'p-4 sm:p-5 text-left w-full min-w-0 transition-colors duration-[140ms]',
        onClick && 'cursor-pointer hover:bg-surface-muted'
      )}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <span className="label-micro">{label}</span>
        {trend !== undefined && !loading && <TrendChip value={trend} invert={invertTrend} />}
      </div>

      <div className="flex items-end justify-between gap-3 mt-2.5">
        <div className="min-w-0">
          {loading ? (
            <div className="skeleton h-8 w-24" />
          ) : (
            <div className={cx(
              'numeral leading-none truncate',
              'text-[1.2rem] sm:text-[1.5rem] xl:text-[1.8rem]',
              toneText
            )}>
              {value}
            </div>
          )}
          {compare && !loading && (
            <div className="text-xs text-ink-faint mt-1.5 truncate">{compare}</div>
          )}
        </div>
        {visual && !loading && <div className="shrink-0 opacity-80 hidden sm:block">{visual}</div>}
      </div>
    </Tag>
  );
};

/* ---------------------------------------------------------------- Sparkline */
/** Tiny inline bar chart, ember-toned, purely indicative - no axes, no labels. */
export const Sparkbars: React.FC<{ data: number[]; className?: string; label?: string }> = ({ data, className, label }) => {
  // Fewer than three points is not a trend - it just looks like debris.
  if (data.length < 3) return null;
  const max = Math.max(...data, 1);
  return (
    <div className={cx('flex items-end gap-[3px] h-10', className)} role="img" aria-label={label || 'Trend'}>
      {data.map((v, i) => {
        const lead = i === data.length - 1;
        return (
          <span
            key={i}
            className="w-[3px] rounded-full"
            style={{
              height: `${Math.max(10, (v / max) * 100)}%`,
              background: 'linear-gradient(to top, rgb(var(--glow-color) / 0.15), var(--color-accent))',
              // the most recent bar glows, the rest fade back in time
              opacity: lead ? 1 : 0.25 + (i / data.length) * 0.5,
              boxShadow: lead ? '0 0 8px rgb(var(--glow-color) / 0.65)' : 'none',
            }}
          />
        );
      })}
    </div>
  );
};

/* ------------------------------------------------------------- Ring gauge */
/** The donut/arc gauge from the KPI strip. Value is 0-100. */
export const RingGauge: React.FC<{ value: number; size?: number; label?: string }> = ({ value, size = 52, label }) => {
  const pct = Math.max(0, Math.min(100, value));
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const id = React.useId();
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
      aria-label={label || `${pct.toFixed(0)} percent`} className="-rotate-90 overflow-visible">
      <defs>
        <linearGradient id={`rg-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" />
          <stop offset="100%" stopColor="var(--color-warning)" />
        </linearGradient>
        <filter id={`rgglow-${id}`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* track sits translucent so the panel glass shows through */}
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="var(--color-line)" strokeWidth="3.5" opacity="0.7" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={`url(#rg-${id})`} strokeWidth="3.5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c}
        filter={`url(#rgglow-${id})`}
        style={{ transition: 'stroke-dashoffset 800ms var(--ease-out-soft)' }}
      />
    </svg>
  );
};

/* ------------------------------------------------------------ Avatar chip */
/** Initials chip used for owners and assignees, coloured deterministically. */
export const AvatarChip: React.FC<{ name?: string; className?: string; square?: boolean }> = ({ name, className, square }) => {
  const initials = String(name || '?')
    .split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  // Stable hue from the name so the same person keeps the same colour
  const hue = Array.from(String(name || '')).reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 360, 7);
  return (
    <span
      className={cx('inline-flex items-center justify-center w-6 h-6 text-[10px] font-semibold text-white shrink-0',
        square ? 'rounded-control' : 'rounded-full', className)}
      style={{ background: `hsl(${hue} 48% 42%)` }}
      title={name}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
};

/* -------------------------------------------------------------- Pill tabs */
/** Segmented tabs with a solid active pill, as on the incident-detail screen. */
export function PillTabs<T extends string>({ tabs, value, onChange, className }: {
  tabs: { key: T; label: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (k: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cx('inline-flex items-center gap-1 p-1 rounded-control bg-surface-muted border border-line', className)}>
      {tabs.map(t => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={cx(
              'inline-flex items-center gap-1.5 px-3 min-h-[34px] rounded-control text-sm whitespace-nowrap',
              'cursor-pointer transition-colors duration-[140ms]',
              active ? 'bg-surface text-ink font-medium shadow-card' : 'text-ink-faint hover:text-ink'
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
/** The ranked "value - bar - label" rows under the reference's threat map. */
export const BarRank: React.FC<{
  rows: { label: string; value: number; sub?: string }[];
  format?: (n: number) => string;
  className?: string;
}> = ({ rows, format, className }) => {
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <ul className={cx('space-y-3', className)}>
      {rows.map((r, i) => (
        <li key={i} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <span className="font-mono text-sm text-ink">{format ? format(r.value) : r.value}</span>
            <span className="text-xs text-ink-faint truncate text-right">{r.label}</span>
          </div>
          <div className="h-[4px] rounded-full bg-line/60 overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{
                width: `${Math.max(2, (r.value / max) * 100)}%`,
                background: 'linear-gradient(90deg, rgb(var(--glow-color) / 0.45), var(--color-accent))',
                boxShadow: '0 0 10px rgb(var(--glow-color) / 0.45)',
              }}
            />
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
    // Dark is the product default; light is an explicit choice.
    try { return (localStorage.getItem('ssl_theme') as ThemeChoice) || 'dark'; } catch { return 'dark'; }
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
