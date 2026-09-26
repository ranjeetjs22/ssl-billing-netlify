import React from 'react';
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
  ChevronsLeft,
  ChevronsRight,
  MoreHorizontal,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { CompanySettings } from '../types.js';
import { SslLogo } from './SslLogo.js';
import { cx, IconButton } from './ui.js';

export interface NavItem {
  key: string;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  module: string;
  group: 'main' | 'manage';
  adminOnly?: boolean;
}

/**
 * Single source of truth for navigation. The rail, the collapsed rail and the
 * mobile bar all read this, so the three can never drift apart.
 */
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

const ICON = 'w-[18px] h-[18px] shrink-0';
const STROKE = 1.6;

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

/**
 * A nav row. Active reads as a filled pill with an ember icon rather than a
 * marker bar, so the whole row is the target and the state is unmistakable.
 * Collapsed, the label becomes a floating tooltip.
 */
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
    className={cx(
      'group relative w-full flex items-center min-h-[38px] rounded-control cursor-pointer',
      'text-[13.5px] transition-[background-color,color] duration-[140ms] ease-out',
      collapsed ? 'justify-center px-0' : 'gap-3 px-2.5',
      active
        ? 'bg-surface-muted text-ink font-medium'
        : tone === 'warning'
          ? 'text-warning-ink/80 hover:bg-surface hover:text-warning-ink'
          : 'text-ink-soft hover:bg-surface hover:text-ink'
    )}
  >
    <Icon
      className={cx(ICON, 'transition-colors', active && 'text-accent')}
      strokeWidth={STROKE}
      aria-hidden="true"
    />
    {!collapsed && <span className="truncate">{label}</span>}

    {collapsed && (
      <span
        role="tooltip"
        className="tip pointer-events-none absolute left-[calc(100%+12px)] z-50 whitespace-nowrap
                   px-2 py-1 text-xs opacity-0 translate-x-[-4px]
                   transition-[opacity,transform] duration-[140ms]
                   group-hover:opacity-100 group-hover:translate-x-0
                   group-focus-visible:opacity-100 group-focus-visible:translate-x-0"
      >
        {label}
      </span>
    )}
  </button>
);

