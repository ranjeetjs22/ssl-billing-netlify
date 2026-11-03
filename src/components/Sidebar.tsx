import React from 'react';
import { useBackLayer } from '../utils/backNav.js';
import {
  LayoutGrid,
  FileText,
  Wallet,
  Building2,
  Calculator,
  ChartColumnIncreasing,
  Settings2,
  Receipt,
  UserCog,
  TriangleAlert,
  LogOut,
  Plus,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { CompanySettings } from '../types.js';
import { cx, IconButton, useTheme, ThemeChoice } from './ui.js';

export interface NavItem {
  key: string;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  module: string;
  group: 'main' | 'manage';
  adminOnly?: boolean;
}

/** Single source of truth for navigation: rail, drawer and tab bar all read it. */
export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Overview', shortLabel: 'Home', icon: LayoutGrid, module: 'dashboard', group: 'main' },
  { key: 'invoices', label: 'Invoices', shortLabel: 'Invoices', icon: FileText, module: 'invoices', group: 'main' },
  { key: 'payments', label: 'Payments', shortLabel: 'Payments', icon: Wallet, module: 'payments', group: 'main' },
  { key: 'customers', label: 'Customers', shortLabel: 'Customers', icon: Building2, module: 'customers', group: 'main' },
  { key: 'rates', label: 'Rate calculator', shortLabel: 'Rates', icon: Calculator, module: 'invoices', group: 'manage' },
  { key: 'expenses', label: 'Expenses', shortLabel: 'Expenses', icon: Receipt, module: 'expenses', group: 'manage' },
  { key: 'reports', label: 'Reports', shortLabel: 'Reports', icon: ChartColumnIncreasing, module: 'invoices', group: 'manage' },
  { key: 'settings', label: 'Settings', shortLabel: 'Settings', icon: Settings2, module: 'settings', group: 'manage' },
  { key: 'users', label: 'Users', shortLabel: 'Users', icon: UserCog, module: 'users', group: 'manage', adminOnly: true },
];

const STROKE = 1.75;

function useModules() {
  const { user } = useAuth();
  return (mod: string) => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return Boolean(user.modules?.includes(mod));
  };
}

