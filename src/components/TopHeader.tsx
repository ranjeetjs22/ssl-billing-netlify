import React from 'react';
import { Menu, Plus, Receipt, Users, Sun, Moon, MonitorSmartphone } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { CompanySettings } from '../types.js';
import { cx, IconButton, Button, useTheme, ThemeChoice } from './ui.js';

interface TopHeaderProps {
  activeTab: string;
  onToggleSidebar: () => void;
  onNewInvoice: () => void;
  onReceivePayment: () => void;
  onNewCustomer: () => void;
  onOpenAuditLogs: () => void;
  companySettings?: CompanySettings;
}

const TAB_TITLES: Record<string, { title: string; hint: string }> = {
  dashboard: { title: 'Dashboard', hint: 'Sales, collections and outstanding at a glance' },
  invoices: { title: 'Invoices', hint: 'GST tax invoices and consignment billing' },
  customers: { title: 'Customers', hint: 'Consignees, statements and outstanding balances' },
  payments: { title: 'Payments', hint: 'Receipts recorded against invoices' },
  settings: { title: 'Settings', hint: 'Company profile, GST and bank details' },
  users: { title: 'Users', hint: 'Staff accounts and permissions' },
};

/** Cycles light → dark → system. The icon shows the *current* mode. */
const ThemeToggle: React.FC = () => {
  const [theme, setTheme] = useTheme();
  const next: Record<ThemeChoice, ThemeChoice> = { light: 'dark', dark: 'system', system: 'light' };
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : MonitorSmartphone;
  const labels: Record<ThemeChoice, string> = {
    light: 'Light theme', dark: 'Dark theme', system: 'Following system theme',
  };
  return (
    <IconButton
      label={`${labels[theme]}. Switch to ${labels[next[theme]].toLowerCase()}`}
      onClick={() => setTheme(next[theme])}
    >
      <Icon className="w-[18px] h-[18px]" />
    </IconButton>
  );
};

export const TopHeader: React.FC<TopHeaderProps> = ({
  activeTab,
  onToggleSidebar,
  onNewInvoice,
  onReceivePayment,
  onNewCustomer,
}) => {
  const { user } = useAuth();
  const meta = TAB_TITLES[activeTab] || { title: activeTab, hint: '' };

  const hasModule = (mod: string) => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.modules?.includes(mod);
  };

  return (
    <header
      className={cx(
        'h-16 bg-surface/95 backdrop-blur border-b border-line px-3 sm:px-6',
        'flex items-center justify-between gap-3 sticky top-0 z-30 pt-safe'
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <IconButton label="Open navigation" onClick={onToggleSidebar} className="lg:hidden -ml-1">
          <Menu className="w-5 h-5" />
        </IconButton>

        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-bold text-ink leading-tight truncate">{meta.title}</h1>
          <p className="hidden sm:block text-xs text-ink-faint truncate">{meta.hint}</p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {hasModule('customers') && (
          <IconButton label="Add customer" onClick={onNewCustomer} className="hidden sm:inline-flex">
            <Users className="w-[18px] h-[18px]" />
          </IconButton>
        )}

        {hasModule('payments') && (
          <IconButton label="Record payment" onClick={onReceivePayment} className="hidden sm:inline-flex">
            <Receipt className="w-[18px] h-[18px]" />
          </IconButton>
        )}

        <ThemeToggle />

        {hasModule('invoices') && (
          <Button variant="primary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={onNewInvoice}>
            <span className="hidden sm:inline">New Invoice</span>
            <span className="sm:hidden">New</span>
          </Button>
        )}
      </div>
    </header>
  );
};