const GroupLabel: React.FC<{ children: React.ReactNode; hidden?: boolean }> = ({ children, hidden }) =>
  hidden
    ? <div className="rule-fade mx-2 my-2.5" aria-hidden="true" />
    : <p className="px-2.5 pt-4 pb-1.5 label-micro">{children}</p>;

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

  const hasModule = (mod: string) => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.modules?.includes(mod);
  };

  const visible = NAV_ITEMS.filter(
    (i) => hasModule(i.module) && (!i.adminOnly || user?.role === 'admin')
  );
  const main = visible.filter((i) => i.group === 'main');
  const manage = visible.filter((i) => i.group === 'manage');

  const go = (tab: string) => { setActiveTab(tab); setIsOpenMobile(false); };

  React.useEffect(() => {
    if (!isOpenMobile) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpenMobile(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpenMobile, setIsOpenMobile]);

  const initials = (user?.full_name || user?.email || '?').charAt(0).toUpperCase();
  const tight = collapsed && !isOpenMobile;

  return (
    <>
      {isOpenMobile && (
        <div
          className="fixed inset-0 bg-scrim backdrop-blur-[6px] z-40 lg:hidden animate-fade-in"
          onClick={() => setIsOpenMobile(false)}
          aria-hidden="true"
        />
      )}

      {/* A detached island rather than a full-height wall: the canvas and its
          ambient light continue around it, which is what keeps it light. */}
      <aside
        aria-label="Main navigation"
        className={cx(
          'fixed z-50 flex flex-col overflow-hidden',
          'lg:top-3 lg:bottom-3 lg:left-3 lg:rounded-overlay lg:border lg:border-line lg:shadow-card',
          'top-0 bottom-0 left-0 border-r border-line pt-safe lg:pt-0',
          isOpenMobile ? 'sheet' : 'bg-surface backdrop-blur-2xl',
          'transition-[transform,width] duration-[240ms] ease-out',
          tight ? 'w-[64px]' : 'w-[228px]',
          isOpenMobile ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* brand */}
        <div className={cx('h-[52px] flex items-center shrink-0', tight ? 'justify-center px-0' : 'justify-between pl-3 pr-2')}>
          <button
            onClick={() => go('dashboard')}
            className="flex items-center gap-2.5 min-w-0 rounded-control p-1 -m-1 cursor-pointer
                       hover:bg-surface-muted transition-colors duration-[140ms]"
          >
            <span className="w-[26px] h-[26px] rounded-[7px] bg-surface-muted border border-line
                             flex items-center justify-center shrink-0 overflow-hidden">
              <SslLogo className="h-3.5 w-auto" customLogoUrl={companySettings?.logo_url} />
            </span>
            {!tight && (
              <span className="min-w-0 text-left">
                <span className="block text-[13px] font-semibold text-ink leading-tight truncate tracking-[-0.01em]">
                  {companySettings?.name?.split(' ').slice(0, 2).join(' ') || 'Shree Sanwariya'}
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-ink-faint leading-tight">
                  <span className="pip" aria-hidden="true" />
                  GST billing
                </span>
              </span>
            )}
          </button>

          {!tight && (
            <IconButton
              label="Close navigation"
              onClick={() => setIsOpenMobile(false)}
              className="lg:hidden w-8 h-8"
            >
              <X className="w-4 h-4" strokeWidth={STROKE} />
            </IconButton>
          )}
        </div>

        {/* primary action */}
        {hasModule('invoices') && (
          <div className={cx('shrink-0 pb-1', tight ? 'px-2.5' : 'px-3')}>
            <button
              onClick={() => { go('invoices'); onNewInvoice(); }}
              aria-label="New invoice"
              className={cx(
                'group relative w-full inline-flex items-center min-h-[36px] rounded-control cursor-pointer',
                'border border-accent-line bg-accent-soft text-accent-ink',
                'text-[13.5px] font-medium',
                'transition-[background-color,border-color,box-shadow] duration-[160ms] ease-out',
                'hover:bg-accent-strong hover:border-accent-strong hover:text-on-accent hover:glow-ember',
                tight ? 'justify-center px-0' : 'gap-2.5 px-2.5'
              )}
            >
              <Plus className="w-[17px] h-[17px] shrink-0" strokeWidth={2.2} aria-hidden="true" />
              {!tight && 'New invoice'}
              {tight && (
                <span
                  role="tooltip"
                  className="tip pointer-events-none absolute left-[calc(100%+12px)] z-50 whitespace-nowrap
                             px-2 py-1 text-xs opacity-0 transition-opacity duration-[140ms]
                             group-hover:opacity-100"
                >
                  New invoice
                </span>
              )}
            </button>
          </div>
        )}

        {/* navigation.
            A scroll container clips on BOTH axes, so the collapsed rail has to
            stay overflow-visible or its tooltips are cut off at the rail edge.
            Collapsed the list is short enough that it never needs to scroll. */}
        <nav className={cx('flex-1 pb-2', tight ? 'px-2.5 overflow-visible' : 'px-3 overflow-y-auto')}>
          <div className="space-y-0.5">
            {main.map((item) => (
              <NavRow
                key={item.key}
                id={`sidebar-${item.key}-btn`}
                icon={item.icon}
                label={item.label}
                active={activeTab === item.key}
                collapsed={tight}
                onClick={() => go(item.key)}
              />
            ))}
          </div>

          {manage.length > 0 && (
            <>
              <GroupLabel hidden={tight}>Manage</GroupLabel>
              <div className="space-y-0.5">
                {manage.map((item) => (
                  <NavRow
                    key={item.key}
                    id={`sidebar-${item.key}-btn`}
                    icon={item.icon}
                    label={item.label}
                    active={activeTab === item.key}
                    collapsed={tight}
                    onClick={() => go(item.key)}
                  />
                ))}
              </div>
            </>
          )}

          {hasModule('invoices') && (
            <>
              <GroupLabel hidden={tight}>Tools</GroupLabel>
              <div className="space-y-0.5">
                <NavRow icon={TriangleAlert} label="Overdue" tone="warning" collapsed={tight} onClick={onViewOverdue} />
              </div>
            </>
          )}
        </nav>

        {/* account card */}
        <div className={cx('shrink-0 pb-safe lg:pb-2', tight ? 'px-2.5' : 'px-3')}>
          <div className="rule-fade mb-2" aria-hidden="true" />

          <div className={cx('flex items-center rounded-control', tight ? 'flex-col gap-1' : 'gap-2.5 px-1.5 py-1.5')}>
            <span
              className="w-[26px] h-[26px] rounded-[7px] bg-accent-soft border border-accent-line text-accent-ink
                         text-[11px] font-semibold flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              {initials}
            </span>
            {!tight && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] text-ink truncate leading-tight">
                    {user?.full_name || user?.email}
                  </span>
                  <span className="block text-[10px] text-ink-faint capitalize leading-tight">{user?.role}</span>
                </span>
                <IconButton
                  label="Sign out"
                  onClick={logout}
                  className="w-8 h-8 text-ink-faint hover:text-danger-ink hover:bg-danger-soft shrink-0"
                >
                  <LogOut className="w-[15px] h-[15px]" strokeWidth={STROKE} />
                </IconButton>
              </>
            )}
            {tight && (
              <IconButton
                label="Sign out"
                onClick={logout}
                className="w-8 h-8 text-ink-faint hover:text-danger-ink hover:bg-danger-soft"
              >
                <LogOut className="w-[15px] h-[15px]" strokeWidth={STROKE} />
              </IconButton>
            )}
          </div>

          {onToggleCollapsed && (
            <button
              onClick={onToggleCollapsed}
              aria-label={tight ? 'Expand navigation' : 'Collapse navigation'}
              className={cx(
                'hidden lg:flex items-center gap-2.5 w-full min-h-[32px] rounded-control cursor-pointer',
                'text-ink-faint hover:text-ink hover:bg-surface-muted transition-colors duration-[140ms]',
                tight ? 'justify-center px-0' : 'px-2.5'
              )}
            >
              {tight
                ? <ChevronsRight className="w-4 h-4" strokeWidth={STROKE} aria-hidden="true" />
                : <ChevronsLeft className="w-4 h-4" strokeWidth={STROKE} aria-hidden="true" />}
              {!tight && <span className="text-[12.5px]">Collapse</span>}
            </button>
          )}
        </div>
      </aside>
    </>
  );
};