/** Square brand mark used in the rail and on the sign-in screen. */
export const BrandMark: React.FC<{ className?: string }> = ({ className }) => (
  <span className={cx('inline-flex items-center justify-center rounded-[6px] bg-accent-strong text-on-accent font-semibold shrink-0 select-none', className)}
    aria-hidden="true">
    S
  </span>
);

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onNewInvoice: () => void;
  onNewCustomer: () => void;
  onReceivePayment: () => void;
  onViewOverdue: () => void;
  isOpenMobile: boolean;
  setIsOpenMobile: (open: boolean) => void;
  /** Desktop rail reduced to icons only. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  companySettings?: CompanySettings;
}

const NavRow: React.FC<{
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  id?: string;
  tone?: 'default' | 'warning';
  onClick: () => void;
}> = ({ icon: Icon, label, active, collapsed, id, tone = 'default', onClick }) => (
  <button
    id={id}
    onClick={onClick}
    aria-current={active ? 'page' : undefined}
    aria-label={collapsed ? label : undefined}
    className={cx(
      'group relative w-full flex items-center h-10 lg:h-8 rounded-control cursor-pointer text-sm',
      'transition-colors duration-[var(--duration-fast)]',
      collapsed ? 'justify-center' : 'gap-2.5 px-2.5',
      active
        ? 'bg-accent-soft text-accent-ink font-medium'
        : 'text-ink-soft hover:bg-surface-sunken hover:text-ink'
    )}
  >
    <Icon
      className={cx('w-4 h-4 shrink-0', !active && tone === 'warning' && 'text-warning')}
      strokeWidth={STROKE}
      aria-hidden="true"
    />
    {!collapsed && <span className="truncate">{label}</span>}
    {collapsed && (
      <span role="tooltip"
        className="tip pointer-events-none absolute left-[calc(100%+10px)] z-50 whitespace-nowrap px-2 py-1 text-xs
                   opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-[var(--duration-fast)]">
        {label}
      </span>
    )}
  </button>
);

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
];

/** Compact three-way theme choice used in the drawer and the rail footer. */
export const ThemeChoiceControl: React.FC<{ className?: string }> = ({ className }) => {
  const [theme, setTheme] = useTheme();
  return (
    <div role="radiogroup" aria-label="Colour theme"
      className={cx('grid grid-cols-3 p-0.5 rounded-control bg-surface-sunken border border-line', className)}>
      {THEMES.map(t => (
        <button key={t.value} type="button" role="radio" aria-checked={theme === t.value}
          onClick={() => setTheme(t.value)}
          className={cx('h-7 rounded-[4px] text-xs cursor-pointer transition-colors',
            theme === t.value ? 'bg-surface text-ink font-medium ring-1 ring-line' : 'text-ink-faint hover:text-ink')}>
          {t.label}
        </button>
      ))}
    </div>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  onNewInvoice,
  onViewOverdue,
  isOpenMobile,
  setIsOpenMobile,
  collapsed = false,
  onToggleCollapsed,
  companySettings,
}) => {
  const { user, logout } = useAuth();
  const hasModule = useModules();

  const visible = NAV_ITEMS.filter((i) => hasModule(i.module) && (!i.adminOnly || user?.role === 'admin'));
  const main = visible.filter((i) => i.group === 'main');
  const manage = visible.filter((i) => i.group === 'manage');

  const go = (tab: string) => { setActiveTab(tab); setIsOpenMobile(false); };

  // Back closes the open mobile drawer
  useBackLayer(() => setIsOpenMobile(false), isOpenMobile);

  React.useEffect(() => {
    if (!isOpenMobile) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpenMobile(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpenMobile, setIsOpenMobile]);

  const tight = collapsed && !isOpenMobile;
  const company = companySettings?.name || 'Shree Sanwariya Logistics';

  return (
    <>
      {isOpenMobile && (
        <div className="fixed inset-0 bg-scrim z-40 lg:hidden animate-fade-in"
          onClick={() => setIsOpenMobile(false)} aria-hidden="true" />
      )}

      <aside
        aria-label="Main navigation"
        className={cx(
          'fixed z-50 top-0 bottom-0 left-0 flex flex-col bg-surface border-r border-line pt-safe lg:pt-0',
          'transition-[transform,width] duration-[var(--duration-base)] ease-out',
          tight ? 'w-14' : 'w-[264px] lg:w-[220px]',
          isOpenMobile ? 'translate-x-0 shadow-overlay' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* brand */}
        <div className={cx('h-12 flex items-center shrink-0 border-b border-line', tight ? 'justify-center' : 'justify-between pl-3 pr-1.5')}>
          <button onClick={() => go('dashboard')}
            className="flex items-center gap-2.5 min-w-0 rounded-control cursor-pointer" aria-label="Go to overview">
            <BrandMark className="w-7 h-7 text-sm" />
            {!tight && (
              <span className="min-w-0 text-left">
                <span className="block text-sm font-semibold text-ink leading-tight truncate">SSL Billing</span>
                <span className="block text-xs text-ink-faint leading-tight truncate">{company}</span>
              </span>
            )}
          </button>
          {!tight && (
            <IconButton label="Close navigation" onClick={() => setIsOpenMobile(false)} className="lg:hidden">
              <X strokeWidth={STROKE} />
            </IconButton>
          )}
        </div>

        {/* primary action */}
        {hasModule('invoices') && (
          <div className={cx('shrink-0 pt-3', tight ? 'px-2' : 'px-3')}>
            <button
              onClick={() => { go('invoices'); onNewInvoice(); }}
              aria-label="New invoice"
              className={cx(
                'group relative w-full inline-flex items-center justify-center h-10 lg:h-8 rounded-control cursor-pointer',
                'bg-accent-strong text-on-accent text-sm font-medium hover:bg-accent-strong-hover transition-colors',
                !tight && 'gap-1.5'
              )}
            >
              <Plus className="w-4 h-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              {!tight && 'New invoice'}
            </button>
          </div>
        )}

        {/* navigation - the collapsed rail stays overflow-visible so tooltips are not clipped */}
        <nav className={cx('flex-1 py-3', tight ? 'px-2 overflow-visible' : 'px-3 overflow-y-auto')}>
          <div className="space-y-px">
            {main.map((item) => (
              <NavRow key={item.key} id={`sidebar-${item.key}-btn`} icon={item.icon} label={item.label}
                active={activeTab === item.key} collapsed={tight} onClick={() => go(item.key)} />
            ))}
          </div>

          {manage.length > 0 && (
            <>
              {tight ? <div className="h-px bg-line mx-1 my-3" /> : <p className="px-2.5 pt-5 pb-1.5 text-xs text-ink-faint">Manage</p>}
              <div className="space-y-px">
                {manage.map((item) => (
                  <NavRow key={item.key} id={`sidebar-${item.key}-btn`} icon={item.icon} label={item.label}
                    active={activeTab === item.key} collapsed={tight} onClick={() => go(item.key)} />
                ))}
              </div>
            </>
          )}

          {hasModule('invoices') && (
            <>
              {tight ? <div className="h-px bg-line mx-1 my-3" /> : <p className="px-2.5 pt-5 pb-1.5 text-xs text-ink-faint">Follow up</p>}
              <NavRow icon={TriangleAlert} label="Overdue bills" tone="warning" collapsed={tight}
                onClick={() => { setIsOpenMobile(false); onViewOverdue(); }} />
            </>
          )}
        </nav>

        {/* footer: theme, account, collapse */}
        <div className={cx('shrink-0 border-t border-line pb-safe lg:pb-2 pt-2', tight ? 'px-2' : 'px-3')}>
          {!tight && <ThemeChoiceControl className="mb-2" />}
          <div className={cx('flex items-center', tight ? 'flex-col gap-1' : 'gap-2 py-1')}>
            <span className="w-7 h-7 rounded-full bg-surface-sunken border border-line text-ink-soft text-xs font-semibold flex items-center justify-center shrink-0"
              aria-hidden="true">
              {(user?.full_name || user?.email || '?').charAt(0).toUpperCase()}
            </span>
            {!tight && (
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-ink truncate leading-tight">{user?.full_name || user?.email}</span>
                <span className="block text-xs text-ink-faint capitalize leading-tight">{user?.role}</span>
              </span>
            )}
            <IconButton label="Sign out" onClick={logout} className="hover:text-danger-ink">
              <LogOut strokeWidth={STROKE} />
            </IconButton>
          </div>
          {onToggleCollapsed && (
            <button onClick={onToggleCollapsed}
              aria-label={tight ? 'Expand navigation' : 'Collapse navigation'}
              className={cx('hidden lg:flex items-center gap-2 w-full h-8 mt-1 rounded-control cursor-pointer text-xs',
                'text-ink-faint hover:text-ink hover:bg-surface-sunken transition-colors', tight ? 'justify-center' : 'px-2.5')}>
              {tight ? <PanelLeftOpen className="w-4 h-4" strokeWidth={STROKE} /> : <PanelLeftClose className="w-4 h-4" strokeWidth={STROKE} />}
              {!tight && 'Collapse'}
            </button>
          )}
        </div>
      </aside>
    </>
  );
};

/**
 * Phone tab bar: flat, full width, sits on the safe area like a native app.
 * Four destinations plus "More" (opens the drawer).
 */
export const MobileNav: React.FC<{
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onMore: () => void;
}> = ({ activeTab, setActiveTab, onMore }) => {
  const hasModule = useModules();
  const items = NAV_ITEMS.filter((i) => hasModule(i.module) && i.group === 'main').slice(0, 4);
  const moreActive = !items.some(i => i.key === activeTab);

  const Tab: React.FC<{
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    label: string; active?: boolean; onClick: () => void;
  }> = ({ icon: Icon, label, active, onClick }) => (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'relative flex-1 flex flex-col items-center justify-center gap-1 h-14 cursor-pointer',
        'transition-colors duration-[var(--duration-fast)] active:bg-surface-sunken',
        active ? 'text-accent-ink' : 'text-ink-faint'
      )}
    >
      {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-b-full bg-accent" aria-hidden="true" />}
      <Icon className="w-5 h-5" strokeWidth={active ? 2 : STROKE} aria-hidden="true" />
      <span className={cx('text-[11px] leading-none', active && 'font-medium')}>{label}</span>
    </button>
  );

  return (
    <nav aria-label="Primary"
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-line flex items-stretch pb-[env(safe-area-inset-bottom)]">
      {items.map((item) => (
        <Tab key={item.key} icon={item.icon} label={item.shortLabel}
          active={activeTab === item.key} onClick={() => setActiveTab(item.key)} />
      ))}
      <Tab icon={Menu} label="More" active={moreActive} onClick={onMore} />
    </nav>
  );
};
