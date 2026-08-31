import React from 'react';
import {
  LayoutDashboard,
  FileText,
  Users,
  CreditCard,
  Settings,
  UserCheck,
  ShieldAlert,
  LogOut,
  Plus,
  AlertTriangle,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { CompanySettings } from '../types.js';
import { SslLogo } from './SslLogo.js';
import { cx, IconButton } from './ui.js';

export interface NavItem {
  key: string;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  module: string;
  adminOnly?: boolean;
}

/** Single source of truth for navigation — the sidebar and the mobile bottom bar
 *  both read this, so the two can never drift apart. */
export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', shortLabel: 'Home', icon: LayoutDashboard, module: 'dashboard' },
  { key: 'invoices', label: 'Invoices', shortLabel: 'Invoices', icon: FileText, module: 'invoices' },
  { key: 'payments', label: 'Payments', shortLabel: 'Payments', icon: CreditCard, module: 'payments' },
  { key: 'customers', label: 'Customers', shortLabel: 'Customers', icon: Users, module: 'customers' },
  { key: 'settings', label: 'Settings', shortLabel: 'Settings', icon: Settings, module: 'settings' },
  { key: 'users', label: 'Users & Roles', shortLabel: 'Users', icon: UserCheck, module: 'users', adminOnly: true },
];

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onNewInvoice: () => void;
  onNewCustomer: () => void;
  onReceivePayment: () => void;
  onViewOverdue: () => void;
  onOpenAuditLogs: () => void;
  isOpenMobile: boolean;
  setIsOpenMobile: (open: boolean) => void;
  companySettings?: CompanySettings;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  onNewInvoice,
  onViewOverdue,
  onOpenAuditLogs,
  isOpenMobile,
  setIsOpenMobile,
  companySettings,
}) => {
  const { user, logout } = useAuth();

  const hasModule = (mod: string) => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.modules?.includes(mod);
  };

  const visibleItems = NAV_ITEMS.filter(
    (i) => hasModule(i.module) && (!i.adminOnly || user?.role === 'admin')
  );

  const handleNavClick = (tab: string) => {
    setActiveTab(tab);
    setIsOpenMobile(false);
  };

  // Close the drawer on Escape (mobile)
  React.useEffect(() => {
    if (!isOpenMobile) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpenMobile(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpenMobile, setIsOpenMobile]);

  return (
    <>
      {/* Backdrop — strong enough to isolate the drawer from the page behind it */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 bg-navy-950/60 backdrop-blur-[2px] z-40 lg:hidden animate-fade-in"
          onClick={() => setIsOpenMobile(false)}
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="Main navigation"
        className={cx(
          'fixed top-0 bottom-0 left-0 z-50 w-[17rem] bg-navy-900 text-navy-100 flex flex-col',
          'border-r border-white/5 transition-transform duration-300 ease-out pt-safe',
          isOpenMobile ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Brand */}
        <div className="h-16 px-3 flex items-center justify-between border-b border-white/5 shrink-0">
          <button
            onClick={() => handleNavClick('dashboard')}
            className="flex items-center gap-2.5 min-w-0 rounded-xl p-1 -m-1 cursor-pointer hover:bg-white/5 transition-colors"
          >
            <span className="bg-white rounded-lg p-1 shrink-0 flex items-center justify-center w-11 h-9 overflow-hidden">
              <SslLogo className="h-7 w-auto max-w-[38px]" customLogoUrl={companySettings?.logo_url} />
            </span>
            <span className="min-w-0 text-left">
              <span className="block font-bold text-sm text-white leading-tight truncate">
                {companySettings?.name?.split(' ').slice(0, 2).join(' ') || 'SHREE SANWARIYA'}
              </span>
              <span className="block text-[11px] font-semibold text-brand-400 tracking-wide">GST Billing</span>
            </span>
          </button>

          <IconButton
            label="Close navigation"
            onClick={() => setIsOpenMobile(false)}
            className="lg:hidden text-navy-100 hover:bg-white/10 hover:text-white"
          >
            <X className="w-5 h-5" />
          </IconButton>
        </div>

        {/* Primary action — one clear CTA, visually dominant */}
        {hasModule('invoices') && (
          <div className="px-3 pt-3 shrink-0">
            <button
              onClick={() => { handleNavClick('invoices'); onNewInvoice(); }}
              className="w-full inline-flex items-center justify-center gap-2 min-h-[44px] rounded-xl bg-accent-strong
                         text-on-accent font-semibold text-sm cursor-pointer shadow-raised
                         hover:bg-accent-strong-hover active:scale-[0.98] transition-[background-color,transform] duration-150"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              New Invoice
            </button>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                id={`sidebar-${item.key}-btn`}
                onClick={() => handleNavClick(item.key)}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'w-full flex items-center gap-3 px-3 min-h-[44px] rounded-xl text-sm font-medium cursor-pointer',
                  'transition-colors duration-150',
                  active
                    ? 'bg-white/10 text-white font-semibold'
                    : 'text-navy-100/90 hover:bg-white/5 hover:text-white'
                )}
              >
                {/* Active marker is a shape, not just colour */}
                <span
                  className={cx('w-1 h-5 rounded-full shrink-0 -ml-1', active ? 'bg-accent' : 'bg-transparent')}
                  aria-hidden="true"
                />
                <Icon className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}

          {(hasModule('invoices') || user?.role === 'admin') && (
            <div className="pt-3 mt-2 border-t border-white/5 space-y-1">
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-navy-100/70">Tools</p>

              {hasModule('invoices') && (
                <button
                  onClick={onViewOverdue}
                  className="w-full flex items-center gap-3 px-3 min-h-[44px] rounded-xl text-sm font-medium
                             text-navy-100/90 hover:bg-white/5 hover:text-white cursor-pointer transition-colors duration-150"
                >
                  <AlertTriangle className="w-[18px] h-[18px] shrink-0 text-warning" aria-hidden="true" />
                  <span className="truncate">Overdue &amp; Reminders</span>
                </button>
              )}

              {user?.role === 'admin' && (
                <button
                  onClick={onOpenAuditLogs}
                  className="w-full flex items-center gap-3 px-3 min-h-[44px] rounded-xl text-sm font-medium
                             text-navy-100/90 hover:bg-white/5 hover:text-white cursor-pointer transition-colors duration-150"
                >
                  <ShieldAlert className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
                  <span className="truncate">Audit Logs</span>
                </button>
              )}
            </div>
          )}
        </nav>

        {/* Account — sign out kept visually separate from navigation */}
        <div className="p-3 border-t border-white/5 shrink-0 pb-safe">
          <div className="flex items-center gap-2 p-2 rounded-xl bg-white/5">
            <span
              className="w-9 h-9 rounded-full bg-accent-strong text-on-accent font-bold text-sm flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              {(user?.full_name || user?.email || '?').charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-white text-sm truncate">
                {user?.full_name || user?.email}
              </span>
              <span className="block text-[11px] text-navy-100/80 capitalize">{user?.role}</span>
            </span>
            <IconButton
              label="Sign out"
              onClick={logout}
              className="text-navy-100/70 hover:bg-danger hover:text-white shrink-0"
            >
              <LogOut className="w-[18px] h-[18px]" />
            </IconButton>
          </div>
        </div>
      </aside>
    </>
  );
};

/**
 * Mobile bottom navigation — top-level destinations only, max 5 items, icon + label.
 * Sits above the safe-area inset so it clears the iOS home indicator.
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

  const items = NAV_ITEMS.filter(
    (i) => hasModule(i.module) && !i.adminOnly && i.key !== 'settings'
  ).slice(0, 4);

  return (
    <nav
      aria-label="Primary"
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/95 backdrop-blur border-t border-line pb-safe"
    >
      <ul className="flex items-stretch">
        {items.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.key;
          return (
            <li key={item.key} className="flex-1">
              <button
                onClick={() => setActiveTab(item.key)}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'w-full flex flex-col items-center justify-center gap-0.5 min-h-[52px] pt-1.5 pb-1 cursor-pointer',
                  'transition-colors duration-150',
                  active ? 'text-accent-ink' : 'text-ink-faint active:bg-surface-sunken'
                )}
              >
                <Icon className={cx('w-[22px] h-[22px]', active && 'stroke-[2.4]')} aria-hidden="true" />
                <span className={cx('text-[11px] leading-none', active ? 'font-bold' : 'font-medium')}>
                  {item.shortLabel}
                </span>
              </button>
            </li>
          );
        })}

        <li className="flex-1">
          <button
            onClick={onMore}
            className="w-full flex flex-col items-center justify-center gap-0.5 min-h-[52px] pt-1.5 pb-1
                       text-ink-faint active:bg-surface-sunken cursor-pointer transition-colors duration-150"
          >
            <Settings className="w-[22px] h-[22px]" aria-hidden="true" />
            <span className="text-[11px] leading-none font-medium">More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
};