/**
 * Mobile bottom bar, as a floating island so the content scrolls past it rather
 * than under a full-width slab. Top level destinations only, five at most.
 */
export const MobileNav: React.FC<{
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onMore: () => void;
}> = ({ activeTab, setActiveTab, onMore }) => {
  const { user } = useAuth();
  const hasModule = (mod: string) => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.modules?.includes(mod);
  };

  const items = NAV_ITEMS.filter((i) => hasModule(i.module) && i.group === 'main').slice(0, 4);

  const Tab: React.FC<{
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    label: string; active?: boolean; onClick: () => void;
  }> = ({ icon: Icon, label, active, onClick }) => (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex-1 flex flex-col items-center justify-center gap-[3px] min-h-[52px] rounded-card',
        'cursor-pointer transition-colors duration-[140ms]',
        active ? 'text-accent bg-accent-soft' : 'text-ink-faint active:bg-surface-muted'
      )}
    >
      <Icon className="w-[19px] h-[19px]" strokeWidth={STROKE} aria-hidden="true" />
      <span className={cx('text-[10px] leading-none', active && 'font-medium')}>{label}</span>
    </button>
  );

  return (
    <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 px-3 pb-3 pb-safe pointer-events-none">
      <nav
        aria-label="Primary"
        className="sheet pointer-events-auto flex items-stretch gap-1 p-1
                   rounded-overlay border border-line shadow-raised"
      >
        {items.map((item) => (
          <Tab
            key={item.key}
            icon={item.icon}
            label={item.shortLabel}
            active={activeTab === item.key}
            onClick={() => setActiveTab(item.key)}
          />
        ))}
        <Tab icon={MoreHorizontal} label="More" onClick={onMore} />
      </nav>
    </div>
  );
};
